import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Building2, Check, Clock3, Layers, MapPin, Save } from 'lucide-react';
import type { OfficeConfig } from '../model';
import { useOffices } from '../offices/OfficeProvider';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../api/client';
import AdminShell from './AdminShell';
import { officePlanPath } from './routes';
import './office-page.css';

const DAYS = [
  ['mon', 'Понедельник'],
  ['tue', 'Вторник'],
  ['wed', 'Среда'],
  ['thu', 'Четверг'],
  ['fri', 'Пятница'],
  ['sat', 'Суббота'],
  ['sun', 'Воскресенье'],
] as const;

type OfficeHours = OfficeConfig['hours'];
type DayKey = (typeof DAYS)[number][0];
interface OfficeDraft {
  name: string;
  address: string;
  hours: OfficeHours;
}
type FormErrors = Partial<Record<'name' | 'address' | DayKey, string>>;

function copyHours(hours: OfficeHours): OfficeHours {
  const result = Object.fromEntries(
    Object.entries(hours).map(([day, value]) => [day, { ...value }]),
  );
  for (const [day] of DAYS) result[day] ??= { enabled: false, start: '09:00', end: '19:00' };
  return result;
}

function readDraft(office: OfficeConfig): OfficeDraft {
  return { name: office.name, address: office.address || '', hours: copyHours(office.hours) };
}

function draftKey(draft: OfficeDraft): string {
  return JSON.stringify({
    ...draft,
    hours: Object.fromEntries(Object.entries(draft.hours).sort(([a], [b]) => a.localeCompare(b))),
  });
}

