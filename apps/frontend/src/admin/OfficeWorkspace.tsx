import type { ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Grid2X2, Layers, Settings2 } from 'lucide-react';
import type { OfficeConfig } from '../model';
import UserMenu from '../auth/UserMenu';
import { officeBookingsPath, officePlanPath, officeSettingsPath } from './routes';
import './users.css';
import './office-workspace.css';

export type OfficeView = 'plan' | 'bookings' | 'settings';

export default function OfficeWorkspace({
  office,
  view,
  children,
  actions,
  overlays,
}: {
  office: OfficeConfig;
  view: OfficeView;
  children: ReactNode;
  actions?: ReactNode;
  overlays?: ReactNode;
}) {
  const links = [
    { view: 'plan', label: 'Конструктор', icon: Layers, path: officePlanPath(office.id) },
    { view: 'bookings', label: 'Брони', icon: CalendarDays, path: officeBookingsPath(office.id) },
    { view: 'settings', label: 'Настройки', icon: Settings2, path: officeSettingsPath(office.id) },
  ] as const;
  return (
    <div className={`adm-shell office-workspace office-workspace--${view}`}>
      <header className="office-workspace-header">
        <a href="/admin/offices" className="office-workspace-brand" aria-label="Планировка — Офисы">
          <span>
            <Grid2X2 size={21} />
          </span>
          <div>
            <b>планировка</b>
            <small>Администрирование</small>
          </div>
        </a>
        <div className="office-workspace-heading">
          <a
            href="/admin/offices"
            aria-label="Вернуться к списку офисов"
            className="office-workspace-back"
          >
            <ArrowLeft size={18} />
          </a>
          <span title={office.name}>{office.name}</span>
        </div>
        <nav className="office-workspace-nav" aria-label="Разделы офиса">
          {links.map(({ view: itemView, label, icon: Icon, path }) => (
            <a key={itemView} href={path} aria-current={view === itemView ? 'page' : undefined}>
              <Icon size={16} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="office-workspace-actions">
          {actions}
          <UserMenu area="admin" />
        </div>
      </header>
      <div className="office-workspace-body">
        <div
          className="office-workspace-content"
          aria-label={links.find((link) => link.view === view)?.label}
        >
          {children}
        </div>
      </div>
      {overlays}
    </div>
  );
}
