import type { ReactElement } from 'react';
import type { BookingPageProps } from '../hooks/useBookingPage';
import { useBookingPage } from '../hooks/useBookingPage';
import BookingClientWorkspace from '../organisms/BookingClientWorkspace';

export default function BookingPage(props: BookingPageProps): ReactElement {
  const controller = useBookingPage(props);
  return <BookingClientWorkspace controller={controller} />;
}
