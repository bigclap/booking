import { useEffect } from 'react';
import { useAuth } from '../../auth/hooks';
import { ApiError } from '../../shared/api';
import { gateway } from '../../shared/api';
import { decodeServerSync, SERVER_SYNC_EVENT } from '../../shared/lib';
import type { ServerSync } from '../../shared/lib';

/** One cookie-authenticated invalidation stream. Every reconnect fetches fresh HTTP snapshots. */
export default function ServerEvents() {
  const { user } = useAuth();
  const scope = user ? JSON.stringify([user.id, user.role, user.active, user.buildingIds]) : '';
  useEffect(() => {
    if (!scope) return;
    let stopped = false;
    let source: EventSource | null = null;
    let timer: number | undefined;
    let recovering = false;
    let delay = 1000;
    const sync = (type: ServerSync['type'], event: Event) => {
      const detail = decodeServerSync(type, (event as MessageEvent<unknown>).data);
      if (!detail) return;
      window.dispatchEvent(new CustomEvent<ServerSync>(SERVER_SYNC_EVENT, { detail }));
    };
    const recover = async (refresh: boolean) => {
      if (stopped || recovering) return;
      recovering = true;
      source?.close();
      source = null;
      try {
        const snapshot = refresh ? await gateway.refreshSession() : await gateway.getSession();
        if (stopped || !snapshot.user) return;
        timer = window.setTimeout(connect, delay);
        delay = Math.min(15_000, delay * 2);
      } catch (cause) {
        if (!stopped && !(cause instanceof ApiError && cause.status === 401)) {
          timer = window.setTimeout(() => {
            recovering = false;
            void recover(false);
          }, delay);
          delay = Math.min(15_000, delay * 2);
        }
      } finally {
        recovering = false;
      }
    };
    function connect() {
      if (stopped) return;
      source = new EventSource('/api/events', { withCredentials: true });
      source.addEventListener('ready', (event) => {
        delay = 1000;
        sync('ready', event);
      });
      for (const type of ['resync', 'booking.changed', 'office.changed', 'chat.changed'] as const)
        source.addEventListener(type, (event) => sync(type, event));
      source.addEventListener('auth.expired', () => {
        void recover(true);
      });
      source.onerror = () => {
        void recover(false);
      };
    }
    connect();
    return () => {
      stopped = true;
      source?.close();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [scope]);
  return null;
}
