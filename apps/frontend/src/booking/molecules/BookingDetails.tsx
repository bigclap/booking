import type { ReactElement } from 'react';
import { Styles } from '../../shared/atoms';
import { AlertTriangle, Info } from 'lucide-react';
import type { ClientBooking } from '../types';
import {
  getBookingCancellationMessage,
  getBookingReviewMessages,
  getBookingWarningMessages,
} from '../lib/bookingDetails';

export default function BookingDetails({
  booking,
  compact = false,
}: {
  booking: ClientBooking;
  compact?: boolean;
}): ReactElement | null {
  const review = getBookingReviewMessages(booking);
  const cancellation = getBookingCancellationMessage(booking);
  const warnings = getBookingWarningMessages(booking);
  if (!review.length && !cancellation && !warnings.length) return null;
  return (
    <>
      <Styles id="booking-details">{styles}</Styles>
      <div className={'booking-metadata' + (compact ? ' is-compact' : '')}>
        {review.length > 0 && (
          <div className="booking-metadata-review">
            <AlertTriangle size={15} />
            <div>
              <b>Нужно проверить бронь</b>
              {review.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          </div>
        )}
        {cancellation && (
          <div className="booking-metadata-cancellation">
            <Info size={15} />
            <p>{cancellation}</p>
          </div>
        )}
        {warnings.map((message) => (
          <div className="booking-metadata-warning" key={message}>
            <Info size={15} />
            <p>{message}</p>
          </div>
        ))}
      </div>
    </>
  );
}

const styles = String.raw`
.booking-metadata {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 14px 0;
  min-width: 0;
}
.booking-metadata > div {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid #ece1c7;
  border-radius: 8px;
  background: #fffbf2;
  color: #8d754c;
  font-size: 11px;
  line-height: 1.65;
}
.booking-metadata > div > svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.booking-metadata b {
  display: block;
  font-size: 11px;
  font-weight: 700;
}
.booking-metadata p {
  margin: 0;
}
.booking-metadata b + p,
.booking-metadata p + p {
  margin-top: 5px;
}
.booking-metadata .booking-metadata-cancellation {
  border-color: #e4e8ef;
  background: #f7f8fb;
  color: #7c8aa0;
}
.booking-metadata.is-compact {
  margin: 9px 0 0;
  gap: 5px;
}
.booking-metadata.is-compact > div {
  font-size: 10px;
  padding: 8px 9px;
}
.booking-metadata.is-compact b {
  font-size: 10px;
}
@media (max-width: 720px) {
  .booking-metadata > div {
    font-size: 10px;
  }
}
`;
