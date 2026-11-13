import { AlertTriangle, Info } from 'lucide-react';
import type { ClientBooking } from './types';
import {
  getBookingCancellationMessage,
  getBookingReviewMessages,
  getBookingWarningMessages,
} from './bookingDetails';
import './bookingDetails.css';

export default function BookingDetails({
  booking,
  compact = false,
}: {
  booking: ClientBooking;
  compact?: boolean;
}) {
  const review = getBookingReviewMessages(booking);
  const cancellation = getBookingCancellationMessage(booking);
  const warnings = getBookingWarningMessages(booking);
  if (!review.length && !cancellation && !warnings.length) return null;
  return (
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
  );
}
