import type { TimeRange } from '../types';
export function readableDate(date: string, weekday = false): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(weekday ? { weekday: 'long' as const } : {}),
  }).format(new Date(date + 'T12:00:00Z'));
}
export function nextDate(date: string, delta: number): string {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
export function durationLabel(range: TimeRange): string {
  const minutes = Math.max(0, range.end - range.start);
  return (
    (Math.floor(minutes / 60) ? Math.floor(minutes / 60) + ' ч' : '') +
    (minutes % 60 ? ' ' + (minutes % 60) + ' мин' : '')
  );
}

export function moscowMinute(): number {
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

export function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + 'T12:00:00Z')) &&
    new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date
  );
}
