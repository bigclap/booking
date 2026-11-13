import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { Floor, PlanElement } from '../../office';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getRoomCapacity } from '../../office';
import type { OfficeConfig } from '../../office';

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
} from '../lib/bookingModel';
import { useAuth } from '../../auth/hooks';

import type { ClientBooking, ResourceFilter, TimeRange } from '../types';
import { getNearbyContext } from '../lib/spatialContext';
import { useBookings } from '../hooks/useBookings';

import type { BookingPrefill } from '../lib/bookingLink';
import type { BookingProposal } from '../../shared/api';

import { getBookingResourceDetails, isBookingHistorical } from '../lib/bookingDetails';

export interface BookingPageProps {
  office: OfficeConfig;
  bookingPrefill?: BookingPrefill;
  onProposal: (proposal: BookingProposal) => void;
}
type Setter<T> = Dispatch<SetStateAction<T>>;
type BookingPanel = 'resource' | 'create' | 'booking' | null;
interface AssistantConversationState {
  hasConversation: boolean;
  hasDraft: boolean;
  processing: boolean;
}
export interface BookingController {
  office: OfficeConfig;
  currentUserId: string;
  officeView: OfficeConfig;
  date: string;
  dateMissing: boolean;
  startMissing: boolean;
  endMissing: boolean;
  participantsMissing: boolean;
  setParticipantsMissing: Setter<boolean>;
  bookingStore: ReturnType<typeof useBookings>;
  bookings: ClientBooking[];
  saving: boolean;
  bookingsAvailable: boolean;
  bookingsLoading: boolean;
  setFloorId: Setter<string>;
  floor: Floor;
  range: TimeRange;
  cursorMinute: number;
  setCursorMinute: Setter<number>;
  filter: ResourceFilter;
  setFilter: Setter<ResourceFilter>;
  selectedId: string | null;
  setSelectedId: Setter<string | null>;
  panel: BookingPanel;
  setPanel: Setter<BookingPanel>;
  timelineFocus: { id: string; token: number } | null;
  consumeTimelineFocus: (token: number) => void;
  editingId: string | null;
  setEditingId: Setter<string | null>;
  editingSource: ClientBooking | null;
  participants: number;
  setParticipants: Setter<number>;
  formError: string;
  notice: string;
  myBookingsOpen: boolean;
  setMyBookingsOpen: Setter<boolean>;
  chatOpen: boolean;
  setChatOpen: Setter<boolean>;
  assistantStarted: boolean;
  assistantConversation: AssistantConversationState;
  setAssistantConversation: Setter<AssistantConversationState>;
  hours: ReturnType<typeof getOfficeHours>;
  resources: PlanElement[];
  activeBooking: ClientBooking | null;
  selected: PlanElement | null;
  editingCurrent: ClientBooking | null | undefined;
  editChanged: boolean;
  editMode: (booking: ClientBooking) => 'none' | 'end' | 'all';
  endOnly: boolean;
  historicalBooking: boolean;
  bookingResource: ReturnType<typeof getBookingResourceDetails> | null;
  rangeValid: boolean;
  mapRange: TimeRange;
  mapRangeValid: boolean;
  formRangeComplete: boolean;
  availabilityLabel: string;
  conflicts: ClientBooking[];
  mine: ClientBooking[];
  cancelledMine: ClientBooking[];
  roomCapacity: number;
  changeRange: (next: TimeRange) => void;
  changeFormTime: (edge: 'start' | 'end', value: string) => void;
  changeFormDate: (value: string) => void;
  openProposal: (proposal: BookingProposal) => void;
  openAssistant: () => void;
  canContinueAssistant: boolean;
  chooseDate: (date: string) => void;
  selectResource: (id: string) => void;
  openCreate: (id: string, minute?: number) => void;
  showBooking: (booking: ClientBooking) => void;
  submitBooking: (event: FormEvent) => Promise<void>;
  editBooking: (booking: ClientBooking) => void;
  cancelBooking: (booking: ClientBooking) => Promise<void>;
  changeBooking: (id: string, start: number, end: number, destinationId?: string) => Promise<void>;
  equipment: ReturnType<typeof getResourceEquipment>;
  deskFeatures: Array<{ type: string; quantity: number }>;
  nearbyContext: ReturnType<typeof getNearbyContext>;
}

export function useBookingPage({
  office,
  bookingPrefill,
  onProposal,
}: BookingPageProps): BookingController {
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
  const [assistantConversation, setAssistantConversation] = useState<AssistantConversationState>({
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
  const submitBooking = async (event: FormEvent) => {
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

  return {
    office,
    currentUserId,
    officeView,
    date,
    dateMissing,
    startMissing,
    endMissing,
    participantsMissing,
    setParticipantsMissing,
    bookingStore,
    bookings,
    saving,
    bookingsAvailable,
    bookingsLoading,
    setFloorId,
    floor,
    range,
    cursorMinute,
    setCursorMinute,
    filter,
    setFilter,
    selectedId,
    setSelectedId,
    panel,
    setPanel,
    timelineFocus,
    consumeTimelineFocus,
    editingId,
    setEditingId,
    editingSource,
    participants,
    setParticipants,
    formError,
    notice,
    myBookingsOpen,
    setMyBookingsOpen,
    chatOpen,
    setChatOpen,
    assistantStarted,
    assistantConversation,
    setAssistantConversation,
    hours,
    resources,
    activeBooking,
    selected,
    editingCurrent,
    editChanged,
    editMode,
    endOnly,
    historicalBooking,
    bookingResource,
    rangeValid,
    mapRange,
    mapRangeValid,
    formRangeComplete,
    availabilityLabel,
    conflicts,
    mine,
    cancelledMine,
    roomCapacity,
    changeRange,
    changeFormTime,
    changeFormDate,
    openProposal,
    openAssistant,
    canContinueAssistant,
    chooseDate,
    selectResource,
    openCreate,
    showBooking,
    submitBooking,
    editBooking,
    cancelBooking,
    changeBooking,
    equipment,
    deskFeatures,
    nearbyContext,
  };
}
