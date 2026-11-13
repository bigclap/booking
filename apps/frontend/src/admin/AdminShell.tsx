import type { ReactNode } from 'react';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  Grid2X2,
  Settings2,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type { OfficeConfig } from '../model';
import { useAuth } from '../auth/AuthProvider';
import UserMenu from '../auth/UserMenu';
import { useOffices } from '../offices/OfficeProvider';
import { officeBookingsPath, officeDetailsPath } from './routes';
import './users.css';
import './admin-shell.css';

export default function AdminShell({
  children,
  section,
  office,
  view,
  overlays,
}: {
  children: ReactNode;
  section: 'offices' | 'users';
  office?: OfficeConfig;
  view?: 'settings' | 'bookings';
  overlays?: ReactNode;
}) {
  const { offices } = useOffices();
  const { users } = useAuth();
  const pageName = section === 'users' ? 'Пользователи' : 'Офисы';
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
            {office ? (
              <>
                <a href="/admin/offices">Офисы</a>
                <ChevronRight size={12} />
                <a href={officeDetailsPath(office.id)}>{office.name}</a>
                {view === 'bookings' && (
                  <>
                    <ChevronRight size={12} />
                    <span>Бронирования</span>
                  </>
                )}
              </>
            ) : (
              <span>{pageName}</span>
            )}
          </nav>
          {office && (
            <nav className="admin-office-tabs" aria-label="Разделы офиса">
              <a
                href={officeDetailsPath(office.id)}
                aria-current={view !== 'bookings' ? 'page' : undefined}
              >
                <Settings2 size={15} />
                Настройки офиса
              </a>
              <a
                href={officeBookingsPath(office.id)}
                aria-current={view === 'bookings' ? 'page' : undefined}
              >
                <CalendarDays size={15} />
                Бронирования
              </a>
            </nav>
          )}
          {children}
        </main>
      </div>
      {overlays}
    </div>
  );
}
