import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Armchair,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  DoorOpen,
  Grid2X2,
  MapPin,
  MessageCircle,
  Plus,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { getCatalogItem } from '../catalog';
import { getRoomCapacity } from '../model';
import type { OfficeConfig } from '../model';
import BookingPlan from './BookingPlan';
import BookingTimeline from './BookingTimeline';
import {
  getBookingConflicts,
  getMoscowDate,
  getOfficeHours,
  getResourceEquipment,
  getResources,
  isResourceAvailable,
  isWorkplace,
  minutesToTime,
  timeToMinutes,
} from './bookingModel';
import { useAuth } from '../auth/AuthProvider';
import UserMenu from '../auth/UserMenu';
import OfficeSwitcher from '../offices/OfficeSwitcher';
import type { ClientBooking, ResourceFilter, TimeRange } from './types';
import { getNearbyContext } from './spatialContext';
import { useBookings } from './useBookings';
import AssistantPanel from './AssistantPanel';
import type { BookingPrefill } from './bookingLink';
import type { BookingProposal } from '../api/client';
import BookingDetails from './BookingDetails';
import { getBookingResourceDetails, isBookingHistorical } from './bookingDetails';
import './client.css';

function readableDate(date: string, weekday = false) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(weekday ? { weekday: 'long' as const } : {}),
  }).format(new Date(date + 'T12:00:00Z'));
}
function nextDate(date: string, delta: number) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
function durationLabel(range: TimeRange) {
  const minutes = Math.max(0, range.end - range.start);
  return (
    (Math.floor(minutes / 60) ? Math.floor(minutes / 60) + ' ч' : '') +
    (minutes % 60 ? ' ' + (minutes % 60) + ' мин' : '')
  );
}

