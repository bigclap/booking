import type { ReactNode } from 'react';
import { Building2, Grid2X2, ShieldCheck, UsersRound } from 'lucide-react';
import type { OfficeConfig } from '../model';
import { useAuth } from '../auth/AuthProvider';
import UserMenu from '../auth/UserMenu';
import { useOffices } from '../offices/OfficeProvider';
import OfficeWorkspace from './OfficeWorkspace';
import './users.css';
import './admin-shell.css';

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
  const pageName = section === 'users' ? 'Пользователи' : 'Офисы';
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
    <div className="adm-shell admin-area">
      <header className="adm-header">
        <a href="/admin/offices" className="adm-brand" aria-label="Планировка — администрирование">
          <span>
            <Grid2X2 size={22} />
          </span>
          планировка<i>•</i>
        </a>
        <span className="admin-mode-label">
          <ShieldCheck size={13} />
          Администрирование
        </span>
        <div className="adm-header-actions">
          <UserMenu area="admin" />
        </div>
      </header>
      <nav className="adm-mobile-nav" aria-label="Разделы админки">
        <a href="/admin/offices" aria-current={section === 'offices' ? 'page' : undefined}>
          <Building2 size={15} />
          Офисы
        </a>
        <a href="/admin/users" aria-current={section === 'users' ? 'page' : undefined}>
          <UsersRound size={15} />
          Пользователи
        </a>
      </nav>
      <div className="adm-workspace">
        <aside className="adm-sidebar">
          <div className="adm-sidebar-label">УПРАВЛЕНИЕ</div>
          <a
            href="/admin/offices"
            className={'adm-sidebar-item' + (section === 'offices' ? ' is-active' : '')}
            aria-label="Офисы"
            aria-current={section === 'offices' ? 'page' : undefined}
          >
            <Building2 size={18} />
            <span className="adm-sidebar-text">Офисы</span>
            <span className="adm-sidebar-count">{offices.length}</span>
          </a>
          <a
            href="/admin/users"
            className={'adm-sidebar-item' + (section === 'users' ? ' is-active' : '')}
            aria-label="Пользователи"
            aria-current={section === 'users' ? 'page' : undefined}
          >
            <UsersRound size={18} />
            <span className="adm-sidebar-text">Пользователи</span>
            <span className="adm-sidebar-count">{users.length}</span>
          </a>
          <div className="adm-sidebar-bottom">
            <ShieldCheck size={17} />
            <div>
              <b>Администрирование</b>
              <span>Офисы, расписание и доступ</span>
            </div>
          </div>
        </aside>
        <main className="adm-main">
          <nav className="admin-content-breadcrumb" aria-label="Путь страницы">
            <span>{pageName}</span>
          </nav>
          {children}
        </main>
      </div>
      {overlays}
    </div>
  );
}
