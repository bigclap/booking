import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { OfficeConfig } from '../model';
import { getRoomCapacity } from '../model';
import { useAuth } from '../auth/AuthProvider';
import type { AppUser } from '../auth/types';
import BookingTimeline from '../client/BookingTimeline';
import {
  getMoscowDate,
  getOfficeHours,
  getResources,
  isWorkplace,
  minutesToTime,
  timeToMinutes,
} from '../client/bookingModel';
import { useBookings } from '../client/useBookings';
import type { ClientBooking } from '../client/types';
import BookingDetails from '../client/BookingDetails';
import { getBookingResourceDetails, isBookingHistorical } from '../client/bookingDetails';
import AdminShell from './AdminShell';
import './bookings.css';

type Draft = {
  id?: string;
  source?: ClientBooking;
  floorId: string;
  resourceId: string;
  ownerId: string;
  date: string;
  start: string;
  end: string;
  participants: string;
};
const fullName = (person: AppUser) => `${person.firstName} ${person.lastName}`;
const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Не удалось сохранить изменение.';
const readableDate = (date: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(date + 'T12:00:00Z'),
  );
function dateAfter(date: string, days: number) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + 'T12:00:00Z')) &&
    new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date
  );
}
function moscowMinute() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  return (
    Number(parts.find((part) => part.type === 'hour')?.value) * 60 +
    Number(parts.find((part) => part.type === 'minute')?.value)
  );
}
export default function BookingsPage({ office }: { office: OfficeConfig }) {
  const { user, users } = useAuth();
  const data = useBookings(office.id);
  const bookings = data.bookings;
  const [date, setDate] = useState(getMoscowDate);
  const [floorId, setFloorId] = useState(office.floors[0].id);
  const floor = office.floors.find((item) => item.id === floorId) || office.floors[0];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timelineFocus, setTimelineFocus] = useState<{ id: string; token: number } | null>(null);
  const timelineFocusSequence = useRef(0);
  const consumeTimelineFocus = useCallback(
    (token: number) => setTimelineFocus((current) => (current?.token === token ? null : current)),
    [],
  );
  const [cursorMinute, setCursorMinute] = useState(14 * 60);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = saving || data.saving;
  const step = data.policy?.stepMinutes || 5;
  const formRef = useRef<HTMLElement>(null);
  const timelineCardRef = useRef<HTMLDivElement>(null);
  const [maxTimelineHeight, setMaxTimelineHeight] = useState(() =>
    Math.max(140, window.innerHeight - 450),
  );
  const submitting = useRef(false);
  const hours = getOfficeHours(office, date);
  const availableOwners = users.filter(
    (person) =>
      person.active && (person.role === 'admin' || person.buildingIds.includes(office.id)),
  );
  const resources = getResources(floor);
  const visibleBookings = bookings.filter(
    (item) => item.floorId === floor.id && item.date === date,
  );
  const active = visibleBookings.filter((item) => item.status === 'active');
  const cancelled = bookings.filter(
    (item) =>
      item.date === date &&
      item.status === 'cancelled' &&
      (item.floorId === floor.id || !office.floors.some((level) => level.id === item.floorId)),
  );
  const retainedBookings = bookings
    .filter(
      (item) =>
        item.date === date &&
        item.status === 'active' &&
        (item.floorId === floor.id || !office.floors.some((level) => level.id === item.floorId)),
    )
    .filter((item) => {
      const level = office.floors.find((candidate) => candidate.id === item.floorId);
      return (
        item.needsReview ||
        !level ||
        !getResources(level).some((resource) => resource.id === item.resourceId)
      );
    });
  const formFloor = office.floors.find((item) => item.id === draft?.floorId) || floor;
  const formResources = getResources(formFloor);
  const formResource = formResources.find((item) => item.id === draft?.resourceId);
  const formHours = getOfficeHours(office, draft?.date || date);
  const currentBooking = draft?.id ? bookings.find((item) => item.id === draft.id) : null;
  const recordBooking = currentBooking || draft?.source;
  const recordDetails = recordBooking
    ? getBookingResourceDetails(recordBooking, office, {
        preferSnapshot: isBookingHistorical(recordBooking, data.serverNow),
      })
    : null;
  const recordCancelled = recordBooking?.status === 'cancelled';
  const overCapacity =
    formResource?.kind === 'room' && Number(draft?.participants) > getRoomCapacity(formResource);

  useEffect(() => {
    const card = timelineCardRef.current;
    if (!card) return;
    const main = card.closest<HTMLElement>('.adm-main');
    const measure = () => {
      // Use the unscrolled content position: scrolling must not grow the diagram.
      const contentTop = card.getBoundingClientRect().top + (main?.scrollTop ?? 0);
      const available = Math.max(140, Math.floor(window.innerHeight - contentTop - 20));
      setMaxTimelineHeight((previous) => (previous === available ? previous : available));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    if (card.parentElement) observer.observe(card.parentElement);
    measure();
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    document.title = `Бронирования · ${office.name} — Планировка`;
  }, [office.name]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4800);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!draft) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting.current) setDraft(null);
      if (event.key !== 'Tab' || !formRef.current) return;
      const elements = [
        ...formRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
        ),
      ];
      const first = elements[0],
        last = elements[elements.length - 1];
      if (!first) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === formRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [draft?.id, !!draft]);

  function requireAvailable() {
    if (user?.role !== 'admin') throw new Error('Управление бронями доступно администратору.');
    if (!data.available)
      throw new Error('Занятость сейчас недоступна. Обновите расписание перед изменением.');
  }
  function requireRevision(source: ClientBooking | undefined): ClientBooking {
    if (!source || !Number.isInteger(source.revision))
      throw new Error(
        'Не удалось определить версию брони. Обновите расписание и откройте запись снова.',
      );
    return source;
  }
  function chooseDate(next: string) {
    if (busy || !validDate(next)) return;
    setDate(next);
    setDraft(null);
    setFormError('');
    setSelectedId(null);
  }
  function chooseFloor(id: string) {
    if (busy) return;
    setFloorId(id);
    setSelectedId(null);
    setDraft(null);
    setFormError('');
  }
  function openCreate(resourceId?: string, minute?: number) {
    if (!data.available || busy) return;
    const resource = resources.find((item) => item.id === resourceId) || resources[0];
    const start = Math.max(
      hours.start,
      Math.min(hours.end - step, Math.round((minute ?? cursorMinute) / step) * step),
    );
    setDraft({
      floorId: floor.id,
      resourceId: resource?.id || '',
      ownerId: '',
      date,
      start: minutesToTime(start),
      end: minutesToTime(Math.min(hours.end, start + 60)),
      participants: '1',
    });
    setFormError('');
    setSelectedId(resource?.id || null);
    setCursorMinute(start);
  }
  function openBooking(booking: ClientBooking) {
    if (!data.available || busy) return;
    setDate(booking.date);
    setFloorId(booking.floorId);
    setSelectedId(booking.resourceId);
    setCursorMinute(booking.start);
    setDraft({
      id: booking.id,
      source: { ...booking },
      floorId: booking.floorId,
      resourceId: booking.resourceId,
      ownerId: booking.ownerId,
      date: booking.date,
      start: minutesToTime(booking.start),
      end: minutesToTime(booking.end),
      participants: String(booking.participants || 1),
    });
    setFormError('');
  }
  function validate(
    floorId: string,
    resourceId: string,
    bookingDate: string,
    start: number,
    end: number,
  ) {
    if (!validDate(bookingDate)) throw new Error('Выберите корректную дату.');
    const targetFloor = office.floors.find((item) => item.id === floorId);
    if (!targetFloor || !getResources(targetFloor).some((item) => item.id === resourceId))
      throw new Error('Выберите доступное помещение или рабочее место.');
    const dayHours = getOfficeHours(office, bookingDate);
    if (!dayHours.enabled) throw new Error('В этот день офис закрыт. Выберите другую дату.');
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > 1440 ||
      end <= start
    )
      throw new Error('Окончание должно быть позже начала.');
    if (start % step !== 0 || end % step !== 0)
      throw new Error(`Начало и окончание задаются с шагом ${step} минут.`);
    if (start < dayHours.start || end > dayHours.end)
      throw new Error(
        `Рабочие часы: ${minutesToTime(dayHours.start)}–${minutesToTime(dayHours.end)}.`,
      );
    return targetFloor;
  }
  function revealSavedBooking(booking: ClientBooking) {
    setDate(booking.date);
    setFloorId(booking.floorId);
    setSelectedId(booking.resourceId);
    setCursorMinute(booking.start);
    setDraft(null);
    setTimelineFocus({ id: booking.id, token: ++timelineFocusSequence.current });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || submitting.current || busy) return;
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      requireAvailable();
      const source = draft.id ? requireRevision(draft.source) : undefined;
      const start = timeToMinutes(draft.start),
        end = timeToMinutes(draft.end);
      const targetFloor = validate(draft.floorId, draft.resourceId, draft.date, start, end);
      const target = getResources(targetFloor).find((item) => item.id === draft.resourceId)!;
      const owner = availableOwners.find((person) => person.id === draft.ownerId);
      const preservesOwner = source?.ownerId === draft.ownerId;
      if (!owner && !preservesOwner)
        throw new Error('Выберите активного сотрудника с доступом к этому офису.');
      const participants = Number(draft.participants);
      if (target.kind === 'room' && (!Number.isInteger(participants) || participants < 1))
        throw new Error('Укажите целое число участников, не меньше одного.');
      const input = {
        floorId: targetFloor.id,
        resourceId: target.id,
        ownerId: draft.ownerId,
        date: draft.date,
        start,
        end,
        participants: target.kind === 'room' ? participants : undefined,
      };
      const result = source ? await data.update(source, input) : await data.create(input);
      revealSavedBooking(result);
      setPageError('');
      setNotice(source ? 'Изменения брони сохранены' : 'Бронь создана');
    } catch (cause) {
      setFormError(errorText(cause));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  async function changeBooking(id: string, start: number, end: number, destinationId?: string) {
    if (busy || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      requireAvailable();
      const booking = requireRevision(
        bookings.find((item) => item.id === id && item.status === 'active'),
      );
      const resourceId = destinationId || booking.resourceId;
      const targetFloor = validate(floor.id, resourceId, booking.date, start, end);
      const target = getResources(targetFloor).find((item) => item.id === resourceId)!;
      const result = await data.update(booking, {
        resourceId,
        floorId: targetFloor.id,
        date: booking.date,
        start,
        end,
        ownerId: booking.ownerId,
        participants: target.kind === 'room' ? booking.participants || 1 : undefined,
      });
      revealSavedBooking(result);
      setNotice('Бронь изменена');
      setPageError('');
    } catch (cause) {
      setPageError(errorText(cause));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  async function cancelBooking() {
    if (!draft?.id || submitting.current || busy) return;
    submitting.current = true;
    setSaving(true);
    setFormError('');
    try {
      requireAvailable();
      const result = await data.cancel(requireRevision(draft.source));
      setDraft(null);
      setPageError('');
      setNotice(
        result.status === 'cancelled'
          ? 'Бронь отменена. Запись сохранена в истории.'
          : 'Бронь завершена. Прошедшая часть сохранена.',
      );
    } catch (cause) {
      setFormError(errorText(cause));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  function patchDraft(patch: Partial<Draft>) {
    if (submitting.current) return;
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setFormError('');
  }
  function selectFormFloor(id: string) {
    const target = office.floors.find((item) => item.id === id);
    if (!target) return;
    const resource = getResources(target)[0];
    patchDraft({ floorId: id, resourceId: resource?.id || '' });
    setFloorId(id);
    setSelectedId(resource?.id || null);
  }
  function savedRecord(booking: ClientBooking) {
    const details = getBookingResourceDetails(booking, office, {
      preferSnapshot: isBookingHistorical(booking, data.serverNow),
    });
    return (
      <article className="ab-saved-record" key={booking.id}>
        <button type="button" onClick={() => openBooking(booking)} disabled={busy}>
          <span>
            <b>{details.name}</b>
            <small>
              {details.floorName} · {booking.ownerName}
            </small>
          </span>
          <time>
            {minutesToTime(booking.start)}–{minutesToTime(booking.end)}
          </time>
        </button>
        <BookingDetails booking={booking} compact />
      </article>
    );
  }
  const dateControl = (
    <div className="ab-date-controls">
      <button
        type="button"
        aria-label="Предыдущий день расписания"
        disabled={busy}
        onClick={() => chooseDate(dateAfter(date, -1))}
      >
        <ArrowLeft size={14} />
      </button>
      <label>
        <CalendarDays size={14} />
        <span>{readableDate(date)}</span>
        <input
          aria-label="Дата административного расписания"
          type="date"
          value={date}
          disabled={busy}
          onInput={(event) => chooseDate(event.currentTarget.value)}
          onChange={(event) => chooseDate(event.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label="Следующий день расписания"
        disabled={busy}
        onClick={() => chooseDate(dateAfter(date, 1))}
      >
        <ArrowRight size={14} />
      </button>
    </div>
  );

  return (
    <AdminShell
      section="offices"
      office={office}
      view="bookings"
      overlays={
        <>
          {notice && (
            <div className="ab-toast" role="status">
              <CheckCircle2 size={17} />
              {notice}
              <button type="button" aria-label="Закрыть уведомление" onClick={() => setNotice('')}>
                <X size={14} />
              </button>
            </div>
          )}
          {draft && (
            <div
              className="ab-form-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) setDraft(null);
              }}
            >
              <section
                ref={formRef}
                tabIndex={-1}
                className="ab-form-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ab-form-title"
              >
                <div className="ab-form-heading">
                  <div>
                    <span>{draft.id ? 'УПРАВЛЕНИЕ ЗАПИСЬЮ' : 'НОВАЯ ЗАПИСЬ'}</span>
                    <h2 id="ab-form-title">
                      {recordCancelled
                        ? 'Запись о брони'
                        : draft.id
                          ? 'Редактирование брони'
                          : 'Новая бронь'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    aria-label="Закрыть редактор брони"
                    onClick={() => setDraft(null)}
                    disabled={busy}
                  >
                    <X size={19} />
                  </button>
                </div>
                <form onSubmit={submit}>
                  <div className="ab-form-body">
                    {recordBooking && (
                      <>
                        <div className="booking-record-summary">
                          <b>{recordDetails?.name}</b>
                          <span>{recordDetails?.floorName}</span>
                          <small>
                            {isBookingHistorical(recordBooking, data.serverNow) &&
                            recordDetails?.snapshot
                              ? 'Данные пространства на момент бронирования'
                              : recordDetails?.removed
                                ? 'Пространство больше не доступно на плане'
                                : 'Сохранённая запись о брони'}
                          </small>
                        </div>
                        <BookingDetails booking={recordBooking} />
                      </>
                    )}
                    <fieldset className="ab-edit-fields" disabled={busy || recordCancelled}>
                      <label className="ab-field">
                        Владелец брони
                        <select
                          aria-label="Владелец брони"
                          required
                          value={draft.ownerId}
                          onChange={(event) => patchDraft({ ownerId: event.target.value })}
                          disabled={busy || currentBooking?.status === 'cancelled'}
                        >
                          <option value="">Выберите сотрудника</option>
                          {draft.ownerId &&
                            !availableOwners.some((person) => person.id === draft.ownerId) && (
                              <option value={draft.ownerId}>
                                {draft.source?.ownerName || 'Прежний владелец'} · без доступа
                              </option>
                            )}
                          {availableOwners.map((person) => (
                            <option key={person.id} value={person.id}>
                              {fullName(person)}
                              {person.id === user?.id ? ' · вы' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="ab-field">
                        <span>Этаж</span>
                        {!office.floors.some((item) => item.id === draft.floorId) && (
                          <span className="ab-record-missing-floor">
                            {recordDetails?.floorName || 'Прежний этаж'} · больше не доступен
                          </span>
                        )}
                        <div className="ab-form-floors">
                          {office.floors.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={draft.floorId === item.id}
                              disabled={busy}
                              onClick={() => selectFormFloor(item.id)}
                            >
                              {item.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="ab-field">
                        Ресурс
                        <select
                          aria-label="Ресурс бронирования"
                          value={draft.resourceId}
                          required
                          disabled={busy}
                          onChange={(event) => {
                            patchDraft({ resourceId: event.target.value });
                            setSelectedId(event.target.value);
                          }}
                        >
                          <option value="">Выберите помещение или место</option>
                          {draft.resourceId &&
                            !formResources.some((item) => item.id === draft.resourceId) && (
                              <option value={draft.resourceId} disabled>
                                {recordDetails?.name || 'Прежнее пространство'} · недоступно
                              </option>
                            )}
                          <optgroup label="Помещения">
                            {formResources
                              .filter((item) => item.kind === 'room')
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="Рабочие места">
                            {formResources.filter(isWorkplace).map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                      <label className="ab-field">
                        Дата
                        <input
                          required
                          aria-label="Дата брони"
                          type="date"
                          value={draft.date}
                          disabled={busy}
                          onInput={(event) => patchDraft({ date: event.currentTarget.value })}
                          onChange={(event) => patchDraft({ date: event.target.value })}
                        />
                      </label>
                      <div className="ab-field-grid">
                        <label className="ab-field">
                          Начало
                          <input
                            required
                            type="time"
                            step={step * 60}
                            aria-label="Начало брони"
                            value={draft.start}
                            disabled={busy}
                            onInput={(event) => patchDraft({ start: event.currentTarget.value })}
                            onChange={(event) => patchDraft({ start: event.target.value })}
                          />
                        </label>
                        <label className="ab-field">
                          Окончание
                          <input
                            required
                            type="time"
                            step={step * 60}
                            aria-label="Окончание брони"
                            value={draft.end}
                            disabled={busy}
                            onInput={(event) => patchDraft({ end: event.currentTarget.value })}
                            onChange={(event) => patchDraft({ end: event.target.value })}
                          />
                        </label>
                      </div>
                      <p className="ab-hours">
                        <Clock3 size={13} />
                        {formHours.enabled
                          ? `Рабочие часы ${minutesToTime(formHours.start)}–${minutesToTime(formHours.end)}`
                          : 'В выбранный день офис закрыт'}
                      </p>
                      {formResource?.kind === 'room' && (
                        <label className="ab-field">
                          Число участников
                          <input
                            required
                            min="1"
                            type="number"
                            aria-label="Число участников"
                            value={draft.participants}
                            disabled={busy}
                            onChange={(event) => patchDraft({ participants: event.target.value })}
                          />
                        </label>
                      )}
                      {overCapacity && (
                        <p className="ab-capacity-note">
                          <Users size={15} />
                          Вместимость — {getRoomCapacity(formResource!)} мест. Участников больше,
                          чем сидячих мест.
                        </p>
                      )}
                      {draft.id && !recordCancelled && (
                        <p className="ab-record-note">
                          Владелец сохраняется при изменении времени и ресурса. Чтобы передать
                          бронь, выберите другого сотрудника.
                        </p>
                      )}
                    </fieldset>
                    {!data.available && (
                      <div className="ab-error" role="alert">
                        <span>
                          Занятость недоступна. Обновите расписание, чтобы сохранить изменение.
                        </span>
                        <button
                          type="button"
                          onClick={() => void data.refresh()}
                          disabled={data.loading || busy}
                        >
                          Обновить
                        </button>
                      </div>
                    )}
                    {formError && (
                      <p className="ab-error" role="alert">
                        <AlertCircle size={15} />
                        {formError}
                      </p>
                    )}
                  </div>
                  <div className="ab-form-footer">
                    {!recordCancelled && (
                      <button
                        type="submit"
                        className="adm-primary"
                        disabled={busy || !data.available}
                      >
                        {busy ? (
                          <LoaderCircle className="auth-spinner" size={15} />
                        ) : (
                          <Check size={15} />
                        )}{' '}
                        {draft.id ? 'Сохранить изменения' : 'Создать бронь'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="adm-secondary"
                      onClick={() => setDraft(null)}
                      disabled={busy}
                    >
                      Закрыть
                    </button>
                    {draft.id && !recordCancelled && (
                      <button
                        type="button"
                        className="ab-cancel"
                        onClick={cancelBooking}
                        disabled={busy || !data.available}
                      >
                        <Trash2 size={14} />
                        {draft.source?.date === getMoscowDate() &&
                        draft.source.start < moscowMinute() &&
                        draft.source.end > moscowMinute()
                          ? 'Завершить сейчас'
                          : 'Отменить бронь'}
                      </button>
                    )}
                  </div>
                </form>
              </section>
            </div>
          )}
        </>
      }
    >
      <div className="ab-page">
        <div className="ab-page-heading">
          <div>
            <span className="adm-eyebrow">РАСПИСАНИЕ ОФИСА</span>
            <h1>Бронирования</h1>
            <p>Все сотрудники, помещения и рабочие места.</p>
          </div>
          <button
            className="adm-primary"
            type="button"
            onClick={() => openCreate()}
            disabled={!resources.length || !data.available || busy}
          >
            <Plus size={16} />
            Новая бронь
          </button>
        </div>
        <div className="ab-toolbar">
          <div className="ab-floor-pills" role="group" aria-label="Этаж расписания">
            {office.floors.map((item) => (
              <button
                type="button"
                key={item.id}
                className={floor.id === item.id ? 'is-active' : ''}
                aria-pressed={floor.id === item.id}
                disabled={busy}
                onClick={() => chooseFloor(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="ab-summary">
            <span>
              <i />
              {data.available
                ? `${active.length} ${active.length === 1 ? 'бронь' : 'броней'}`
                : 'Занятость не загружена'}
            </span>
            <span>{readableDate(date)}</span>
          </div>
        </div>
        <p className="ab-drag-hint">
          Перетаскивайте брони любых сотрудников. Для точного изменения и смены владельца откройте
          запись.
        </p>
        {(pageError || data.error) && (
          <div className="ab-page-error" role="alert">
            <AlertCircle size={16} />
            <span>{pageError || data.error}</span>
            {data.error ? (
              <button
                type="button"
                onClick={() => void data.refresh()}
                disabled={data.loading || busy}
              >
                <RefreshCw size={15} />
                Обновить
              </button>
            ) : (
              <button type="button" onClick={() => setPageError('')} aria-label="Закрыть ошибку">
                <X size={15} />
              </button>
            )}
          </div>
        )}
        <div className="ab-timeline-card" ref={timelineCardRef}>
          {data.available ? (
            <BookingTimeline
              currentUserId={user?.id || ''}
              canManageAll
              focusBooking={timelineFocus}
              onFocusConsumed={consumeTimelineFocus}
              bookingEditMode={() => (data.available && !busy ? 'all' : 'none')}
              initialHeight={Math.max(140, window.innerHeight - 450)}
              maxPanelHeight={maxTimelineHeight}
              floor={floor}
              bookings={bookings}
              date={date}
              range={{ start: hours.start, end: hours.end }}
              dateControl={dateControl}
              hours={hours}
              cursorMinute={cursorMinute}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRangeChange={() => undefined}
              onCursorChange={setCursorMinute}
              onBookingClick={openBooking}
              onBookingChange={changeBooking}
              onCreate={openCreate}
            />
          ) : (
            <div className="ab-availability-state" role="status">
              {data.loading ? (
                <LoaderCircle size={24} className="auth-spinner" />
              ) : (
                <AlertCircle size={24} />
              )}
              <h2>{data.loading ? 'Загружаем расписание' : 'Занятость недоступна'}</h2>
              <p>
                {data.loading
                  ? 'Получаем брони выбранного офиса.'
                  : 'Пока данные не загружены, доступность мест неизвестна.'}
              </p>
              {!data.loading && (
                <button type="button" className="adm-secondary" onClick={() => void data.refresh()}>
                  <RefreshCw size={15} />
                  Попробовать снова
                </button>
              )}
            </div>
          )}
        </div>
        {data.available && retainedBookings.length > 0 && (
          <section className="ab-review-records" aria-label="Брони, требующие внимания">
            <h2>Сохранённые записи и изменения условий</h2>
            <div>{retainedBookings.map(savedRecord)}</div>
          </section>
        )}
        {data.available && cancelled.length > 0 && (
          <details
            className="ab-cancelled"
            open={historyOpen}
            onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
          >
            <summary>
              <History size={14} />
              Отменённые записи<span>{cancelled.length}</span>
            </summary>
            <div className="ab-history-records">{cancelled.map(savedRecord)}</div>
          </details>
        )}
        <p className="ab-local-note">
          История бронирований сохраняется, включая отменённые записи.
        </p>
      </div>
    </AdminShell>
  );
}