export default function ClientApp({
  office,
  bookingPrefill,
  onProposal,
}: {
  office: OfficeConfig;
  bookingPrefill?: BookingPrefill;
  onProposal: (proposal: BookingProposal) => void;
}) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';
  const officeView = office;
  const [date, setDate] = useState(() => bookingPrefill?.date || getMoscowDate());
  const [dateMissing, setDateMissing] = useState(() => !!bookingPrefill && !bookingPrefill.date);
  const [startMissing, setStartMissing] = useState(
    () => !!bookingPrefill && bookingPrefill.start === undefined,
  );
  const [endMissing, setEndMissing] = useState(
    () => !!bookingPrefill && bookingPrefill.end === undefined,
  );
  const [participantsMissing, setParticipantsMissing] = useState(
    () => !!bookingPrefill && bookingPrefill.participants === undefined,
  );
  const bookingStore = useBookings(office.id);
  const { bookings, saving, available: bookingsAvailable, loading: bookingsLoading } = bookingStore;
  const [floorId, setFloorId] = useState(bookingPrefill?.floorId || office.floors[0].id);
  const floor = officeView.floors.find((item) => item.id === floorId) || officeView.floors[0];
  const [range, setRange] = useState<TimeRange>({
    start: bookingPrefill?.start ?? 14 * 60,
    end: bookingPrefill?.end ?? 15 * 60,
  });
  const [cursorMinute, setCursorMinute] = useState(bookingPrefill?.start ?? 14 * 60);
  const [filter, setFilter] = useState<ResourceFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(bookingPrefill?.resourceId || null);
  const [panel, setPanel] = useState<'resource' | 'create' | 'booking' | null>(
    bookingPrefill ? 'create' : null,
  );
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [timelineFocus, setTimelineFocus] = useState<{ id: string; token: number } | null>(null);
  const timelineFocusSequence = useRef(0);
  const consumeTimelineFocus = useCallback(
    (token: number) => setTimelineFocus((current) => (current?.token === token ? null : current)),
    [],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<ClientBooking | null>(null);
  const [participants, setParticipants] = useState(bookingPrefill?.participants ?? 1);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [myBookingsOpen, setMyBookingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [assistantStarted, setAssistantStarted] = useState(false);
  const [assistantConversation, setAssistantConversation] = useState({
    hasConversation: false,
    hasDraft: false,
    processing: false,
  });
  const appliedPrefill = useRef(bookingPrefill);
  useEffect(() => {
    if (!bookingPrefill || appliedPrefill.current === bookingPrefill) return;
    appliedPrefill.current = bookingPrefill;
    setFloorId(bookingPrefill.floorId);
    setSelectedId(bookingPrefill.resourceId);
    setDate(bookingPrefill.date || getMoscowDate());
    setDateMissing(!bookingPrefill.date);
    setStartMissing(bookingPrefill.start === undefined);
    setEndMissing(bookingPrefill.end === undefined);
    setRange({ start: bookingPrefill.start ?? 14 * 60, end: bookingPrefill.end ?? 15 * 60 });
    setCursorMinute(bookingPrefill.start ?? 14 * 60);
    setParticipants(bookingPrefill.participants ?? 1);
    setParticipantsMissing(bookingPrefill.participants === undefined);
    setEditingId(null);
    setEditingSource(null);
    setActiveBookingId(null);
    setMyBookingsOpen(false);
    setChatOpen(false);
    setPanel('create');
    setFormError('');
  }, [bookingPrefill]);
  const hours = getOfficeHours(officeView, date);
  const resources = useMemo(() => getResources(floor), [floor]);
  const activeBooking = bookings.find((item) => item.id === activeBookingId) || null;
  const selected =
    panel === 'booking' && activeBooking && activeBooking.floorId !== floor.id
      ? null
      : resources.find((item) => item.id === selectedId) || null;
  const editingCurrent = editingId ? bookings.find((item) => item.id === editingId) : null;
  const editChanged =
    !!editingSource &&
    !!editingId &&
    (!editingCurrent || editingCurrent.revision !== editingSource.revision);
  const editMode = (booking: ClientBooking): 'none' | 'end' | 'all' => {
    if (booking.status === 'cancelled') return 'none';
    const midnight = Date.parse(booking.date + 'T00:00:00+03:00');
    const start = booking.startsAt
      ? Date.parse(booking.startsAt)
      : midnight + booking.start * 60_000;
    const end = booking.endsAt ? Date.parse(booking.endsAt) : midnight + booking.end * 60_000;
    return end <= bookingStore.serverNow ? 'none' : start <= bookingStore.serverNow ? 'end' : 'all';
  };
  const endOnly = !!editingSource && editMode(editingSource) === 'end';
  const historicalBooking =
    !!activeBooking && isBookingHistorical(activeBooking, bookingStore.serverNow);
  const bookingResource = activeBooking
    ? getBookingResourceDetails(activeBooking, office, { preferSnapshot: historicalBooking })
    : null;
  const rangeValid =
    !startMissing &&
    !endMissing &&
    range.start >= hours.start &&
    range.end <= hours.end &&
    range.end > range.start;
  const mapRange = panel === 'create' ? range : { start: cursorMinute, end: cursorMinute + 1 };
  const mapRangeValid =
    (panel !== 'create' || (!dateMissing && !startMissing && !endMissing)) &&
    bookingsAvailable &&
    hours.enabled &&
    mapRange.start >= hours.start &&
    mapRange.end <= hours.end &&
    mapRange.end > mapRange.start;
  const displayedResources = resources.filter(
    (item) => filter === 'all' || (filter === 'desk' ? isWorkplace(item) : item.kind === 'room'),
  );
  const availableCount = mapRangeValid
    ? displayedResources.filter((item) =>
        isResourceAvailable(floor, item.id, date, mapRange.start, mapRange.end, bookings),
      ).length
    : 0;
  const formRangeComplete = !dateMissing && !startMissing && !endMissing;
  const availabilityLabel = !bookingsAvailable
    ? bookingsLoading
      ? 'Загружаем занятость'
      : 'Занятость неизвестна'
    : panel === 'create' && !formRangeComplete
      ? 'Выберите дату и время'
      : mapRangeValid
        ? availableCount + ' из ' + displayedResources.length + ' свободно'
        : hours.enabled
          ? 'Вне рабочих часов'
          : 'Офис закрыт';
  const conflicts = selected
    ? getBookingConflicts(
        floor,
        selected.id,
        date,
        mapRange.start,
        mapRange.end,
        bookings,
        editingId || undefined,
      )
    : [];
  const mine = bookings
    .filter((item) => item.ownerId === currentUserId && item.status === 'active')
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const cancelledMine = bookings
    .filter((item) => item.ownerId === currentUserId && item.status === 'cancelled')
    .sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start);
  const roomCapacity = selected?.kind === 'room' ? getRoomCapacity(selected) : 1;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    document.title = 'Планировка — бронирование';
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanel(null);
        setMyBookingsOpen(false);
        setChatOpen(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const changeRange = (next: TimeRange) => {
    setRange(next);
    setCursorMinute(next.start);
    setStartMissing(false);
    setEndMissing(false);
    setFormError('');
  };
  const changeFormTime = (edge: 'start' | 'end', value: string) => {
    const minute = timeToMinutes(value);
    if (edge === 'start') setStartMissing(minute < 0);
    else setEndMissing(minute < 0);
    if (minute >= 0) {
      setRange((previous) => ({ ...previous, [edge]: minute }));
      if (edge === 'start') setCursorMinute(minute);
    }
    setFormError('');
  };
  const changeFormDate = (value: string) => {
    setDateMissing(!value);
    if (value) setDate(value);
    setFormError('');
  };
  const openProposal = useCallback(
    (proposal: BookingProposal) => {
      try {
        onProposal(proposal);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : 'Не удалось открыть предложение.');
      }
    },
    [onProposal],
  );
  const openAssistant = () => {
    setAssistantStarted(true);
    setChatOpen(true);
    setPanel(null);
  };
  const canContinueAssistant =
    assistantConversation.hasConversation ||
    assistantConversation.hasDraft ||
    assistantConversation.processing;
  const chooseDate = (next: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    setDate(next);
    setDateMissing(false);
    setFormError('');
    setEditingId(null);
    setActiveBookingId(null);
    setPanel(selected ? 'resource' : null);
  };
  const selectResource = (id: string) => {
    setSelectedId(id);
    setPanel('resource');
    setActiveBookingId(null);
    setEditingId(null);
    setFormError('');
    setChatOpen(false);
  };
  const openCreate = (id: string, minute?: number) => {
    if (!bookingsAvailable || saving) return;
    setDateMissing(false);
    setStartMissing(false);
    setEndMissing(false);
    setParticipantsMissing(false);
    setSelectedId(id);
    setPanel('create');
    setEditingId(null);
    setActiveBookingId(null);
    setParticipants(1);
    setFormError('');
    setChatOpen(false);
    if (minute !== undefined) {
      const length = Math.max(5, range.end - range.start);
      const start = Math.max(hours.start, Math.min(hours.end - 5, Math.round(minute / 5) * 5));
      changeRange({ start, end: Math.min(hours.end, start + length) });
    }
  };
  const showBooking = (booking: ClientBooking) => {
    setFloorId(booking.floorId);
    setDate(booking.date);
    setSelectedId(booking.resourceId);
    setActiveBookingId(booking.id);
    setEditingId(null);
    setPanel('booking');
    setMyBookingsOpen(false);
    setChatOpen(false);
    setFormError('');
  };
  const validateRange = (resourceId: string, next: TimeRange, ignoreId?: string) => {
    if (!bookingsAvailable) return 'Не удалось проверить занятость. Обновите расписание.';
    if (!hours.enabled) return 'В этот день офис закрыт. Выберите другую дату.';
    if (next.end <= next.start) return 'Время окончания должно быть позже начала.';
    if (next.start < hours.start || next.end > hours.end)
      return (
        'Выберите время с ' + minutesToTime(hours.start) + ' до ' + minutesToTime(hours.end) + '.'
      );
    const clashes = getBookingConflicts(
      floor,
      resourceId,
      date,
      next.start,
      next.end,
      bookings,
      ignoreId,
    );
    if (clashes.length)
      return (
        'Занято: ' +
        clashes
          .map(
            (item) =>
              getBookingResourceDetails(item, office).name +
              ' ' +
              minutesToTime(item.start) +
              '–' +
              minutesToTime(item.end),
          )
          .join('; ') +
        '.'
      );
    return '';
  };
  const revealSavedBooking = (booking: ClientBooking) => {
    setFloorId(booking.floorId);
    setDate(booking.date);
    setSelectedId(booking.resourceId);
    setCursorMinute(booking.start);
    setActiveBookingId(booking.id);
    setEditingId(null);
    setEditingSource(null);
    setPanel(null);
    setMyBookingsOpen(false);
    setChatOpen(false);
    setFormError('');
    setTimelineFocus({ id: booking.id, token: ++timelineFocusSequence.current });
  };
  const submitBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || saving) return;
    if (
      dateMissing ||
      startMissing ||
      endMissing ||
      (selected.kind === 'room' && participantsMissing)
    ) {
      setFormError('Заполните дату, время и число участников.');
      return;
    }
    const error = validateRange(selected.id, range, editingId || undefined);
    if (error) {
      setFormError(error);
      return;
    }
    if (selected.kind === 'room' && (!Number.isInteger(participants) || participants < 1)) {
      setFormError('Укажите целое число участников, не меньше одного.');
      return;
    }
    try {
      const input = {
        floorId: floor.id,
        resourceId: selected.id,
        date,
        start: range.start,
        end: range.end,
        ...(selected.kind === 'room' ? { participants } : {}),
      };
      const source = editingId ? editingSource : undefined;
      if (editingId && !source) throw new Error('Бронь изменилась. Откройте её снова.');
      if (source && editMode(source) === 'none') throw new Error('Эта бронь уже завершилась.');
      const booking = source
        ? await bookingStore.update(source, input)
        : await bookingStore.create(input);
      revealSavedBooking(booking);
      setNotice(editingId ? 'Изменения сохранены' : 'Бронь создана');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Не удалось сохранить бронь.');
    }
  };
  const editBooking = (booking: ClientBooking) => {
    if (editMode(booking) === 'none') return;
    setDate(booking.date);
    setFloorId(booking.floorId);
    setSelectedId(booking.resourceId);
    setDateMissing(false);
    setStartMissing(false);
    setEndMissing(false);
    setParticipantsMissing(false);
    setRange({ start: booking.start, end: booking.end });
    setCursorMinute(booking.start);
    setParticipants(booking.participants || 1);
    setEditingSource({ ...booking });
    setEditingId(booking.id);
    setPanel('create');
    setFormError('');
  };
  const cancelBooking = async (booking: ClientBooking) => {
    if (booking.ownerId !== currentUserId || booking.status === 'cancelled' || saving) return;
    try {
      const running = editMode(booking) === 'end';
      await bookingStore.cancel(booking);
      setActiveBookingId(null);
      setPanel(selected ? 'resource' : null);
      setNotice(running ? 'Бронь завершена' : 'Бронь отменена');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Не удалось отменить бронь.');
    }
  };
  const changeBooking = async (id: string, start: number, end: number, destinationId?: string) => {
    const booking = bookings.find((item) => item.id === id);
    if (!booking || booking.ownerId !== currentUserId || saving) return;
    const destination = resources.find((item) => item.id === (destinationId || booking.resourceId));
    if (!destination) {
      setNotice('Это пространство пока не доступно для бронирования.');
      return;
    }
    const error = validateRange(destination.id, { start, end }, id);
    if (error) {
      setNotice(error);
      return;
    }
    try {
      const saved = await bookingStore.update(booking, {
        floorId: floor.id,
        resourceId: destination.id,
        date: booking.date,
        start,
        end,
        ...(destination.kind === 'room' ? { participants: booking.participants || 1 } : {}),
      });
      revealSavedBooking(saved);
      setNotice(
        destination.id === booking.resourceId
          ? 'Время брони изменено'
          : 'Бронь перенесена: ' +
              destination.name +
              (isWorkplace(destination) ? ' · место для одного' : ''),
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Не удалось перенести бронь.');
    }
  };
  const equipment = selected ? getResourceEquipment(floor, selected.id) : [];
  const deskFeatures =
    selected && isWorkplace(selected)
      ? [
          { type: selected.type, quantity: 1 },
          ...equipment.filter((item) => item.type !== selected.type),
        ]
      : [];
  const contextKinds = new Set<string>();
  const nearbyContext = selected
    ? getNearbyContext(floor, selected.id)
        .filter((item) => {
          if (contextKinds.has(item.context)) return false;
          contextKinds.add(item.context);
          return true;
        })
        .slice(0, 3)
    : [];
  const bookingListRecord = (item: ClientBooking) => {
    const details = getBookingResourceDetails(item, office, {
      preferSnapshot: isBookingHistorical(item, bookingStore.serverNow),
    });
    return (
      <div className="bk-my-record" key={item.id}>
        <button type="button" onClick={() => showBooking(item)}>
          <span className="bk-my-icon">
            {details.kind === 'room' || details.kind === 'meeting_room' ? (
              <DoorOpen size={20} />
            ) : (
              <Armchair size={20} />
            )}
          </span>
          <span>
            <b>{details.name}</b>
            <small>
              {details.floorName} · {readableDate(item.date)}
              <br />
              {minutesToTime(item.start)}–{minutesToTime(item.end)}
            </small>
          </span>
          <ArrowRight size={16} />
        </button>
        <BookingDetails booking={item} compact />
      </div>
    );
  };

  const dateControl = (
    <div className="bk-date-controls">
      <button aria-label="Предыдущий день" onClick={() => chooseDate(nextDate(date, -1))}>
        <ArrowLeft size={16} />
      </button>
      <div className="bk-date-picker">
        <CalendarDays size={16} />
        <span>{readableDate(date)}</span>
        <ChevronDown size={13} />
        <input
          aria-label="Дата бронирования"
          type="date"
          value={date}
          onInput={(event) => chooseDate(event.currentTarget.value)}
          onChange={(event) => chooseDate(event.target.value)}
        />
      </div>
      <button aria-label="Следующий день" onClick={() => chooseDate(nextDate(date, 1))}>
        <ArrowRight size={16} />
      </button>
      <button className="bk-today" onClick={() => chooseDate(getMoscowDate())}>
        Сегодня
      </button>
    </div>
  );

  return (
    <div className="bk-shell">
      <header className="bk-header">
        <a className="bk-brand" href="/booking">
          <span>
            <Grid2X2 size={22} />
          </span>
          планировка<i>•</i>
        </a>
        <div className="office-header-context">
          <OfficeSwitcher />
          <i>/</i>
          <b>Бронирование</b>
        </div>
        <div className="bk-header-actions">
          <button className="bk-my-button" onClick={() => setMyBookingsOpen(true)}>
            <CalendarDays size={15} />
            Мои брони{mine.length > 0 && <span>{mine.length}</span>}
          </button>
          <UserMenu />
        </div>
      </header>

      <main className="bk-main">
        <div className="bk-map-toolbar">
          <div className="bk-resource-tabs" aria-label="Тип ресурса">
            {(
              [
                ['all', 'Все пространства'],
                ['desk', 'Рабочие места'],
                ['room', 'Помещения'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={filter === key ? 'is-active' : ''}
                onClick={() => setFilter(key)}
              >
                {key === 'desk' ? (
                  <Armchair size={14} />
                ) : key === 'room' ? (
                  <DoorOpen size={14} />
                ) : (
                  <Grid2X2 size={14} />
                )}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <span className="bk-free-count">
            <i />
            {availabilityLabel}
          </span>
        </div>
        <div className={'bk-map-area' + (panel && selected ? ' has-card' : '')}>
          <BookingPlan
            floor={floor}
            bookings={bookings}
            date={date}
            start={mapRange.start}
            end={mapRange.end}
            cursorMinute={cursorMinute}
            viewMode={panel === 'create' ? 'interval' : 'moment'}
            selectedId={selectedId}
            filter={filter}
            onSelect={selectResource}
            disabled={!mapRangeValid}
          />
          {resources.length === 0 && (
            <div className="bk-empty-office">
              <Building2 size={29} />
              <h2>На этом этаже пока нет мест</h2>
              <p>Выберите другой этаж или офис. План этого этажа ещё готовится.</p>
            </div>
          )}
          <div className="bk-floor-switcher" role="group" aria-label="Выбор этажа">
            <small>ЭТАЖ</small>
            {officeView.floors.map((item, index) => (
              <button
                key={item.id}
                aria-label={'Показать ' + item.name}
                aria-pressed={item.id === floor.id}
                className={item.id === floor.id ? 'is-active' : ''}
                onClick={() => {
                  setFloorId(item.id);
                  setSelectedId(null);
                  setPanel(null);
                  setEditingId(null);
                }}
              >
                {item.name.match(/^-?\d+/)?.[0] || index + 1}
              </button>
            ))}
          </div>
          {!hours.enabled && (
            <div className="bk-closed-note">
              <Clock3 size={16} />В этот день офис закрыт. Выберите другую дату.
            </div>
          )}
          {bookingStore.error && (
            <div className="bk-save-error" role="alert">
              {bookingStore.error}
              <button type="button" onClick={() => void bookingStore.refresh()}>
                Повторить
              </button>
            </div>
          )}

          {panel && selected && (
            <aside className="bk-resource-card" aria-label="Карточка бронирования">
              <button
                className="bk-card-close"
                aria-label="Закрыть карточку"
                onClick={() => setPanel(null)}
              >
                <X size={17} />
              </button>
              <div className="bk-resource-scroll">
                <div
                  className={'bk-card-cover ' + (selected.kind === 'room' ? 'is-room' : 'is-desk')}
                >
                  <div className="bk-card-cover-grid" />
                  {selected.kind === 'room' ? (
                    <DoorOpen size={46} strokeWidth={1.2} />
                  ) : (
                    <img
                      src={getCatalogItem(selected.type)?.asset || '/assets/furniture/desk.svg'}
                      alt=""
                    />
                  )}
                  <span>
                    <MapPin size={11} />
                    {panel === 'booking' ? bookingResource?.floorName : floor.name}
                  </span>
                </div>
                <div className="bk-card-body">
                  <div className="bk-card-kind">
                    {panel === 'booking' && historicalBooking
                      ? 'ИСТОРИЯ БРОНИ'
                      : selected.kind === 'room'
                        ? 'ПОМЕЩЕНИЕ'
                        : 'РАБОЧЕЕ МЕСТО'}
                  </div>
                  <h2>{panel === 'booking' ? bookingResource?.name : selected.name}</h2>
                  {!(panel === 'booking' && historicalBooking) && (
                    <>
                      <div className="bk-card-facts">
                        <span>
                          {selected.kind === 'room' ? <Users size={14} /> : <Armchair size={14} />}
                          {selected.kind === 'room'
                            ? roomCapacity > 0
                              ? roomCapacity + ' сидячих мест'
                              : 'Сидячие места не указаны'
                            : 'Для одного'}
                        </span>
                        {selected.shared && (
                          <span>
                            <Users size={14} />
                            Есть отдельные места
                          </span>
                        )}
                      </div>
                      {isWorkplace(selected) ? (
                        <section className="bk-desk-equipment">
                          <h3>Оснащение рабочего места</h3>
                          <div>
                            {deskFeatures.map((item) => {
                              const catalog = getCatalogItem(item.type);
                              return (
                                <span key={item.type}>
                                  {catalog && <img src={catalog.asset} alt="" />}
                                  <b>{catalog?.name || 'Оснащение'}</b>
                                  {item.quantity > 1 && <small>×{item.quantity}</small>}
                                </span>
                              );
                            })}
                          </div>
                          {!equipment.length && <p>Дополнительное оснащение не указано</p>}
                        </section>
                      ) : (
                        equipment.filter(
                          (item) => getCatalogItem(item.type)?.category === 'equipment',
                        ).length > 0 && (
                          <div className="bk-equipment">
                            {equipment
                              .filter((item) => getCatalogItem(item.type)?.category === 'equipment')
                              .map((item) => (
                                <span key={item.type}>
                                  {getCatalogItem(item.type)?.name}
                                  {item.quantity > 1 ? ' ×' + item.quantity : ''}
                                </span>
                              ))}
                          </div>
                        )
                      )}
                    </>
                  )}

                  {!(panel === 'booking' && historicalBooking) && nearbyContext.length > 0 && (
                    <section className="bk-spatial-context">
                      <h3>Ближайшие объекты</h3>
                      <div>
                        {nearbyContext.map((item) => (
                          <span key={item.id}>
                            {getCatalogItem(item.type) && (
                              <img src={getCatalogItem(item.type)!.asset} alt="" />
                            )}
                            {item.name}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}
                  {panel === 'resource' && (
                    <>
                      <div
                        className={
                          'bk-availability ' +
                          (mapRangeValid && !conflicts.length ? 'is-free' : 'is-busy')
                        }
                      >
                        <span className="bk-status-dot" />
                        <div>
                          <b>
                            {!bookingsAvailable
                              ? 'Занятость неизвестна'
                              : !hours.enabled
                                ? 'Офис закрыт'
                                : !mapRangeValid
                                  ? 'Вне рабочих часов'
                                  : conflicts.length
                                    ? 'Занято в ' + minutesToTime(cursorMinute)
                                    : 'Свободно в ' + minutesToTime(cursorMinute)}
                          </b>
                          <small>{readableDate(date)}</small>
                        </div>
                      </div>
                      {conflicts.length > 0 && (
                        <div className="bk-conflict-list">
                          <span>БРОНЬ В ЭТО ВРЕМЯ</span>
                          {conflicts.map((item) => (
                            <button key={item.id} onClick={() => showBooking(item)}>
                              <span>
                                <b>
                                  {minutesToTime(item.start)}–{minutesToTime(item.end)}
                                </b>
                                <small>
                                  {item.ownerId === currentUserId ? 'Ваша бронь' : item.ownerName}
                                </small>
                              </span>
                              <ArrowRight size={14} />
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        className="bk-primary"
                        disabled={!hours.enabled || !bookingsAvailable || saving}
                        onClick={() => openCreate(selected.id, cursorMinute)}
                      >
                        <Plus size={16} />
                        {conflicts.length ? 'Выбрать другое время' : 'Забронировать'}
                      </button>
                    </>
                  )}

                  {panel === 'create' && (
                    <form className="bk-booking-form" onSubmit={submitBooking}>
                      <div className="bk-form-title">
                        {editingId ? 'Изменить бронь' : 'Новая бронь'}
                      </div>
                      {editingId && editingSource && (
                        <BookingDetails booking={editingCurrent || editingSource} />
                      )}
                      {editChanged && (
                        <div className="bk-form-error" role="alert">
                          Бронь изменилась в другом окне.
                          {editingCurrent?.status === 'active' ? (
                            <button
                              type="button"
                              className="bk-subtle-button"
                              onClick={() => editBooking(editingCurrent)}
                            >
                              Открыть актуальную версию
                            </button>
                          ) : (
                            <small>Запись больше не активна. Закройте форму.</small>
                          )}
                        </div>
                      )}
                      <label>
                        Дата
                        <input
                          type="date"
                          required
                          disabled={saving || endOnly}
                          min={!editingId ? bookingStore.policy?.allowedDates[0] : undefined}
                          max={!editingId ? bookingStore.policy?.allowedDates.at(-1) : undefined}
                          aria-label="Дата в форме бронирования"
                          value={dateMissing ? '' : date}
                          onInput={(event) => changeFormDate(event.currentTarget.value)}
                          onChange={(event) => changeFormDate(event.target.value)}
                        />
                      </label>
                      <div className="bk-form-grid">
                        <label>
                          Начало
                          <input
                            type="time"
                            required
                            disabled={saving || endOnly}
                            step="300"
                            aria-label="Начало брони"
                            value={startMissing ? '' : minutesToTime(range.start)}
                            onInput={(event) => changeFormTime('start', event.currentTarget.value)}
                            onChange={(event) => changeFormTime('start', event.target.value)}
                          />
                        </label>
                        <label>
                          Окончание
                          <input
                            type="time"
                            required
                            disabled={saving}
                            step="300"
                            aria-label="Окончание брони"
                            value={endMissing ? '' : minutesToTime(range.end)}
                            onInput={(event) => changeFormTime('end', event.currentTarget.value)}
                            onChange={(event) => changeFormTime('end', event.target.value)}
                          />
                        </label>
                      </div>
                      {endOnly && (
                        <p className="bk-form-summary">
                          Бронь уже началась: можно изменить окончание или завершить её.
                        </p>
                      )}
                      {selected.kind === 'room' && (
                        <label>
                          Участники
                          <input
                            type="number"
                            required
                            disabled={saving || endOnly}
                            min="1"
                            aria-label="Количество участников"
                            value={participantsMissing ? '' : participants}
                            onChange={(event) => {
                              setParticipantsMissing(!event.target.value);
                              setParticipants(Number(event.target.value));
                            }}
                          />
                        </label>
                      )}
                      {selected.kind === 'room' &&
                        !participantsMissing &&
                        participants > roomCapacity && (
                          <div className="bk-capacity-warning" role="status">
                            Для {participants} участников здесь {roomCapacity} сидячих мест.
                            <small>Бронь можно подтвердить.</small>
                          </div>
                        )}
                      {(formError ||
                        dateMissing ||
                        conflicts.length > 0 ||
                        !rangeValid ||
                        !hours.enabled) && (
                        <div className="bk-form-error" role="alert">
                          {formError ||
                            (dateMissing
                              ? 'Выберите дату бронирования.'
                              : startMissing || endMissing
                                ? 'Укажите начало и окончание.'
                                : !hours.enabled
                                  ? 'В этот день офис закрыт.'
                                  : !rangeValid
                                    ? 'Время должно быть в пределах рабочего дня.'
                                    : 'Часть выбранного времени уже занята.')}
                          {!dateMissing && !startMissing && !endMissing && conflicts.length > 0 && (
                            <small>
                              {conflicts
                                .map(
                                  (item) =>
                                    minutesToTime(item.start) + '–' + minutesToTime(item.end),
                                )
                                .join(', ')}
                            </small>
                          )}
                        </div>
                      )}
                      {!startMissing && !endMissing && (
                        <div className="bk-form-summary">
                          <Clock3 size={14} />
                          {durationLabel(range)}
                          <span>Московское время</span>
                        </div>
                      )}
                      <button
                        className="bk-primary"
                        type="submit"
                        disabled={saving || !bookingsAvailable || editChanged}
                      >
                        <Check size={16} />
                        {saving
                          ? 'Сохраняем…'
                          : editingId
                            ? 'Сохранить изменения'
                            : 'Подтвердить бронь'}
                      </button>
                      <button
                        className="bk-subtle-button"
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setEditingId(null);
                          setPanel('resource');
                        }}
                      >
                        Назад к пространству
                      </button>
                    </form>
                  )}

                  {panel === 'booking' && activeBooking && (
                    <>
                      <BookingDetails booking={activeBooking} />
                      <div
                        className={
                          'bk-booking-owner ' +
                          (activeBooking.ownerId === currentUserId ? 'is-mine' : '')
                        }
                      >
                        <span>
                          {activeBooking.ownerId === currentUserId ? (
                            <Check size={17} />
                          ) : (
                            <Users size={17} />
                          )}
                        </span>
                        <div>
                          <b>
                            {activeBooking.ownerId === currentUserId
                              ? 'Ваша бронь'
                              : activeBooking.ownerName}
                          </b>
                          <small>
                            {historicalBooking
                              ? 'Сохранённая запись'
                              : activeBooking.needsReview
                                ? 'Проверьте условия брони'
                                : activeBooking.ownerId === currentUserId
                                  ? 'Всё готово к вашему приходу'
                                  : 'Владелец брони'}
                          </small>
                        </div>
                      </div>
                      <dl className="bk-booking-details">
                        <div>
                          <dt>Дата</dt>
                          <dd>{readableDate(activeBooking.date)}</dd>
                        </div>
                        <div>
                          <dt>Время</dt>
                          <dd>
                            {minutesToTime(activeBooking.start)}–{minutesToTime(activeBooking.end)}
                          </dd>
                        </div>
                        {activeBooking.participants && (
                          <div>
                            <dt>Участники</dt>
                            <dd>{activeBooking.participants}</dd>
                          </div>
                        )}
                      </dl>
                      {activeBooking.ownerId === currentUserId &&
                        editMode(activeBooking) !== 'none' && (
                          <>
                            <button
                              className="bk-primary"
                              disabled={saving || !bookingsAvailable}
                              onClick={() => editBooking(activeBooking)}
                            >
                              Изменить бронь
                            </button>
                            <button
                              className="bk-cancel-button"
                              disabled={saving || !bookingsAvailable}
                              onClick={() => void cancelBooking(activeBooking)}
                            >
                              {editMode(activeBooking) === 'end'
                                ? 'Завершить сейчас'
                                : 'Отменить бронь'}
                            </button>
                          </>
                        )}
                    </>
                  )}
                </div>
              </div>
            </aside>
          )}

          {panel === 'booking' && !selected && activeBooking && (
            <aside className="bk-resource-card" aria-label="Карточка недоступного ресурса">
              <button
                className="bk-card-close"
                aria-label="Закрыть карточку"
                onClick={() => setPanel(null)}
              >
                <X size={17} />
              </button>
              <div className="bk-resource-scroll">
                <div className="bk-card-body">
                  <div className="bk-card-kind">
                    {historicalBooking ? 'ИСТОРИЯ БРОНИ' : 'ПРОСТРАНСТВО НЕДОСТУПНО'}
                  </div>
                  <h2>{bookingResource?.name}</h2>
                  <p className="booking-record-summary">
                    <span>{bookingResource?.floorName}</span>
                    <small>
                      Пространство больше не доступно на плане. Запись о брони сохранена.
                    </small>
                  </p>
                  <BookingDetails booking={activeBooking} />
                  <dl className="bk-booking-details">
                    <div>
                      <dt>Владелец</dt>
                      <dd>
                        {activeBooking.ownerId === currentUserId ? 'Вы' : activeBooking.ownerName}
                      </dd>
                    </div>
                    <div>
                      <dt>Дата</dt>
                      <dd>{readableDate(activeBooking.date)}</dd>
                    </div>
                    <div>
                      <dt>Время</dt>
                      <dd>
                        {minutesToTime(activeBooking.start)}–{minutesToTime(activeBooking.end)}
                      </dd>
                    </div>
                  </dl>
                  {activeBooking.ownerId === currentUserId &&
                    editMode(activeBooking) !== 'none' && (
                      <button
                        className="bk-cancel-button"
                        disabled={saving || !bookingsAvailable}
                        onClick={() => void cancelBooking(activeBooking)}
                      >
                        {editMode(activeBooking) === 'end' ? 'Завершить сейчас' : 'Отменить бронь'}
                      </button>
                    )}
                </div>
              </div>
            </aside>
          )}
          <div hidden={!chatOpen}>
            {assistantStarted && (
              <AssistantPanel
                office={office}
                floorId={floor.id}
                date={date}
                onClose={() => setChatOpen(false)}
                onBookingsChanged={bookingStore.refresh}
                onProposal={openProposal}
                onConversationState={setAssistantConversation}
              />
            )}
          </div>
          {!chatOpen && (
            <button
              className="bk-chat-launcher"
              aria-label={
                canContinueAssistant ? 'Продолжить диалог с помощником' : 'Открыть помощника'
              }
              onClick={openAssistant}
            >
              <span>
                <Sparkles size={18} />
              </span>
              <span>
                {assistantConversation.processing
                  ? 'Подбираем место…'
                  : canContinueAssistant
                    ? 'Продолжить диалог'
                    : 'Найти с помощником'}
                <small>
                  {canContinueAssistant ? 'Сообщения сохранены' : 'Опишите, что вам нужно'}
                </small>
              </span>
              <MessageCircle size={16} />
            </button>
          )}
        </div>

        {bookingsAvailable ? (
          <BookingTimeline
            currentUserId={currentUserId}
            focusBooking={timelineFocus}
            onFocusConsumed={consumeTimelineFocus}
            bookingEditMode={(booking) => (saving ? 'none' : editMode(booking))}
            dateControl={dateControl}
            showRange={panel === 'create' && formRangeComplete}
            floor={floor}
            bookings={bookings}
            date={date}
            range={range}
            hours={hours}
            cursorMinute={cursorMinute}
            selectedId={selectedId}
            onSelect={selectResource}
            onRangeChange={changeRange}
            onCursorChange={setCursorMinute}
            onBookingClick={showBooking}
            onBookingChange={changeBooking}
            onCreate={openCreate}
          />
        ) : (
          <div className="bk-unavailable-timeline" role="status">
            <p>
              {bookingsLoading ? 'Загружаем расписание…' : 'Занятость пока неизвестна'}
              {!bookingsLoading && (
                <button type="button" onClick={() => void bookingStore.refresh()}>
                  Обновить
                </button>
              )}
            </p>
            {dateControl}
          </div>
        )}
      </main>
      {notice && (
        <div className="bk-toast" role="status">
          <CheckCheck size={17} />
          {notice}
        </div>
      )}
      {myBookingsOpen && (
        <div
          className="bk-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMyBookingsOpen(false);
          }}
        >
          <section
            className="bk-my-bookings"
            role="dialog"
            aria-modal="true"
            aria-label="Мои брони"
          >
            <button
              className="bk-card-close"
              aria-label="Закрыть мои брони"
              onClick={() => setMyBookingsOpen(false)}
            >
              <X size={18} />
            </button>
            <div className="bk-my-scroll">
              <div className="bk-eyebrow">ВСЁ ПОД РУКОЙ</div>
              <h2>
                Мои брони <span>{mine.length}</span>
              </h2>
              <p>Брони в офисе «{office.name}»</p>
              {mine.length ? (
                <div className="bk-my-list">{mine.map(bookingListRecord)}</div>
              ) : (
                <div className="bk-no-bookings">
                  <CalendarDays size={32} />
                  <h3>Здесь появятся ваши планы</h3>
                  <p>Выберите место на плане и создайте первую бронь.</p>
                  <button className="bk-primary" onClick={() => setMyBookingsOpen(false)}>
                    Найти место
                  </button>
                </div>
              )}
              {cancelledMine.length > 0 && (
                <details className="booking-history-list">
                  <summary>Отменённые записи · {cancelledMine.length}</summary>
                  <div className="bk-my-list">{cancelledMine.map(bookingListRecord)}</div>
                </details>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
