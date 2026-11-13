import type { ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Grid2X2, Layers, Settings2 } from 'lucide-react';
import type { OfficeConfig } from '../lib/officeModel';
import { UserMenu } from '../../auth/organisms';
import { officeBookingsPath, officePlanPath, officeSettingsPath } from '../lib/routes';
import { Styles } from '../../shared/atoms';

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
    <>
      <div className={`adm-shell office-workspace office-workspace--${view}`}>
        <header className="office-workspace-header">
          <a
            href="/admin/offices"
            className="office-workspace-brand"
            aria-label="Планировка — Офисы"
          >
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
      <Styles id="office-workspace">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-workspace {
  height: 100dvh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f5f7fb;
  color: #334259;
  font-family: Manrope, system-ui, sans-serif;
}
.office-workspace a:not(.ui-button) {
  color: inherit;
  text-decoration: none;
}
.office-workspace button,
.office-workspace input,
.office-workspace select {
  font-family: inherit;
}
.office-workspace {
  min-height: 0;
}
.office-workspace-header {
  min-height: 68px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 10px 22px;
  border-bottom: 1px solid #e6eaf2;
  background: #fff;
}
.office-workspace-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.office-workspace-brand > span {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  border-radius: 10px;
  color: white;
  background: #7886da;
}
.office-workspace-brand > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.office-workspace-brand b {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.8px;
}
.office-workspace-brand small {
  font-size: 8px;
  color: #98a3b6;
}
.office-workspace-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 0 1 270px;
  color: #647591;
  font-size: 12px;
  font-weight: 650;
}
.office-workspace-heading > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.office-workspace-back {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 30px;
  height: 32px;
  border-radius: 7px;
  color: #8b99b0 !important;
}
.office-workspace-back:hover {
  background: #f3f5fb;
  color: #7382cc !important;
}
.office-workspace-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.office-workspace-nav > a {
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 7px;
  padding: 10px 12px;
  color: #8d9bb2;
  font-size: 11px;
  white-space: nowrap;
}
.office-workspace-nav > a svg {
  flex-shrink: 0;
}
.office-workspace-nav > a:hover {
  background: #f6f7fc;
}
.office-workspace-nav > a[aria-current='page'] {
  color: #7482cf;
  background: #edf0fc;
  font-weight: 700;
}
.office-workspace-actions {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-shrink: 0;
  margin-left: auto;
}
.office-workspace-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.office-workspace-content {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.office-workspace--settings .office-workspace-content {
  overflow: auto;
  padding: 24px clamp(22px, 3vw, 48px) 35px;
}
.office-workspace--settings .office-detail {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}
.office-workspace .admin-plan-shell {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.office-workspace .admin-plan-shell .workspace {
  flex: 1;
  min-height: 0;
  height: auto;
}
.office-workspace .admin-plan-shell .recovery-banner {
  position: relative;
  top: auto;
  flex-shrink: 0;
}
.office-workspace .library-panel {
  width: 230px;
}
.office-workspace .library-panel .panel-heading {
  margin-bottom: 18px;
}
.office-workspace .library-panel .panel-heading h1 {
  font-size: 17px;
  margin: 4px 0;
}
.office-workspace .library-panel .office-caption {
  display: none;
}
@media (max-width: 1200px) {
  .office-workspace .library-panel {
    width: 200px;
  }
  .office-workspace-actions .save-state {
    display: none;
  }
  .office-workspace-header {
    gap: 16px;
  }
  .office-workspace-brand b {
    font-size: 18px;
  }
  .office-workspace-heading {
    flex-basis: 220px;
    font-size: 11px;
  }
  .office-workspace-nav > a {
    padding: 10px;
    font-size: 10px;
  }
}
@media (max-width: 950px) {
  .office-workspace-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'brand office actions' 'tabs tabs tabs';
    gap: 8px 15px;
    padding: 10px 16px 8px;
  }
  .office-workspace-brand {
    grid-area: brand;
  }
  .office-workspace-heading {
    grid-area: office;
  }
  .office-workspace-actions {
    grid-area: actions;
  }
  .office-workspace-nav {
    grid-area: tabs;
    justify-content: center;
  }
  .office-workspace .library-panel {
    width: 175px;
  }
  .office-workspace .admin-plan-shell .inspector {
    position: absolute;
    right: 0;
    top: 72px;
    bottom: 0;
    width: 230px;
    z-index: 8;
    border: 1px solid #e3e9f5;
    border-radius: 12px 0 0 12px;
    box-shadow: -6px 3px 20px #4a668910;
  }
  .office-workspace .inspector:has(.inspector-empty) {
    display: none;
  }
}
@media (max-width: 700px) {
  .office-workspace-header {
    padding: 9px 12px 6px;
    gap: 5px 10px;
  }
  .office-workspace-brand > div {
    display: none;
  }
  .office-workspace-brand > span {
    width: 30px;
    height: 30px;
  }
  .office-workspace-heading {
    font-size: 11px;
    gap: 4px;
  }
  .office-workspace-actions {
    gap: 8px;
  }
  .office-workspace-actions .preview-button {
    font-size: 0;
    padding: 8px;
    gap: 0;
  }
  .office-workspace-nav {
    width: 100%;
  }
  .office-workspace-nav > a {
    flex: 1;
    justify-content: center;
    padding: 9px 6px;
    font-size: 10px;
  }
  .office-workspace-nav > a svg {
    width: 15px;
    height: 15px;
  }
  .office-workspace .library-panel {
    width: 150px;
  }
  .office-workspace--settings .office-workspace-content {
    padding: 16px 14px 25px;
  }
}
`;
