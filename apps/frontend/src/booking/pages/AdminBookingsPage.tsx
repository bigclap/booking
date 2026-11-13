import type { ReactElement } from 'react';
import type { OfficeConfig } from '../../office';
import { useAdminBookingsPage } from '../hooks/useAdminBookingsPage';
import AdminBookingWorkspace from '../organisms/AdminBookingWorkspace';

export default function AdminBookingsPage({ office }: { office: OfficeConfig }): ReactElement {
  const controller = useAdminBookingsPage(office);
  return <AdminBookingWorkspace controller={controller} />;
}
