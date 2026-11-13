import type { BookingProposal } from '../api/client';
import type { OfficeConfig } from '../model';
import { getResources } from './bookingModel';

/** Form values only. A link never contains an owner or authorizes a command. */
export interface BookingPrefill {
  officeId: string;
  floorId: string;
  resourceId: string;
  /** Empty when absent or already past in Moscow; the user must choose a date. */
  date: string;
  start?: number;
  end?: number;
  participants?: number;
}

export class BookingLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingLinkError';
  }
}

const KEYS = ['officeId', 'floorId', 'resourceId', 'date', 'start', 'end', 'participants'] as const;
const allowed = new Set<string>(KEYS);
const invalid = (
  message = 'Ссылка на форму бронирования содержит некорректные параметры.',
): never => {
  throw new BookingLinkError(message);
};

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > 1000 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return invalid();
  return value;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function moscowDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) return invalid('Не удалось определить текущую дату.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function number(value: unknown, minimum: number, maximum: number): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  )
    return invalid();
  return parsed;
}

function readParams(input: string | URLSearchParams): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  if (input.length > 12000 || /[\u0000-\u001f\u007f]/.test(input)) return invalid();
  let search = input;
  if (input && !input.startsWith('?')) {
    const origin =
      typeof window === 'undefined' ? 'http://booking.invalid' : window.location.origin;
    let url: URL;
    try {
      url = new URL(input, origin);
    } catch {
      return invalid('Некорректный адрес формы бронирования.');
    }
    if (
      url.origin !== origin ||
      url.pathname !== '/booking' ||
      url.hash ||
      url.username ||
      url.password
    )
      return invalid('Ссылка должна вести на форму бронирования этого сервиса.');
    search = url.search;
  }
  if (/%(?![\da-f]{2})/i.test(search)) return invalid();
  try {
    decodeURIComponent(search.replace(/\+/g, ' '));
  } catch {
    return invalid();
  }
  return new URLSearchParams(search);
}

/** Parse an internal URL or query. No parameters means an ordinary booking page. */
export function parseBookingLink(
  input: string | URLSearchParams,
  now = new Date(),
): BookingPrefill | null {
  const params = readParams(input);
  if (!params.size) return null;
  for (const key of params.keys()) {
    if (!allowed.has(key)) return invalid('Ссылка содержит неподдерживаемые параметры формы.');
    if (params.getAll(key).length !== 1) return invalid('В ссылке повторяются параметры формы.');
  }
  const result: BookingPrefill = {
    officeId: identifier(params.get('officeId')),
    floorId: identifier(params.get('floorId')),
    resourceId: identifier(params.get('resourceId')),
    date: '',
  };
  if (params.has('date')) {
    const date = params.get('date')!;
    if (!validDate(date)) return invalid('Дата в ссылке некорректна.');
    if (date >= moscowDate(now)) result.date = date;
  }
  if (params.has('start')) result.start = number(params.get('start'), 0, 1439);
  if (params.has('end')) result.end = number(params.get('end'), 1, 1440);
  if (result.start !== undefined && result.end !== undefined && result.start >= result.end)
    return invalid('Окончание брони в ссылке должно быть позже начала.');
  if (params.has('participants'))
    result.participants = number(params.get('participants'), 1, Number.MAX_SAFE_INTEGER);
  return result;
}

/** Check the current server document, without enriching or modifying its resources. */
export function validateBookingLink(prefill: BookingPrefill, office: OfficeConfig): BookingPrefill {
  if (office.id !== prefill.officeId)
    return invalid('Офис из ссылки недоступен или больше не существует.');
  const floor = office.floors.find((item) => item.id === prefill.floorId);
  if (!floor) return invalid('Этаж из ссылки больше не существует.');
  const resource = getResources(floor).find((item) => item.id === prefill.resourceId);
  if (!resource) return invalid('Пространство из ссылки недоступно для бронирования.');
  if (prefill.participants !== undefined && resource.kind !== 'room')
    return invalid('Число участников можно указать только для переговорной.');
  return { ...prefill };
}

function proposalFields(proposal: BookingProposal): BookingPrefill {
  const result: BookingPrefill = {
    officeId: identifier(proposal.officeId),
    floorId: identifier(proposal.floorId),
    resourceId: identifier(proposal.resourceId),
    date: '',
  };
  if (proposal.date !== undefined && proposal.date !== null && proposal.date !== '') {
    if (typeof proposal.date !== 'string' || !validDate(proposal.date))
      return invalid('Дата предложения некорректна.');
    result.date = proposal.date;
  }
  const start =
    proposal.start === undefined || proposal.start === null
      ? undefined
      : number(proposal.start, 0, 1439);
  const end =
    proposal.end === undefined || proposal.end === null ? undefined : number(proposal.end, 1, 1440);
  if (start !== undefined && end !== undefined && start >= end)
    return invalid('Окончание предложения должно быть позже начала.');
  if (start !== undefined) result.start = start;
  if (end !== undefined) result.end = end;
  if (proposal.participants !== undefined && proposal.participants !== null)
    result.participants = number(proposal.participants, 1, Number.MAX_SAFE_INTEGER);
  return result;
}

/** Internal assistant proposals are form data, with no URL navigation. */
export function proposalToBookingPrefill(
  proposal: BookingProposal,
  now = new Date(),
): BookingPrefill {
  const result = proposalFields(proposal);
  if (result.date && result.date < moscowDate(now)) result.date = '';
  return result;
}

/** External MCP clients still receive a relative confirmation URL. */
export function buildBookingLink(proposal: BookingProposal): string {
  const result = proposalFields(proposal);
  const params = new URLSearchParams({
    officeId: result.officeId,
    floorId: result.floorId,
    resourceId: result.resourceId,
  });
  if (result.date) params.set('date', result.date);
  if (result.start !== undefined) params.set('start', String(result.start));
  if (result.end !== undefined) params.set('end', String(result.end));
  if (result.participants !== undefined) params.set('participants', String(result.participants));
  return `/booking?${params}`;
}
