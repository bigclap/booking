import { Component, lazy, Suspense, useEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import { StatusPage, StatusCard } from '../auth/molecules';
import { Button, Spinner } from '../shared/atoms';
import { Notice } from '../shared/molecules';
import { useAuth } from '../auth/hooks';
import LoginPage from '../auth/pages/LoginPage';
import { useOffices } from '../office/hooks';
import { UserMenu } from '../auth/organisms';
import { parseOfficeRoute } from '../office/routes';
import { useBookingDestination } from '../booking/hooks';

const BookingPage = lazy(() => import('../booking/pages/BookingPage'));
const OfficePlanPage = lazy(() => import('../office/pages/OfficePlanPage'));
const UsersPage = lazy(() => import('../users/pages/UsersPage'));
const OfficesPage = lazy(() => import('../office/pages/OfficesPage'));
const OfficeSettingsPage = lazy(() => import('../office/pages/OfficeSettingsPage'));
const AdminBookingsPage = lazy(() => import('../booking/pages/AdminBookingsPage'));
const knownRoute = (path: string) =>
  ['/', '/booking', '/admin', '/admin/users', '/admin/offices', '/settings'].includes(path) ||
  !!parseOfficeRoute(path);

function knownDestination(value: string): string | null {
  if (
    value.length > 12000 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.hash || !knownRoute(url.pathname)) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

function Redirect({ to }: { to: string }): ReactElement {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <Loading />;
}

function Loading(): ReactElement {
  return (
    <StatusPage>
      <Spinner size={24} aria-label="Открываем офис" />
    </StatusPage>
  );
}

function ServiceNotice({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <Notice
      tone="warning"
      role="alert"
      style={{
        position: 'fixed',
        zIndex: 500,
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 'calc(100vw - 24px)',
        alignItems: 'center',
        padding: '10px 14px',
        boxShadow: '0 3px 16px #5f4b2420',
      }}
      actions={
        <Button size="sm" variant="ghost" onClick={() => window.dispatchEvent(new Event('focus'))}>
          Повторить
        </Button>
      }
    >
      {message}
    </Notice>
  );
}

/** Resolve and select a permitted URL target before mounting any booking UI. */
function BookingDestination({ serviceError }: { serviceError: string | null }): ReactElement {
  const { user, office, linkError, handedOff, accepted, openProposal } = useBookingDestination();

  if (linkError)
    return (
      <>
        <ServiceNotice message={serviceError} />
        <StatusPage>
          <StatusCard>
            <Building2 size={30} />
            <h1>Не удалось открыть форму из ссылки</h1>
            <p role="alert">{linkError}</p>
            <p>Выбранный офис сохранён. Бронь не создавалась.</p>
            <a href="/booking">Перейти к бронированию</a>
            <UserMenu />
          </StatusCard>
        </StatusPage>
      </>
    );
  if (!handedOff) return <Loading />;
  if (!office)
    return (
      <>
        <ServiceNotice message={serviceError} />
        <StatusPage>
          <StatusCard>
            <Building2 size={32} />
            <h1>Пока нет доступных офисов</h1>
            <p>
              {user?.role === 'admin'
                ? 'Создайте офис или перенесите сохранённый план в администрировании.'
                : `${user?.firstName || ''}, попросите администратора открыть доступ к вашему офису.`}
            </p>
            {user?.role === 'admin' && <a href="/admin/offices">Управление офисами</a>}
            <UserMenu />
          </StatusCard>
        </StatusPage>
      </>
    );
  return (
    <>
      <ServiceNotice message={serviceError} />
      <DataBoundary key={`${user?.id}:${office.id}:booking`} admin={false}>
        <Suspense fallback={<Loading />}>
          <BookingPage
            office={office}
            bookingPrefill={accepted?.officeId === office.id ? accepted : undefined}
            onProposal={openProposal}
          />
        </Suspense>
      </DataBoundary>
    </>
  );
}

class DataBoundary extends Component<
  { children: ReactNode; admin: boolean },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown): { message: string } {
    return {
      message: error instanceof Error ? error.message : 'Не удалось открыть сохранённые данные.',
    };
  }
  render(): ReactNode {
    if (this.state.message)
      return (
        <StatusPage>
          <StatusCard>
            <Building2 size={30} />
            <h1>Не удалось открыть данные</h1>
            <p>{this.state.message}</p>
            <Button variant="ghost" onClick={() => window.location.reload()}>
              Попробовать снова
            </Button>
            {this.props.admin && <a href="/admin/offices">К списку офисов</a>}
          </StatusCard>
        </StatusPage>
      );
    return this.props.children;
  }
}