function validate(draft: OfficeDraft): FormErrors {
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

function normalizedHours(hours: OfficeHours): OfficeHours {
  const result = copyHours(hours);
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  for (const [day] of DAYS) {
    if (result[day].enabled) continue;
    if (!time.test(result[day].start)) result[day].start = '09:00';
    if (!time.test(result[day].end)) result[day].end = '19:00';
  }
  return result;
}

function objectLabel(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'объектов';
  if (count % 10 === 1) return 'объект';
  if (count % 10 >= 2 && count % 10 <= 4) return 'объекта';
  return 'объектов';
}

export default function OfficePage({ office }: { office: OfficeConfig }) {
  const { updateOfficeSettings } = useOffices();
  const { user } = useAuth();
  const owner = `${user?.id || ''}:${office.id}`;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const active = useRef(true);
  const requestId = useRef(0);
  const [draft, setDraft] = useState(() => readDraft(office));
  const [baseline, setBaseline] = useState(() => draftKey(readDraft(office)));
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const officeId = useRef(office.id);
  const baselineRevision = useRef(office.revision);
  const dirty = draftKey(draft) !== baseline;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      requestId.current++;
    };
  }, [owner]);
  useEffect(() => {
    if (!dirty) return;
    const beforeunload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeunload);
    return () => window.removeEventListener('beforeunload', beforeunload);
  }, [dirty]);

  useEffect(() => {
    const changedOffice = officeId.current !== office.id;
    if (changedOffice || !dirty) {
      const next = readDraft(office);
      setDraft((previous) => (draftKey(previous) === draftKey(next) ? previous : next));
      setBaseline(draftKey(next));
      baselineRevision.current = office.revision;
      if (changedOffice) {
        setErrors({});
        setError('');
        setSaved(false);
        setConflict(false);
      }
      officeId.current = office.id;
    }
  }, [office, dirty]);

  useEffect(() => {
    document.title = `${office.name} — Настройки офиса`;
  }, [office.name]);

  function edit(update: Partial<OfficeDraft>) {
    setDraft((previous) => ({ ...previous, ...update }));
    setSaved(false);
    setError('');
  }

  function editDay(key: DayKey, update: Partial<OfficeHours[string]>) {
    setDraft((previous) => ({
      ...previous,
      hours: { ...previous.hours, [key]: { ...previous.hours[key], ...update } },
    }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setSaved(false);
    setError('');
  }

  function resetDraft() {
    if (saving) return;
    const next = readDraft(office);
    setDraft(next);
    setBaseline(draftKey(next));
    baselineRevision.current = office.revision;
    setErrors({});
    setError('');
    setSaved(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || conflict) return;
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    setSaved(false);
    setError('');
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    const request = ++requestId.current;
    try {
      // The settings endpoint preserves the server's current floors atomically.
      const next = await updateOfficeSettings(
        office.id,
        {
          name: draft.name.trim(),
          address: draft.address.trim() || undefined,
          hours: normalizedHours(draft.hours),
        },
        baselineRevision.current,
      );
      if (!active.current || ownerRef.current !== owner || request !== requestId.current) return;
      const clean = readDraft(next);
      baselineRevision.current = next.revision;
      setDraft(clean);
      setBaseline(draftKey(clean));
      setSaved(true);
    } catch (cause) {
      if (active.current && ownerRef.current === owner && request === requestId.current) {
        if (cause instanceof ApiError && cause.status === 409) {
          setConflict(true);
          setError(
            'Офис изменён в другом окне. Ваши настройки не сохранены. Откройте актуальную версию и внесите правки снова.',
          );
        } else
          setError(
            cause instanceof Error ? cause.message : 'Не удалось сохранить настройки офиса.',
          );
      }
    } finally {
      if (active.current && ownerRef.current === owner && request === requestId.current)
        setSaving(false);
    }
  }

  const enabledDays = DAYS.filter(([day]) => draft.hours[day].enabled).length;

  return (
    <AdminShell section="offices" office={office} view="settings">
      <section className="adm-content office-detail">
        <div className="adm-page-heading office-detail-heading">
          <div className="office-detail-title">
            <span className="adm-eyebrow">НАСТРОЙКИ ОФИСА</span>
            <h1>{office.name}</h1>
            <p>
              <MapPin size={14} />
              <span>{office.address || 'Адрес не указан'}</span>
            </p>
          </div>
          <a className="adm-primary" href={officePlanPath(office.id)}>
            Редактировать план
            <ArrowUpRight size={16} />
          </a>
        </div>

        <form className="office-detail-form" onSubmit={handleSave} noValidate>
          <div className="office-detail-grid">
            <section
              className="office-detail-card office-detail-general"
              aria-labelledby="office-general-heading"
            >
              <div className="office-detail-card-heading">
                <span className="office-detail-card-icon">
                  <Building2 size={20} />
                </span>
                <div>
                  <h2 id="office-general-heading">Общие сведения</h2>
                  <p>Название и адрес пространства</p>
                </div>
              </div>
              <label className="office-detail-field" htmlFor="office-name">
                <span>
                  Название офиса <i>*</i>
                </span>
                <input
                  id="office-name"
                  name="officeName"
                  disabled={saving || conflict}
                  autoComplete="organization"
                  value={draft.name}
                  onChange={(event) => {
                    edit({ name: event.target.value });
                    setErrors((previous) => ({ ...previous, name: undefined }));
                  }}
                  maxLength={80}
                  required
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? 'office-name-error' : 'office-name-hint'}
                  placeholder="Например, офис на Лесной"
                />
                {errors.name ? (
                  <small className="office-detail-field-error" id="office-name-error">
                    {errors.name}
                  </small>
                ) : (
                  <small id="office-name-hint">Так офис отображается в списке и на плане.</small>
                )}
              </label>
              <label className="office-detail-field" htmlFor="office-address">
                <span>
                  Адрес <em>необязательно</em>
                </span>
                <input
                  id="office-address"
                  name="officeAddress"
                  disabled={saving || conflict}
                  autoComplete="street-address"
                  value={draft.address}
                  onChange={(event) => {
                    edit({ address: event.target.value });
                    setErrors((previous) => ({ ...previous, address: undefined }));
                  }}
                  maxLength={160}
                  aria-invalid={!!errors.address}
                  aria-describedby={errors.address ? 'office-address-error' : undefined}
                  placeholder="Город, улица, дом"
                />
                {errors.address && (
                  <small className="office-detail-field-error" id="office-address-error">
                    {errors.address}
                  </small>
                )}
              </label>
              <div className="office-detail-general-note">
                <Layers size={16} />
                <p>Планы этажей и объекты на них редактируются в конструкторе.</p>
              </div>
            </section>

            <section
              className="office-detail-card office-detail-hours"
              aria-labelledby="office-hours-heading"
            >
              <div className="office-detail-card-heading">
                <span className="office-detail-card-icon">
                  <Clock3 size={20} />
                </span>
                <div>
                  <h2 id="office-hours-heading">Рабочие часы</h2>
                  <p>Единое расписание для всех ресурсов офиса</p>
                </div>
                <span className="office-detail-timezone">МСК</span>
              </div>
              <div className="office-detail-hours-list">
                {DAYS.map(([key, label]) => {
                  const day = draft.hours[key];
                  return (
                    <div
                      className={'office-detail-day' + (!day.enabled ? ' is-closed' : '')}
                      key={key}
                    >
                      <label className="office-detail-day-label">
                        <span className="office-detail-switch">
                          <input
                            type="checkbox"
                            disabled={saving || conflict}
                            checked={day.enabled}
                            onChange={(event) => editDay(key, { enabled: event.target.checked })}
                            aria-label={`${label} — рабочий день`}
                          />
                          <span aria-hidden="true" />
                        </span>
                        <span>
                          <b>{label}</b>
                          <small>{day.enabled ? 'Рабочий день' : 'Выходной'}</small>
                        </span>
                      </label>
                      <div className="office-detail-time-range">
                        <label>
                          <span className="office-detail-sr-only">
                            Начало работы, {label.toLocaleLowerCase('ru')}
                          </span>
                          <input
                            type="time"
                            step={300}
                            value={day.start}
                            disabled={saving || conflict || !day.enabled}
                            onInput={(event) => editDay(key, { start: event.currentTarget.value })}
                            onChange={(event) => editDay(key, { start: event.currentTarget.value })}
                            aria-invalid={!!errors[key]}
                            aria-describedby={errors[key] ? `office-hours-${key}-error` : undefined}
                          />
                        </label>
                        <span aria-hidden="true">—</span>
                        <label>
                          <span className="office-detail-sr-only">
                            Окончание работы, {label.toLocaleLowerCase('ru')}
                          </span>
                          <input
                            type="time"
                            step={300}
                            value={day.end}
                            disabled={saving || conflict || !day.enabled}
                            onInput={(event) => editDay(key, { end: event.currentTarget.value })}
                            onChange={(event) => editDay(key, { end: event.currentTarget.value })}
                            aria-invalid={!!errors[key]}
                            aria-describedby={errors[key] ? `office-hours-${key}-error` : undefined}
                          />
                        </label>
                      </div>
                      {errors[key] && (
                        <p className="office-detail-day-error" id={`office-hours-${key}-error`}>
                          {errors[key]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="office-detail-hours-note">
                Московское время ·{' '}
                {enabledDays === 0
                  ? 'Все дни отмечены выходными'
                  : `${enabledDays} ${enabledDays === 1 ? 'рабочий день' : enabledDays < 5 ? 'рабочих дня' : 'рабочих дней'} в неделю`}
              </p>
            </section>
          </div>

          {error && (
            <div className="adm-error office-detail-error" role="alert">
              {error}
              {conflict && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  style={{ marginLeft: 12, textDecoration: 'underline' }}
                >
                  Открыть актуальные настройки
                </button>
              )}
            </div>
          )}
          <div className="office-detail-savebar">
            <div className="office-detail-save-status" role="status" aria-live="polite">
              {saved ? (
                <span className="is-saved">
                  <Check size={15} />
                  Изменения сохранены
                </span>
              ) : dirty ? (
                <span className="is-dirty">
                  <i />
                  Есть несохранённые изменения
                </span>
              ) : (
                <span>Настройки сохранены</span>
              )}
            </div>
            <div className="office-detail-save-actions">
              <button
                className="adm-secondary"
                type="button"
                onClick={resetDraft}
                disabled={!dirty || saving || conflict}
              >
                Отменить
              </button>
              <button className="adm-primary" type="submit" disabled={!dirty || saving || conflict}>
                <Save size={15} />
                {saving ? 'Сохранение…' : 'Сохранить изменения'}
              </button>
            </div>
          </div>
        </form>

        <section
          className="office-detail-card office-detail-floors"
          aria-labelledby="office-floors-heading"
        >
          <div className="office-detail-card-heading">
            <span className="office-detail-card-icon">
              <Layers size={20} />
            </span>
            <div>
              <h2 id="office-floors-heading">
                Этажи <span>{office.floors.length}</span>
              </h2>
              <p>Планы и объекты пространства</p>
            </div>
            <a href={officePlanPath(office.id)} className="office-detail-plan-link">
              Открыть план
              <ArrowUpRight size={14} />
            </a>
          </div>
          <ul className="office-detail-floor-list">
            {office.floors.map((floor, index) => (
              <li key={floor.id}>
                <span className="office-detail-floor-number">{index + 1}</span>
                <div>
                  <b>{floor.name}</b>
                  <span>
                    {floor.elements.length} {objectLabel(floor.elements.length)}
                  </span>
                </div>
                <span
                  className={
                    'office-detail-floor-underlay' + (floor.background ? ' has-underlay' : '')
                  }
                >
                  {floor.background ? 'План загружен' : 'Без подложки'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </AdminShell>
  );
}
