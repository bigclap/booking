import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { AuthContextValue, AuthSnapshot, UserInput, UserUpdate } from '../types';
import { ApiError } from '../../shared/api';
import { gateway, SESSION_INVALIDATED_EVENT } from '../../shared/api';

const AuthContext = createContext<AuthContextValue | null>(null);
const emptySnapshot = (): AuthSnapshot => ({ user: null, users: [], expiresAt: null });
const CHANNEL_NAME = 'plan-room:server-auth';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось получить данные учётной записи.';
const unauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

type SessionNotice = { type: 'signed-out' | 'session-changed' | 'accounts-updated' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(emptySnapshot);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const mounted = useRef(false);
  const generation = useRef(0);
  const sessionTransition = useRef(false);
  const loginPending = useRef(false);
  const pendingGatewayInvalidation = useRef(false);
  const mutationPending = useRef(false);
  const readsAllowed = useRef(true);
  const channel = useRef<BroadcastChannel | null>(null);
  const refreshFlight = useRef<{ generation: number; promise: Promise<AuthSnapshot> } | null>(null);
  const isCurrent = useCallback(
    (version: number) => mounted.current && generation.current === version,
    [],
  );
  const requireCurrent = useCallback(
    (version: number) => {
      if (!isCurrent(version))
        throw new Error('Сессия изменилась. Повторите действие после входа.');
    },
    [isCurrent],
  );
  const apply = useCallback((next: AuthSnapshot) => {
    const identity = (value: AuthSnapshot) =>
      value.user
        ? JSON.stringify([
            value.user.id,
            value.user.role,
            value.user.active,
            [...value.user.buildingIds].sort(),
          ])
        : '';
    if (identity(next) !== identity(snapshotRef.current)) gateway.invalidateIdentity();
    snapshotRef.current = next;
    readsAllowed.current = next.user !== null;
    setSnapshot(next);
    setReady(true);
    setError(null);
  }, []);
  const broadcast = useCallback((notice: SessionNotice) => {
    // Cross-tab notices contain no identity, password, cookie or token.
    try {
      channel.current?.postMessage(notice);
    } catch {
      /* Closing a tab must not turn a confirmed operation into a failure. */
    }
  }, []);
  const invalidate = useCallback(
    (notify = true) => {
      gateway.invalidateIdentity();
      generation.current++;
      readsAllowed.current = false;
      if (mounted.current) apply(emptySnapshot());
      if (notify) broadcast({ type: 'signed-out' });
    },
    [apply, broadcast],
  );

  const refresh = useCallback(
    (force = false): Promise<AuthSnapshot> => {
      if (
        !mounted.current ||
        (!force && (sessionTransition.current || mutationPending.current || !readsAllowed.current))
      )
        return Promise.resolve(snapshotRef.current);
      const version = generation.current;
      if (refreshFlight.current?.generation === version) return refreshFlight.current.promise;
      const promise = gateway
        .getSession()
        .then((next) => {
          if (isCurrent(version)) apply(next);
          return next;
        })
        .catch((cause) => {
          if (isCurrent(version)) {
            if (unauthorized(cause)) invalidate();
            else {
              setReady(true);
              setError(message(cause));
            } // Preserve the last confirmed identity during a 503/network outage.
          }
          throw cause;
        })
        .finally(() => {
          if (refreshFlight.current?.promise === promise) refreshFlight.current = null;
        });
      refreshFlight.current = { generation: version, promise };
      return promise;
    },
    [apply, invalidate, isCurrent],
  );

  useEffect(() => {
    mounted.current = true;
    readsAllowed.current = true;
    const invalidated = () => {
      // A protected request from the previous identity must not cancel a login
      // that is waiting for its own authoritative server response.
      if (loginPending.current) {
        pendingGatewayInvalidation.current = true;
        return;
      }
      invalidate();
    };
    const focused = () => {
      void refresh().catch(() => {});
    };
    const visible = () => {
      if (document.visibilityState === 'visible') focused();
    };
    const sessionChannel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    channel.current = sessionChannel;
    if (sessionChannel)
      sessionChannel.onmessage = (event: MessageEvent<unknown>) => {
        if (!event.data || typeof event.data !== 'object') return;
        const notice = event.data as Partial<SessionNotice>;
        if (notice.type === 'signed-out') invalidate(false);
        if (notice.type === 'accounts-updated') {
          void refresh().catch(() => {});
        }
        if (notice.type === 'session-changed') {
          gateway.invalidateIdentity();
          // A different tab changed the server session. Drop the old person's view
          // before asking the server who owns the shared cookies now.
          generation.current++;
          apply(emptySnapshot());
          readsAllowed.current = true;
          setReady(false);
          void refresh(true).catch(() => {});
        }
      };
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidated);
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', visible);
    // Access cookies are short-lived; GatewayClient refreshes once on eligible
    // 401s. This polling/focus check also discovers blocking and role changes.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') focused();
    }, 60000);
    void refresh(true).catch(() => {});
    return () => {
      mounted.current = false;
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidated);
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', visible);
      if (channel.current === sessionChannel) channel.current = null;
      sessionChannel?.close();
    };
  }, [apply, invalidate, refresh]);

  const beginTransition = useCallback(() => {
    if (sessionTransition.current) throw new Error('Дождитесь завершения входа или выхода.');
    sessionTransition.current = true;
    return ++generation.current;
  }, []);
  const signIn = useCallback(
    async (login: string, password: string): Promise<void> => {
      const version = beginTransition();
      loginPending.current = true;
      pendingGatewayInvalidation.current = false;
      try {
        const next = await gateway.signIn(login, password);
        requireCurrent(version);
        if (!next.user) throw new Error('Сервер не подтвердил вход. Попробуйте ещё раз.');
        apply(next);
        broadcast({ type: 'session-changed' });
      } catch (cause) {
        if (isCurrent(version) && pendingGatewayInvalidation.current) invalidate();
        throw cause;
      } finally {
        loginPending.current = false;
        pendingGatewayInvalidation.current = false;
        sessionTransition.current = false;
      }
    },
    [apply, beginTransition, broadcast, invalidate, isCurrent, requireCurrent],
  );
  const confirmSignedOut = useCallback(
    (version: number) => {
      if (!mounted.current) return;
      if (!isCurrent(version)) {
        // A confirmed protected 401 may have cleared the same session while the
        // logout/password response was in flight. Its successful 204 stays success.
        if (snapshotRef.current.user === null && !readsAllowed.current) return;
        requireCurrent(version); // A newer authenticated session must be preserved.
      }
      apply(emptySnapshot());
      broadcast({ type: 'signed-out' });
    },
    [apply, broadcast, isCurrent, requireCurrent],
  );
  const signOut = useCallback(async (): Promise<void> => {
    const version = beginTransition();
    try {
      await gateway.signOut();
      confirmSignedOut(version);
    } finally {
      sessionTransition.current = false;
    }
  }, [beginTransition, confirmSignedOut]);

  const mutate = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      if (sessionTransition.current) throw new Error('Дождитесь завершения входа или выхода.');
      if (mutationPending.current) throw new Error('Дождитесь завершения предыдущего изменения.');
      mutationPending.current = true;
      const version = ++generation.current;
      try {
        const result = await operation();
        requireCurrent(version);
        let next: AuthSnapshot;
        try {
          next = await gateway.getSession();
        } catch (cause) {
          if (unauthorized(cause)) throw cause;
          throw new Error(
            'Сервер принял изменение, но получить актуальные данные не удалось. Обновите страницу перед повтором.',
          );
        }
        requireCurrent(version);
        apply(next);
        broadcast({ type: next.user ? 'accounts-updated' : 'signed-out' });
        return result;
      } catch (cause) {
        // Validation/conflict/network failures belong to the form. They must not
        // replace the application with a bootstrap error or fabricate success.
        if (isCurrent(version) && unauthorized(cause)) invalidate();
        throw cause;
      } finally {
        mutationPending.current = false;
      }
    },
    [apply, broadcast, invalidate, isCurrent, requireCurrent],
  );
  const createUser = useCallback(
    (input: UserInput) => mutate(() => gateway.createUser(input)),
    [mutate],
  );
  const updateUser = useCallback(
    (id: string, input: UserUpdate) => mutate(() => gateway.updateUser(id, input)),
    [mutate],
  );
  const resetPassword = useCallback(
    (id: string, password: string) => mutate(() => gateway.resetPassword(id, password)),
    [mutate],
  );
  const changePassword = useCallback(
    async (current: string, password: string): Promise<void> => {
      const version = beginTransition();
      try {
        await gateway.changePassword(current, password);
        confirmSignedOut(version);
      } catch (cause) {
        if (isCurrent(version) && unauthorized(cause)) invalidate();
        throw cause;
      } finally {
        sessionTransition.current = false;
      }
    },
    [beginTransition, confirmSignedOut, invalidate, isCurrent],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user: snapshot.user,
      users: snapshot.users,
      error,
      signIn,
      signOut,
      createUser,
      updateUser,
      resetPassword,
      changePassword,
    }),
    [
      ready,
      snapshot,
      error,
      signIn,
      signOut,
      createUser,
      updateUser,
      resetPassword,
      changePassword,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth должен использоваться внутри AuthProvider.');
  return value;
}

export default AuthProvider;
