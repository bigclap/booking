import type { ReactElement } from 'react';
import { Spinner } from '../../shared/atoms';
import { Button, Input, Select, Styles } from '../../shared/atoms';
import { Field, Notice } from '../../shared/molecules';
import { Dialog } from '../../shared/molecules';

import BookingPeriodFields from '../molecules/BookingPeriodFields';
import BookingFloorControls from '../molecules/BookingFloorControls';
import { moscowMinute } from '../lib/bookingTime';
import { Check, Clock3, Trash2 } from 'lucide-react';

import { getRoomCapacity } from '../../office';

import type { AppUser } from '../../auth/types';

import { getMoscowDate, isWorkplace, minutesToTime } from '../lib/bookingModel';

import BookingDetails from '../molecules/BookingDetails';
import { isBookingHistorical } from '../lib/bookingDetails';

import type { AdminBookingController } from '../hooks/useAdminBookingsPage';

export default function AdminBookingForm({
  controller,
}: {
  controller: AdminBookingController;
}): ReactElement {
  const {
    office,
    user,
    data,
    setSelectedId,
    draft,
    setDraft,
    formError,
    busy,
    step,
    availableOwners,
    formResources,
    formResource,
    formHours,
    currentBooking,
    recordBooking,
    recordDetails,
    recordCancelled,
    overCapacity,
    patchDraft,
    selectFormFloor,
    submit,
    cancelBooking,
  } = controller;
  const fullName = (person: AppUser) => `${person.firstName} ${person.lastName}`;

  return (
    <>
      <Styles id="admin-booking-form">{styles}</Styles>
      {draft && (
        <Dialog
          closeLabel="Закрыть редактор брони"
          open
          onClose={() => setDraft(null)}
          busy={busy}
          placement="right"
          className="ab-form-panel"
          bodyClassName="ab-editor-scroll"
          ariaLabel="Редактор брони"
          title={
            recordCancelled ? 'Запись о брони' : draft.id ? 'Редактирование брони' : 'Новая бронь'
          }
          eyebrow={draft.id ? 'УПРАВЛЕНИЕ ЗАПИСЬЮ' : 'НОВАЯ ЗАПИСЬ'}
          footer={
            <>
              {' '}
              <div className="ab-form-footer">
                {!recordCancelled && (
                  <Button
                    variant="primary"
                    type="submit"
                    form="admin-booking-editor"
                    className="adm-primary"
                    disabled={busy || !data.available}
                  >
                    {busy ? <Spinner size={15} /> : <Check size={15} />}{' '}
                    {draft.id ? 'Сохранить изменения' : 'Создать бронь'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  type="button"
                  className="adm-secondary"
                  onClick={() => setDraft(null)}
                  disabled={busy}
                >
                  Закрыть
                </Button>
                {draft.id && !recordCancelled && (
                  <Button
                    variant="secondary"
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
                  </Button>
                )}
              </div>
            </>
          }
        >
          {' '}
          <form id="admin-booking-editor" onSubmit={submit}>
            <div className="ab-form-body">
              {recordBooking && (
                <>
                  <div className="booking-record-summary">
                    <b>{recordDetails?.name}</b>
                    <span>{recordDetails?.floorName}</span>
                    <small>
                      {isBookingHistorical(recordBooking, data.serverNow) && recordDetails?.snapshot
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
                <Field className="ab-field" label="Владелец брони">
                  <Select
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
                  </Select>
                </Field>
                <div className="ab-field">
                  <span>Этаж</span>
                  {!office.floors.some((item) => item.id === draft.floorId) && (
                    <span className="ab-record-missing-floor">
                      {recordDetails?.floorName || 'Прежний этаж'} · больше не доступен
                    </span>
                  )}
                  <BookingFloorControls
                    floors={office.floors}
                    selectedId={draft.floorId}
                    onSelect={selectFormFloor}
                    disabled={busy}
                    variant="form"
                  />
                </div>
                <Field className="ab-field" label="Ресурс">
                  <Select
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
                  </Select>
                </Field>
                <BookingPeriodFields
                  date={draft.date}
                  start={draft.start}
                  end={draft.end}
                  disabled={busy}
                  step={step * 60}
                  onDateChange={(value) => patchDraft({ date: value })}
                  onTimeChange={(edge, value) => patchDraft({ [edge]: value })}
                />
                <p className="ab-hours">
                  <Clock3 size={13} />
                  {formHours.enabled
                    ? `Рабочие часы ${minutesToTime(formHours.start)}–${minutesToTime(formHours.end)}`
                    : 'В выбранный день офис закрыт'}
                </p>
                {formResource?.kind === 'room' && (
                  <Field className="ab-field" label="Число участников">
                    <Input
                      required
                      min="1"
                      type="number"
                      aria-label="Число участников"
                      value={draft.participants}
                      disabled={busy}
                      onChange={(event) => patchDraft({ participants: event.target.value })}
                    />
                  </Field>
                )}
                {overCapacity && (
                  <Notice tone="warning" className="ab-capacity-note">
                    Вместимость — {getRoomCapacity(formResource!)} мест. Участников больше, чем
                    сидячих мест.
                  </Notice>
                )}
                {draft.id && !recordCancelled && (
                  <p className="ab-record-note">
                    Владелец сохраняется при изменении времени и ресурса. Чтобы передать бронь,
                    выберите другого сотрудника.
                  </p>
                )}
              </fieldset>
              {!data.available && (
                <div className="ab-error" role="alert">
                  <span>Занятость недоступна. Обновите расписание, чтобы сохранить изменение.</span>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => void data.refresh()}
                    disabled={data.loading || busy}
                  >
                    Обновить
                  </Button>
                </div>
              )}
              {formError && (
                <Notice tone="error" className="ab-error">
                  {formError}
                </Notice>
              )}
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

const styles = String.raw`
.ab-form-body {
  padding: 21px 25px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.ab-hours {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #a5b1c3;
  font-size: 9px;
  margin: 6px 0 22px;
}
.ab-record-note {
  font-size: 9px;
  line-height: 1.8;
  color: #a8b3c6;
}
.ab-form-footer {
  padding: 17px 25px 21px;
  border-top: 1px solid #edf0f5;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 9px;
  flex-shrink: 0;
  background: #fff;
}
.ab-form-footer .adm-primary {
  font-size: 10px;
  padding: 11px 12px;
}
.ab-form-footer .adm-secondary {
  font-size: 10px;
}
.ab-cancel {
  grid-column: 1/-1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  color: #b78e96;
  padding: 11px 8px;
  border-radius: 7px;
  background: #fff6f7;
  border: 1px solid #f1e1e4;
}
.ab-cancel:hover {
  background: #ffeff2;
}
@media (max-width: 760px) {
  .ab-form-body {
    padding: 20px;
  }
  .ab-form-footer {
    padding: 15px 20px 20px;
  }
}
.booking-record-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 17px;
  padding: 12px;
  border: 1px solid #e7ebf3;
  border-radius: 8px;
  background: #f9fafd;
  color: #71839d;
  font-size: 11px;
  line-height: 1.6;
}
.booking-record-summary b {
  font-size: 13px;
}
.booking-record-summary small {
  font-size: 10px;
  color: #91a0b5;
}
.ab-edit-fields {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.ab-record-missing-floor {
  display: block;
  font-size: 11px;
  padding: 10px 0;
  color: #98a3b7;
}
.ab-form-panel > .ab-editor-scroll {
  padding: 0;
}
.ab-editor-scroll > form {
  margin: 0;
}
.ab-form-panel > .ui-dialog-footer {
  padding: 0;
  display: block;
}
.ab-form-panel .ab-form-footer {
  margin: 0;
  width: 100%;
}
.ab-form-panel .ab-error .ui-button {
  min-height: 28px;
  padding: 4px 7px;
}
.ab-form-panel .ab-cancel {
  margin-left: auto;
}
.ab-form-body > .ui-notice {
  margin: 12px 0;
}
`;
