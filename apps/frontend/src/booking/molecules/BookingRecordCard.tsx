import type { ReactElement } from 'react';
import { Armchair, ArrowRight, DoorOpen } from 'lucide-react';
import type { OfficeConfig } from '../../office';
import type { ClientBooking } from '../types';
import { Button, Styles } from '../../shared/atoms';
import { getBookingResourceDetails, isBookingHistorical } from '../lib/bookingDetails';
import { minutesToTime } from '../lib/bookingModel';
import { readableDate } from '../lib/bookingTime';
import BookingDetails from './BookingDetails';
export default function BookingRecordCard({
  booking,
  office,
  serverNow,
  onOpen,
  admin = false,
  disabled = false,
}: {
  booking: ClientBooking;
  office: OfficeConfig;
  serverNow: number;
  onOpen: (booking: ClientBooking) => void;
  admin?: boolean;
  disabled?: boolean;
}): ReactElement {
  const details = getBookingResourceDetails(booking, office, {
    preferSnapshot: isBookingHistorical(booking, serverNow),
  });
  return (
    <>
      <Styles id="booking-record-card">{styles}</Styles>
      <article className={admin ? 'ab-saved-record' : 'bk-my-record'}>
        <Button variant="ghost" onClick={() => onOpen(booking)} disabled={disabled}>
          {!admin && (
            <span className="bk-my-icon">
              {details.kind === 'room' || details.kind === 'meeting_room' ? (
                <DoorOpen size={20} />
              ) : (
                <Armchair size={20} />
              )}
            </span>
          )}
          <span>
            <b>{details.name}</b>
            <small>
              {details.floorName} · {admin ? booking.ownerName : readableDate(booking.date)}
              {!admin && (
                <>
                  <br />
                  {minutesToTime(booking.start)}–{minutesToTime(booking.end)}
                </>
              )}
            </small>
          </span>
          {admin ? (
            <time>
              {minutesToTime(booking.start)}–{minutesToTime(booking.end)}
            </time>
          ) : (
            <ArrowRight size={16} />
          )}
        </Button>
        <BookingDetails booking={booking} compact />
      </article>
    </>
  );
}
const styles = String.raw`
.bk-my-record,
.ab-saved-record {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid #e6ebf3;
  border-radius: 9px;
  background: #fff;
}
.bk-my-record > .ui-button,
.ab-saved-record > .ui-button {
  display: flex;
  width: 100%;
  min-height: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
  text-align: left;
  white-space: normal;
  color: #8999b1;
  border: 0;
}
.bk-my-record > .ui-button > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}
.bk-my-record b,
.ab-saved-record b {
  display: block;
  color: #71839f;
  font-size: 12px;
  font-weight: 650;
}
.bk-my-record small,
.ab-saved-record small {
  display: block;
  font-size: 10px;
  line-height: 1.7;
  margin-top: 3px;
}
.ab-saved-record time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
.bk-my-record .bk-my-icon {
  display: grid;
  place-items: center;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  border-radius: 9px;
  background: #f3f5fd;
  color: #909ddb;
}
.bk-my-record > .ui-button > svg {
  margin-left: auto;
  flex-shrink: 0;
}
.bk-my-record .booking-metadata {
  padding-left: 0;
}
@media (max-width: 720px) {
  .ab-saved-record > .ui-button {
    align-items: flex-start;
  }
  .ab-saved-record time {
    font-size: 10px;
  }
}
`;
