import type { ReactElement } from 'react';
import { Input, Styles } from '../../shared/atoms';
import { Field } from '../../shared/molecules';
export default function BookingPeriodFields({
  date,
  start,
  end,
  onDateChange,
  onTimeChange,
  disabled = false,
  startDisabled = false,
  step = 300,
  minDate,
  maxDate,
  dateAriaLabel = 'Дата брони',
}: {
  date: string;
  start: string;
  end: string;
  onDateChange: (value: string) => void;
  onTimeChange: (edge: 'start' | 'end', value: string) => void;
  disabled?: boolean;
  startDisabled?: boolean;
  step?: number;
  minDate?: string;
  maxDate?: string;
  dateAriaLabel?: string;
}): ReactElement {
  return (
    <>
      <Styles id="booking-period-fields">{styles}</Styles>
      <Field label="Дата">
        <Input
          required
          type="date"
          disabled={disabled || startDisabled}
          min={minDate}
          max={maxDate}
          aria-label={dateAriaLabel}
          value={date}
          onInput={(event) => onDateChange(event.currentTarget.value)}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </Field>
      <div className="booking-time-fields">
        {(['start', 'end'] as const).map((edge) => (
          <Field key={edge} label={edge === 'start' ? 'Начало' : 'Окончание'}>
            <Input
              required
              type="time"
              step={step}
              disabled={disabled || (edge === 'start' && startDisabled)}
              aria-label={edge === 'start' ? 'Начало брони' : 'Окончание брони'}
              value={edge === 'start' ? start : end}
              onInput={(event) => onTimeChange(edge, event.currentTarget.value)}
              onChange={(event) => onTimeChange(edge, event.target.value)}
            />
          </Field>
        ))}
      </div>
    </>
  );
}
const styles = String.raw`
.booking-time-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
  margin: 14px 0;
}
.booking-time-fields > .ui-field {
  margin: 0;
}
.bk-booking-form > .ui-field,
.ab-edit-fields > .ui-field {
  margin-bottom: 16px;
}
`;
