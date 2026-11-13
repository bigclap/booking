import { Field, Notice } from '../../shared/molecules';
import { Input, Switch, Button } from '../../shared/atoms';
import { Building2, Check, Clock3, Layers, Save } from 'lucide-react';
import { DAYS } from '../lib/officeSettingsModel';
import type { OfficeSettingsController } from '../hooks/useOfficeSettings';
export default function OfficeSettingsForm({
  controller,
}: {
  controller: OfficeSettingsController;
}) {
  const {
    draft,
    errors,
    setErrors,
    error,
    saved,
    saving,
    conflict,
    dirty,
    edit,
    editDay,
    resetDraft,
    handleSave,
    enabledDays,
  } = controller;
  return (
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
          <Field
            className="office-detail-field"
            htmlFor="office-name"
            label={
              <>
                Название офиса <i>*</i>
              </>
            }
          >
            <Input
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
          </Field>
          <Field
            className="office-detail-field"
            htmlFor="office-address"
            label={
              <>
                Адрес <em>необязательно</em>
              </>
            }
          >
            <Input
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
          </Field>
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
                <div className={'office-detail-day' + (!day.enabled ? ' is-closed' : '')} key={key}>
                  <label className="office-detail-day-label">
                    <Switch
                      type="checkbox"
                      disabled={saving || conflict}
                      checked={day.enabled}
                      onChange={(event) => editDay(key, { enabled: event.target.checked })}
                      aria-label={`${label} — рабочий день`}
                    />
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
                      <Input
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
                      <Input
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
        <Notice tone="error" className="office-detail-error">
          {error}
          {conflict && (
            <Button
              type="button"
              onClick={() => window.location.reload()}
              style={{ marginLeft: 12, textDecoration: 'underline' }}
              variant="ghost"
              size="sm"
            >
              Открыть актуальные настройки
            </Button>
          )}
        </Notice>
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
          <Button
            type="button"
            onClick={resetDraft}
            disabled={!dirty || saving || conflict}
            variant="secondary"
            size="sm"
          >
            Отменить
          </Button>
          <Button type="submit" disabled={!dirty || saving || conflict} variant="primary" size="sm">
            <Save size={15} />
            {saving ? 'Сохранение…' : 'Сохранить изменения'}
          </Button>
        </div>
      </div>
    </form>
  );
}
