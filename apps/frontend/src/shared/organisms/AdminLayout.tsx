import type { ReactNode } from 'react';
import { Grid2X2, ShieldCheck } from 'lucide-react';
import { Styles } from '../atoms';

export interface AdminNavigationItem {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  count?: number;
}
export interface AdminLayoutProps {
  title: string;
  navigation: AdminNavigationItem[];
  activeId: string;
  userMenu: ReactNode;
  children: ReactNode;
  overlays?: ReactNode;
}
export default function AdminLayout({
  title,
  navigation,
  activeId,
  userMenu,
  children,
  overlays,
}: AdminLayoutProps) {
  return (
    <>
      <Styles id="admin-layout">{styles}</Styles>
      <div className="adm-shell admin-area admin-layout-root">
        <header className="adm-header">
          <a
            href={navigation[0]?.href || '/'}
            className="adm-brand"
            aria-label="Планировка — администрирование"
          >
            <span>
              <Grid2X2 size={22} />
            </span>
            планировка<i>•</i>
          </a>
          <span className="admin-mode-label">
            <ShieldCheck size={13} />
            Администрирование
          </span>
          <div className="adm-header-actions">{userMenu}</div>
        </header>
        <nav className="adm-mobile-nav" aria-label="Разделы админки">
          {navigation.map((item) => (
            <a
              key={item.id}
              href={item.href}
              aria-current={activeId === item.id ? 'page' : undefined}
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>
        <div className="adm-workspace">
          <aside className="adm-sidebar">
            <div className="adm-sidebar-label">УПРАВЛЕНИЕ</div>
            {navigation.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={'adm-sidebar-item' + (activeId === item.id ? ' is-active' : '')}
                aria-label={item.label}
                aria-current={activeId === item.id ? 'page' : undefined}
              >
                {item.icon}
                <span className="adm-sidebar-text">{item.label}</span>
                {item.count !== undefined && (
                  <span className="adm-sidebar-count">{item.count}</span>
                )}
              </a>
            ))}
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
              <span>{title}</span>
            </nav>
            {children}
          </main>
        </div>
        {overlays}
      </div>
    </>
  );
}
const styles = String.raw`
.admin-layout-root {
  height: 100dvh;
  min-height: 520px;
  display: flex;
  flex-direction: column;
  background: #f5f7fb;
  color: #334259;
  font-family: Manrope, system-ui, sans-serif;
  overflow: hidden;
}

.admin-layout-root a:not(.ui-button) {
  color: inherit;
  text-decoration: none;
}

.admin-layout-root .adm-header {
  height: 68px;
  flex-shrink: 0;
  padding: 0 28px;
  display: flex;
  align-items: center;
  gap: 26px;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e6ebf2;
}

.admin-layout-root .adm-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 23px;
  letter-spacing: -1px;
  font-weight: 800;
  white-space: nowrap;
}

.admin-layout-root .adm-brand > span {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  background: #7480dc;
  color: white;
  border: 1px solid #6874cd;
  border-radius: 11px;
  box-shadow: inset 0 1px 0 #ffffff26;
}

.admin-layout-root .adm-brand i {
  font-style: normal;
  color: #aeb8d4;
  font-size: 22px;
  margin-left: 2px;
}

.admin-layout-root .adm-breadcrumb {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-right: auto;
  font-size: 11px;
  color: #98a3b4;
}

.admin-layout-root .adm-breadcrumb > span {
  padding-left: 22px;
  border-left: 1px solid #e5e9f0;
}

.admin-layout-root .adm-breadcrumb b {
  font-weight: 600;
  color: #728099;
}

.admin-layout-root .adm-header-actions {
  display: flex;
  align-items: center;
  gap: 19px;
}

.admin-layout-root .adm-header-link {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #7f8ca4 !important;
  font-size: 11px;
  font-weight: 600;
}

.admin-layout-root .adm-header-link:hover {
  color: #6675cc !important;
}

.admin-layout-root .adm-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}

.admin-layout-root .adm-sidebar {
  width: 220px;
  flex-shrink: 0;
  padding: 26px 15px 20px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e7ebf2;
}

.admin-layout-root .adm-back-link {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: #8391a8 !important;
  padding: 4px 12px 25px;
}

.admin-layout-root .adm-back-link:hover {
  color: #6473c7 !important;
}

.admin-layout-root .adm-sidebar-label {
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1.6px;
  color: #9da9bc;
  padding: 10px 13px 12px;
}

.admin-layout-root .adm-sidebar-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 650;
}

.admin-layout-root .adm-sidebar-item.is-active {
  color: #7380d0;
  background: #f0f2fc;
}

.admin-layout-root .adm-sidebar-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-layout-root .adm-sidebar-count {
  flex: 0 0 24px;
  width: 24px;
  min-width: 24px;
  height: 22px;
  margin-left: auto;
  display: grid;
  place-items: center;
  font-size: 10px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  background: #fff;
  border: 1px solid #e5e9fa;
  border-radius: 6px;
  color: #8d98cf;
}

.admin-layout-root .adm-sidebar-bottom {
  margin-top: auto;
  padding: 16px 10px 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #9ba8bd;
  border-top: 1px solid #eef1f6;
}

.admin-layout-root .adm-sidebar-bottom > svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.admin-layout-root .adm-sidebar-bottom b {
  display: block;
  font-size: 10px;
  color: #8190a9;
  font-weight: 650;
}

.admin-layout-root .adm-sidebar-bottom span {
  display: block;
  font-size: 9px;
  line-height: 1.6;
  margin-top: 5px;
  color: #a3aec0;
}

.admin-layout-root .adm-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 36px clamp(22px, 4vw, 64px) 28px;
}

.admin-layout-root .adm-main > * {
  max-width: 1280px;
  margin-left: auto;
  margin-right: auto;
}
@media (max-width: 1200px) {
  .admin-layout-root .adm-main {
    padding: 29px 25px;
  }

  .admin-layout-root .adm-sidebar {
    width: 190px;
  }

  .admin-layout-root .adm-header {
    padding: 0 23px;
  }

  .admin-layout-root .adm-header-actions {
    gap: 14px;
  }
}
@media (max-width: 1020px) {
  .admin-layout-root .adm-sidebar {
    width: 175px;
    padding-left: 10px;
    padding-right: 10px;
  }

  .admin-layout-root .adm-header-link {
    font-size: 10px;
  }

  .admin-layout-root .adm-breadcrumb {
    gap: 7px;
    font-size: 10px;
  }

  .admin-layout-root .adm-breadcrumb > span {
    padding-left: 5px;
    border: 0;
  }

  .admin-layout-root .adm-header {
    gap: 17px;
  }

  .admin-layout-root .adm-header-actions {
    gap: 12px;
  }
}
@media (max-width: 760px) {
  .admin-layout-root .adm-sidebar {
    width: 62px;
    padding: 23px 10px 15px;
    align-items: center;
  }

  .admin-layout-root .adm-back-link {
    padding: 0 0 23px;
  }

  .admin-layout-root .adm-back-link > span,
  .admin-layout-root .adm-sidebar-label,
  .admin-layout-root .adm-sidebar-item > span,
  .admin-layout-root .adm-sidebar-bottom {
    display: none;
  }

  .admin-layout-root .adm-sidebar-item {
    padding: 12px;
  }

  .admin-layout-root .adm-sidebar-item > .adm-sidebar-count {
    display: none;
  }

  .admin-layout-root .adm-main {
    padding: 25px 20px;
  }

  .admin-layout-root .adm-breadcrumb {
    display: none;
  }

  .admin-layout-root .adm-header {
    height: 62px;
    padding: 0 18px;
  }

  .admin-layout-root .adm-header-link {
    gap: 0;
  }

  .admin-layout-root .adm-header-link > span {
    display: none;
  }

  .admin-layout-root .adm-header-actions {
    gap: 17px;
  }

  .admin-layout-root .adm-brand {
    font-size: 21px;
  }

  .admin-layout-root .adm-brand > span {
    height: 33px;
    width: 33px;
  }
}
@media (max-width: 570px) {
  .admin-layout-root {
    min-height: 540px;
  }

  .admin-layout-root .adm-sidebar {
    display: none;
  }

  .admin-layout-root .adm-header {
    padding: 0 14px;
    height: 59px;
  }

  .admin-layout-root .adm-brand {
    font-size: 20px;
    gap: 7px;
  }

  .admin-layout-root .adm-brand > span {
    height: 31px;
    width: 31px;
    border-radius: 9px;
  }

  .admin-layout-root .adm-brand i {
    display: none;
  }

  .admin-layout-root .adm-header-actions {
    gap: 14px;
  }

  .admin-layout-root .adm-main {
    padding: 24px 14px;
  }
}

.admin-layout-root .adm-mobile-nav {
  display: none;
}
@media (max-width: 570px) {
  .admin-layout-root .adm-mobile-nav {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    padding: 8px 17px;
    border-bottom: 1px solid #e6ebf2;
    background: #fff;
  }

  .admin-layout-root .adm-mobile-nav > a {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    padding: 8px 10px;
    border-radius: 7px;
    color: #9aa7bc;
  }

  .admin-layout-root .adm-mobile-nav > a[aria-current='page'] {
    color: #7d89cd;
    background: #f0f2fd;
  }
}

.admin-layout-root .admin-mode-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #9aa5ba;
  font-size: 10px;
  border-left: 1px solid #e6eaf2;
  padding-left: 24px;
}

.admin-layout-root.admin-area .adm-header-actions {
  margin-left: auto;
}

.admin-layout-root.admin-area .adm-sidebar {
  padding-top: 24px;
}

.admin-layout-root.admin-area .adm-sidebar-item > svg {
  flex-shrink: 0;
}

.admin-layout-root.admin-area .adm-sidebar-item {
  margin-bottom: 5px;
}

.admin-layout-root.admin-area .adm-main {
  scrollbar-width: thin;
  scrollbar-color: #dce3f0 transparent;
}

.admin-layout-root .admin-content-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #a0aabd;
  font-size: 10px;
  margin-bottom: 23px !important;
  min-height: 16px;
}
@media (max-width: 760px) {
  .admin-layout-root .admin-mode-label {
    padding-left: 12px;
    font-size: 9px;
  }

  .admin-layout-root .admin-content-breadcrumb {
    margin-bottom: 18px !important;
  }
}
@media (max-width: 420px) {
  .admin-layout-root .admin-mode-label {
    font-size: 8px;
    border: 0;
    padding-left: 0;
  }

  .admin-layout-root .admin-mode-label svg {
    display: none;
  }

  .admin-layout-root.admin-area .adm-header {
    gap: 10px;
  }

  .admin-layout-root.admin-area .adm-brand {
    font-size: 19px;
  }

  .admin-layout-root .admin-content-breadcrumb {
    font-size: 9px;
  }
}
`;
