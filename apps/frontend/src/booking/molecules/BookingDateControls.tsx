import type { ReactElement } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown } from 'lucide-react';
import { Button, IconButton, Input, Styles } from '../../shared/atoms';
import { getMoscowDate } from '../lib/bookingModel';
import { nextDate, readableDate } from '../lib/bookingTime';
export default function BookingDateControls({
  date,
  onChange,
  disabled = false,
  admin = false,
}: {
  date: string;
  onChange: (date: string) => void;
  disabled?: boolean;
  admin?: boolean;
}): ReactElement {
  return (
    <>
      <Styles id="booking-date-controls">{styles}</Styles>
      <div
        data-variant={admin ? 'admin' : 'client'}
        className={'booking-date-controls ' + (admin ? 'ab-date-controls' : 'bk-date-controls')}
      >
        <IconButton
          variant="ghost"
          aria-label={admin ? 'Предыдущий день расписания' : 'Предыдущий день'}
          disabled={disabled}
          onClick={() => onChange(nextDate(date, -1))}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <div className="booking-date-picker">
          <CalendarDays size={16} />
          <span>{readableDate(date)}</span>
          {!admin && <ChevronDown size={13} />}
          <Input
            aria-label={admin ? 'Дата административного расписания' : 'Дата бронирования'}
            type="date"
            value={date}
            disabled={disabled}
            onInput={(event) => onChange(event.currentTarget.value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <IconButton
          variant="ghost"
          aria-label={admin ? 'Следующий день расписания' : 'Следующий день'}
          disabled={disabled}
          onClick={() => onChange(nextDate(date, 1))}
        >
          <ArrowRight size={16} />
        </IconButton>
        {!admin && (
          <Button
            variant="ghost"
            className="booking-date-today"
            onClick={() => onChange(getMoscowDate())}
          >
            Сегодня
          </Button>
        )}
      </div>
    </>
  );
}
const styles = String.raw`
.booking-date-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}
.booking-date-controls > .ui-icon-button {
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  max-width: 30px;
  max-height: 30px;
  flex-basis: 30px;
  color: #99a8c0;
}
.booking-date-picker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  color: #8495b2;
  font-size: 10px;
  white-space: nowrap;
  padding: 7px 6px;
}
.booking-date-picker > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.booking-date-picker > svg {
  flex-shrink: 0;
}
.booking-date-picker > .ui-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.booking-date-picker input::-webkit-calendar-picker-indicator {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.booking-date-controls .booking-date-today {
  min-height: 30px;
  padding: 5px 7px;
  color: #8c99b1;
  font-size: 9px;
}
@media (max-width: 1050px) {
  .booking-date-today {
    display: none !important;
  }
}
@media (max-width: 720px) {
  .booking-date-controls {
    gap: 0;
  }
  .booking-date-picker {
    gap: 5px;
    font-size: 10px;
  }
  .booking-date-picker > svg:last-of-type:not(:first-child) {
    display: none;
  }
  .booking-date-picker > svg {
    width: 13px;
  }
  .booking-date-controls > .ui-icon-button {
    width: 24px;
    min-width: 24px;
    max-width: 24px;
    flex-basis: 24px;
  }
}
.booking-date-controls[data-variant='client'] > .booking-date-picker {
  gap: 8px;
  padding: 9px 10px;
  font-size: 12px;
  font-weight: 650;
  color: #60718d;
  background: #f7f8fc;
  border: 1px solid #e8ecf4;
  border-radius: 7px;
}
@media (max-width: 720px) {
  .booking-date-controls[data-variant='client'] > .booking-date-picker {
    gap: 5px;
    padding: 8px 6px;
    font-size: 10px;
    background: none;
    border-color: transparent;
  }
}
`;
