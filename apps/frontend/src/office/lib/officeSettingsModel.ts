import type { OfficeConfig } from '../lib/officeModel';
export const DAYS = [
  ['mon', 'Понедельник'],
  ['tue', 'Вторник'],
  ['wed', 'Среда'],
  ['thu', 'Четверг'],
  ['fri', 'Пятница'],
  ['sat', 'Суббота'],
  ['sun', 'Воскресенье'],
] as const;
export type OfficeHours = OfficeConfig['hours'];
export type DayKey = (typeof DAYS)[number][0];
export interface OfficeDraft {
  name: string;
  address: string;
  hours: OfficeHours;
}
export type FormErrors = Partial<Record<'name' | 'address' | DayKey, string>>;
export function copyHours(hours: OfficeHours): OfficeHours {
  const result = Object.fromEntries(
    Object.entries(hours).map(([day, value]) => [day, { ...value }]),
  );
  for (const [day] of DAYS) result[day] ??= { enabled: false, start: '09:00', end: '19:00' };
  return result;
}
export function readDraft(office: OfficeConfig): OfficeDraft {
  return { name: office.name, address: office.address || '', hours: copyHours(office.hours) };
}
export function draftKey(draft: OfficeDraft): string {
  return JSON.stringify({
    ...draft,
    hours: Object.fromEntries(Object.entries(draft.hours).sort(([a], [b]) => a.localeCompare(b))),
  });
}
export function validate(draft: OfficeDraft): FormErrors {
  const errors: FormErrors = {};
  const name = draft.name.trim();
  if (!name || name.length > 80) errors.name = 'Введите название от 1 до 80 символов.';
  if (draft.address.trim().length > 160)
    errors.address = 'Адрес должен быть не длиннее 160 символов.';
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  for (const [key] of DAYS) {
    const day = draft.hours[key];
    if (!day.enabled) continue;
    if (!time.test(day.start) || !time.test(day.end))
      errors[key] = 'Укажите время начала и окончания.';
    else if (day.start >= day.end)
      errors[key] = 'Окончание должно быть позже начала, в пределах одного дня.';
  }
  return errors;
}
export function normalizedHours(hours: OfficeHours): OfficeHours {
  const result = copyHours(hours);
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  for (const [day] of DAYS) {
    if (result[day].enabled) continue;
    if (!time.test(result[day].start)) result[day].start = '09:00';
    if (!time.test(result[day].end)) result[day].end = '19:00';
  }
  return result;
}
export function objectLabel(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'объектов';
  if (count % 10 === 1) return 'объект';
  if (count % 10 >= 2 && count % 10 <= 4) return 'объекта';
  return 'объектов';
}
