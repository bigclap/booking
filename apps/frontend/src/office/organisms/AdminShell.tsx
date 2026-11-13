import type { ReactNode } from 'react';
import { Building2, UsersRound } from 'lucide-react';
import type { OfficeConfig } from '../lib/officeModel';
import { useAuth } from '../../auth/hooks';
import { UserMenu } from '../../auth/organisms';
import { useOffices } from '../hooks/OfficeProvider';
import { AdminLayout } from '../../shared/organisms';
import OfficeWorkspace from './OfficeWorkspace';
export default function AdminShell({
  children,
  section,
  office,
  view,
  overlays,
  actions,
}: {
  children: ReactNode;
  section: 'offices' | 'users';
  office?: OfficeConfig;
  view?: 'settings' | 'bookings';
  overlays?: ReactNode;
  actions?: ReactNode;
}) {
  const { offices } = useOffices();
  const { users } = useAuth();
  if (office)
    return (
      <OfficeWorkspace
        office={office}
        view={view || 'settings'}
        overlays={overlays}
        actions={actions}
      >
        {children}
      </OfficeWorkspace>
    );
  return (
    <AdminLayout
      title={section === 'users' ? 'Пользователи' : 'Офисы'}
      activeId={section}
      navigation={[
        {
          id: 'offices',
          label: 'Офисы',
          href: '/admin/offices',
          icon: <Building2 size={18} />,
          count: offices.length,
        },
        {
          id: 'users',
          label: 'Пользователи',
          href: '/admin/users',
          icon: <UsersRound size={18} />,
          count: users.length,
        },
      ]}
      userMenu={<UserMenu area="admin" />}
      overlays={overlays}
    >
      {children}
    </AdminLayout>
  );
}
