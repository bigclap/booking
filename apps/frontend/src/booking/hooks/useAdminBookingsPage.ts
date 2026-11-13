import { validDate } from '../lib/bookingTime';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import type { Floor, PlanElement } from '../../office';
import type { AppUser } from '../../auth/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type { OfficeConfig } from '../../office';
import { getRoomCapacity } from '../../office';
import { useAuth } from '../../auth/hooks';

import {
  getMoscowDate,
  getOfficeHours,
  getResources,
  minutesToTime,
  timeToMinutes,
} from '../lib/bookingModel';
import { useBookings } from '../hooks/useBookings';
import type { ClientBooking } from '../types';

import { getBookingResourceDetails, isBookingHistorical } from '../lib/bookingDetails';

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
const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Не удалось сохранить изменение.';

type Setter<T> = Dispatch<SetStateAction<T>>;
export interface AdminBookingController {
  office: OfficeConfig;
  user: ReturnType<typeof useAuth>['user'];
  data: ReturnType<typeof useBookings>;
  bookings: ClientBooking[];
  date: string;
  floor: Floor;
  selectedId: string | null;
  setSelectedId: Setter<string | null>;
  timelineFocus: { id: string; token: number } | null;
  consumeTimelineFocus: (token: number) => void;
  cursorMinute: number;
  setCursorMinute: Setter<number>;
  draft: Draft | null;
  setDraft: Setter<Draft | null>;
  formError: string;
  pageError: string;
  setPageError: Setter<string>;
  notice: string;
  setNotice: Setter<string>;
  historyOpen: boolean;
  setHistoryOpen: Setter<boolean>;
  busy: boolean;
  step: number;
  workAreaRef: RefObject<HTMLDivElement | null>;
  maxTimelineHeight: number;
  hours: ReturnType<typeof getOfficeHours>;
  availableOwners: AppUser[];
  resources: PlanElement[];
  mapAvailable: boolean;
  cancelled: ClientBooking[];
  retainedBookings: ClientBooking[];
  formResources: PlanElement[];
  formResource: PlanElement | undefined;
  formHours: ReturnType<typeof getOfficeHours>;
  currentBooking: ClientBooking | null | undefined;
  recordBooking: ClientBooking | undefined;
  recordDetails: ReturnType<typeof getBookingResourceDetails> | null;
  recordCancelled: boolean;
  overCapacity: boolean;
  chooseDate: (date: string) => void;
  chooseFloor: (id: string) => void;
  selectResource: (id: string) => void;
  openCreate: (resourceId?: string, minute?: number) => void;
  openBooking: (booking: ClientBooking) => void;
  patchDraft: (patch: Partial<Draft>) => void;
  selectFormFloor: (id: string) => void;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  changeBooking: (id: string, start: number, end: number, destinationId?: string) => Promise<void>;
  cancelBooking: () => Promise<void>;
}

export function useAdminBookingsPage(office: OfficeConfig): AdminBookingController {
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
  const workAreaRef = useRef<HTMLDivElement>(null);
  const [maxTimelineHeight, setMaxTimelineHeight] = useState(280);
  const submitting = useRef(false);
  const hours = getOfficeHours(office, date);
  const availableOwners = users.filter(
    (person) =>
      person.active && (person.role === 'admin' || person.buildingIds.includes(office.id)),
  );
  const resources = getResources(floor);
  const mapAvailable =
    data.available && hours.enabled && cursorMinute >= hours.start && cursorMinute < hours.end;
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
    const area = workAreaRef.current;
    if (!area) return;
    const measure = () => {
      if (area.clientHeight <= 0) return;
      const mapMinimum = area.clientHeight < 340 ? 100 : 160;
      const available = Math.max(140, Math.floor(area.clientHeight - mapMinimum));
      setMaxTimelineHeight((previous) => (previous === available ? previous : available));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area);
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
  function selectResource(id: string) {
    if (busy || !resources.some((resource) => resource.id === id)) return;
    setSelectedId(id);
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
    setHistoryOpen(false);
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

  return {
    office,
    user,
    data,
    bookings,
    date,
    floor,
    selectedId,
    setSelectedId,
    timelineFocus,
    consumeTimelineFocus,
    cursorMinute,
    setCursorMinute,
    draft,
    setDraft,
    formError,
    pageError,
    setPageError,
    notice,
    setNotice,
    historyOpen,
    setHistoryOpen,
    busy,
    step,
    workAreaRef,
    maxTimelineHeight,
    hours,
    availableOwners,
    resources,
    mapAvailable,
    cancelled,
    retainedBookings,
    formResources,
    formResource,
    formHours,
    currentBooking,
    recordBooking,
    recordDetails,
    recordCancelled,
    overCapacity,
    chooseDate,
    chooseFloor,
    selectResource,
    openCreate,
    openBooking,
    patchDraft,
    selectFormFloor,
    submit,
    changeBooking,
    cancelBooking,
  };
}
