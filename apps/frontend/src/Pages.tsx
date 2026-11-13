import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Building2, LoaderCircle } from 'lucide-react';
import App from './App';
import { useAuth } from './auth/AuthProvider';
import LoginPage from './auth/LoginPage';
import { useOffices } from './offices/OfficeProvider';
import UserMenu from './auth/UserMenu';
import { parseOfficeRoute } from './admin/routes';
import {
  parseBookingLink,
  proposalToBookingPrefill,
  validateBookingLink,
} from './client/bookingLink';
import type { BookingPrefill } from './client/bookingLink';
import type { BookingProposal } from './api/client';

const ClientApp = lazy(() => import('./client/ClientApp'));
const UsersPage = lazy(() => import('./admin/UsersPage'));
const OfficesPage = lazy(() => import('./admin/OfficesPage'));
const OfficePage = lazy(() => import('./admin/OfficePage'));
const BookingsPage = lazy(() => import('./admin/BookingsPage'));
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

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <Loading />;
}

function Loading() {
  return (
    <div className="auth-status-page">
      <LoaderCircle className="auth-spinner" size={24} aria-label="Открываем офис" />
    </div>
  );
}

function ServiceNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="server-service-notice" role="alert">
      <span>{message}</span>
      <button type="button" onClick={() => window.dispatchEvent(new Event('focus'))}>
        Повторить
      </button>
    </div>
  );
}

/** Resolve and select a permitted URL target before mounting any booking UI. */
function BookingDestination({ serviceError }: { serviceError: string | null }) {
  const { user } = useAuth();
  const catalog = useOffices();
  const [link] = useState(() => {
    try {
      return { prefill: parseBookingLink(window.location.search), error: '' };
    } catch (cause) {
      return {
        prefill: null,
        error: cause instanceof Error ? cause.message : 'Не удалось прочитать ссылку на форму.',
      };
    }
  });
  const [handedOff, setHandedOff] = useState(!link.prefill);
  const [accepted, setAccepted] = useState<BookingPrefill | undefined>();
  const prefillOfficeSeen = useRef(false);
  const [selectionError, setSelectionError] = useState('');
  let linkError = link.error || selectionError;
  let validated: BookingPrefill | undefined;
  if (link.prefill && !handedOff && !linkError) {
    const target = catalog.accessibleOffices.find((item) => item.id === link.prefill!.officeId);
    if (!target) linkError = 'Офис из ссылки недоступен или больше не существует.';
    else {
      try {
        validated = validateBookingLink(link.prefill, target);
      } catch (cause) {
        linkError = cause instanceof Error ? cause.message : 'Пространство из ссылки недоступно.';
      }
    }
  }
  useEffect(() => {
    if (handedOff || linkError || !validated) return;
    try {
      if (catalog.office?.id !== validated.officeId) catalog.selectOffice(validated.officeId);
      setAccepted(validated);
      setHandedOff(true);
    } catch (cause) {
      setSelectionError(
        cause instanceof Error ? cause.message : 'Не удалось выбрать офис из ссылки.',
      );
    }
  }, [handedOff, linkError, validated, catalog.office?.id, catalog.selectOffice]);
  useEffect(() => {
    if (!handedOff || !accepted) return;
    if (catalog.office?.id === accepted.officeId) {
      prefillOfficeSeen.current = true;
    } else if (prefillOfficeSeen.current) {
      setAccepted(undefined);
    }
  }, [handedOff, accepted, catalog.office?.id]);

  const openProposal = useCallback(
    (proposal: BookingProposal) => {
      const prefill = proposalToBookingPrefill(proposal);
      const target = catalog.accessibleOffices.find((item) => item.id === prefill.officeId);
      if (!target) throw new Error('Офис из предложения недоступен или больше не существует.');
      const next = validateBookingLink(prefill, target);
      catalog.selectOffice(next.officeId);
      prefillOfficeSeen.current = false;
      setAccepted(next);
    },
    [catalog.accessibleOffices, catalog.selectOffice],
  );

  if (linkError)
    return (
      <>
        <ServiceNotice message={serviceError} />
        <div className="auth-status-page">
          <section className="auth-status-card">
            <Building2 size={30} />
            <h1>Не удалось открыть форму из ссылки</h1>
            <p role="alert">{linkError}</p>
            <p>Выбранный офис сохранён. Бронь не создавалась.</p>
            <a href="/booking">Перейти к бронированию</a>
            <UserMenu />
          </section>
        </div>
      </>
    );
  if (!handedOff) return <Loading />;
  const office = catalog.office;
  if (!office)
    return (
      <>
        <ServiceNotice message={serviceError} />
        <div className="auth-status-page">
          <section className="auth-status-card">
            <Building2 size={32} />
            <h1>Пока нет доступных офисов</h1>
            <p>
              {user?.role === 'admin'
                ? 'Создайте офис или перенесите сохранённый план в администрировании.'
                : `${user?.firstName || ''}, попросите администратора открыть доступ к вашему офису.`}
            </p>
            {user?.role === 'admin' && <a href="/admin/offices">Управление офисами</a>}
            <UserMenu />
          </section>
        </div>
      </>
    );
  return (
    <>
      <ServiceNotice message={serviceError} />
      <DataBoundary key={`${user?.id}:${office.id}:booking`} admin={false}>
        <Suspense fallback={<Loading />}>
          <ClientApp
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
  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : 'Не удалось открыть сохранённые данные.',
    };
  }
  render() {
    if (this.state.message)
      return (
        <div className="auth-status-page">
          <section className="auth-status-card">
            <Building2 size={30} />
            <h1>Не удалось открыть данные</h1>
            <p>{this.state.message}</p>
            <button onClick={() => window.location.reload()}>Попробовать снова</button>
            {this.props.admin && <a href="/admin/offices">К списку офисов</a>}
          </section>
        </div>
      );
    return this.props.children;
  }
}

export default function Pages() {
  const { ready, user, error } = useAuth();
  const catalog = useOffices();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const adminRoute = path === '/admin' || path.startsWith('/admin/') || path === '/settings';
  if (!ready) return <Loading />;
  if (error && !user)
    return (
      <div className="auth-status-page">
        <section className="auth-status-card">
          <Building2 size={30} />
          <h1>Не удалось открыть учётные записи</h1>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Попробовать снова</button>
        </section>
      </div>
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
      <div className="auth-status-page">
        <section className="auth-status-card">
          <Building2 size={30} />
          <h1>Не удалось открыть офисы</h1>
          <p>{catalog.error}</p>
          <button onClick={() => window.location.reload()}>Попробовать снова</button>
        </section>
      </div>
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
          <App office={office} />
        ) : route.view === 'bookings' ? (
          <BookingsPage office={office} />
        ) : (
          <OfficePage office={office} />
        );
    else
      page = (
        <div className="auth-status-page">
          <section className="auth-status-card">
            <Building2 size={30} />
            <h1>Офис не найден</h1>
            <p>Откройте нужный офис из списка.</p>
            <a href="/admin/offices">К списку офисов</a>
          </section>
        </div>
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
