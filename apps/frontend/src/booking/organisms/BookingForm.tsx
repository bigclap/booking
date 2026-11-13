import type { ReactElement } from 'react';
import { Button, Input, Styles } from '../../shared/atoms';
import { Field, Notice } from '../../shared/molecules';
import BookingPeriodFields from '../molecules/BookingPeriodFields';
import { Check, Clock3 } from 'lucide-react';

import { minutesToTime } from '../lib/bookingModel';

import BookingDetails from '../molecules/BookingDetails';

import { durationLabel } from '../lib/bookingTime';
import type { BookingController } from '../hooks/useBookingPage';

export default function BookingForm({
  controller,
}: {
  controller: BookingController;
}): ReactElement | null {
  const {
    date,
    dateMissing,
    startMissing,
    endMissing,
    participantsMissing,
    setParticipantsMissing,
    bookingStore,
    saving,
    bookingsAvailable,
    range,
    setPanel,
    editingId,
    setEditingId,
    editingSource,
    participants,
    setParticipants,
    formError,
    hours,
    selected,
    editingCurrent,
    editChanged,
    endOnly,
    rangeValid,
    conflicts,
    roomCapacity,
    changeFormTime,
    changeFormDate,
    submitBooking,
    editBooking,
  } = controller;
  if (!selected) return null;
  return (
    <>
      <Styles id="bookingform">{styles}</Styles>
      <form className="bk-booking-form" onSubmit={submitBooking}>
        <div className="bk-form-title">{editingId ? 'Изменить бронь' : 'Новая бронь'}</div>
        {editingId && editingSource && <BookingDetails booking={editingCurrent || editingSource} />}
        {editChanged && (
          <Notice tone="error" className="bk-form-error">
            Бронь изменилась в другом окне.
            {editingCurrent?.status === 'active' ? (
              <Button
                variant="ghost"
                type="button"
                className="bk-subtle-button"
                onClick={() => editBooking(editingCurrent)}
              >
                Открыть актуальную версию
              </Button>
            ) : (
              <small>Запись больше не активна. Закройте форму.</small>
            )}
          </Notice>
        )}
        <BookingPeriodFields
          date={dateMissing ? '' : date}
          start={startMissing ? '' : minutesToTime(range.start)}
          end={endMissing ? '' : minutesToTime(range.end)}
          onDateChange={changeFormDate}
          onTimeChange={changeFormTime}
          disabled={saving}
          startDisabled={endOnly}
          minDate={!editingId ? bookingStore.policy?.allowedDates[0] : undefined}
          maxDate={!editingId ? bookingStore.policy?.allowedDates.at(-1) : undefined}
          dateAriaLabel="Дата в форме бронирования"
        />
        {endOnly && (
          <p className="bk-form-summary">
            Бронь уже началась: можно изменить окончание или завершить её.
          </p>
        )}
        {selected.kind === 'room' && (
          <Field label="Участники">
            <Input
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
          </Field>
        )}
        {selected.kind === 'room' && !participantsMissing && participants > roomCapacity && (
          <Notice tone="warning" className="bk-capacity-warning">
            Для {participants} участников здесь {roomCapacity} сидячих мест.
            <small>Бронь можно подтвердить.</small>
          </Notice>
        )}
        {(formError || dateMissing || conflicts.length > 0 || !rangeValid || !hours.enabled) && (
          <Notice tone="error" className="bk-form-error">
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
                  .map((item) => minutesToTime(item.start) + '–' + minutesToTime(item.end))
                  .join(', ')}
              </small>
            )}
          </Notice>
        )}
        {!startMissing && !endMissing && (
          <div className="bk-form-summary">
            <Clock3 size={14} />
            {durationLabel(range)}
            <span>Московское время</span>
          </div>
        )}
        <Button
          variant="primary"
          className="bk-primary"
          type="submit"
          disabled={saving || !bookingsAvailable || editChanged}
        >
          <Check size={16} />
          {saving ? 'Сохраняем…' : editingId ? 'Сохранить изменения' : 'Подтвердить бронь'}
        </Button>
        <Button
          variant="ghost"
          className="bk-subtle-button"
          type="button"
          disabled={saving}
          onClick={() => {
            setEditingId(null);
            setPanel('resource');
          }}
        >
          Назад к пространству
        </Button>
      </form>
    </>
  );
}

const styles = String.raw`
.bk-form-title {
  margin: 17px 0 12px;
  font-size: 11px;
  color: #6d7fa1;
  font-weight: 700;
  border-top: 1px solid #edf0f6;
  padding-top: 13px;
}
.bk-form-error small {
  display: block;
  margin-top: 5px;
  font-size: 9px;
}
.bk-form-summary {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 9px;
  color: #94a1b6;
  margin: 13px 0;
}
.bk-form-summary span {
  margin-left: auto;
  font-size: 8px;
  color: #b0b8c7;
}
.bk-subtle-button {
  padding: 11px 0 0;
  display: block;
  text-align: center;
  font-size: 9px;
  color: #99a6bc;
  background: none;
  width: 100%;
}
.bk-capacity-warning small {
  display: block;
  font-size: 9px;
  margin-top: 4px;
}
.bk-booking-form > .bk-primary {
  width: 100%;
  margin-top: 17px;
}
.bk-booking-form > .bk-subtle-button {
  width: 100%;
  margin-top: 9px;
}
.bk-booking-form > .ui-field {
  margin: 15px 0;
}
.bk-booking-form .ui-notice {
  margin: 12px 0;
}
`;