export default function Router(): ReactElement {
  const { ready, user, error } = useAuth();
  const catalog = useOffices();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const adminRoute = path === '/admin' || path.startsWith('/admin/') || path === '/settings';
  if (!ready) return <Loading />;
  if (error && !user)
    return (
      <StatusPage>
        <StatusCard>
          <Building2 size={30} />
          <h1>Не удалось открыть учётные записи</h1>
          <p>{error}</p>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Попробовать снова
          </Button>
        </StatusCard>
      </StatusPage>
    );
  if (!user)
    return path === '/login' ? (
      <LoginPage />
    ) : (
      <Redirect
        to={
          '/login?next=' +
          encodeURIComponent(knownRoute(path) ? path + window.location.search : '/booking')
        }
      />
    );
  if (path === '/login') {
    const next =
      knownDestination(new URLSearchParams(window.location.search).get('next') || '/booking') ||
      '/booking';
    const destinationPath = new URL(next, window.location.origin).pathname;
    const allowed =
      user.role === 'admin' || destinationPath === '/' || destinationPath === '/booking';
    return <Redirect to={allowed ? next : '/booking'} />;
  }
  if (adminRoute && user.role !== 'admin') return <Redirect to="/booking" />;
  if (path === '/') return <Redirect to={'/booking' + window.location.search} />;
  if (path === '/admin') return <Redirect to="/admin/offices" />;
  if (path === '/settings') return <Redirect to="/admin/users" />;
  if (!catalog.ready) return <Loading />;
  if (catalog.error && !catalog.hasSnapshot)
    return (
      <StatusPage>
        <StatusCard>
          <Building2 size={30} />
          <h1>Не удалось открыть офисы</h1>
          <p>{catalog.error}</p>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Попробовать снова
          </Button>
        </StatusCard>
      </StatusPage>
    );
  const serviceError = error || catalog.error;

  if (adminRoute) {
    const route = parseOfficeRoute(path);
    const office = route ? catalog.offices.find((item) => item.id === route.officeId) : undefined;
    let page: ReactNode;
    if (path === '/admin/offices') page = <OfficesPage />;
    else if (path === '/admin/users') page = <UsersPage />;
    else if (route && office)
      page =
        route.view === 'plan' ? (
          <OfficePlanPage office={office} />
        ) : route.view === 'bookings' ? (
          <AdminBookingsPage office={office} />
        ) : (
          <OfficeSettingsPage office={office} />
        );
    else
      page = (
        <StatusPage>
          <StatusCard>
            <Building2 size={30} />
            <h1>Офис не найден</h1>
            <p>Откройте нужный офис из списка.</p>
            <a href="/admin/offices">К списку офисов</a>
          </StatusCard>
        </StatusPage>
      );
    // Administrative entities and component lifetimes are bound to the URL, never the client selection.
    return (
      <>
        <ServiceNotice message={serviceError} />
        <DataBoundary key={`${user.id}:${path}`} admin>
          <Suspense fallback={<Loading />}>{page}</Suspense>
        </DataBoundary>
      </>
    );
  }

  if (path !== '/booking') return <Redirect to="/booking" />;
  return (
    <BookingDestination
      key={`${user.id}:${path}:${window.location.search}`}
      serviceError={serviceError}
    />
  );
}
