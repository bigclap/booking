import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type BookingInput, type BookingPolicy } from '../../shared/api';
import { gateway } from '../../shared/api';
import { SERVER_SYNC_EVENT, type ServerSync } from '../../shared/lib';
import type { ClientBooking } from '../types';

const UPDATE_EVENT = 'plan-room:server-bookings-updated';
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Не удалось загрузить брони.';

/** Server records only. Browser preview data remains an untouched archive. */
export function useBookings(officeId: string) {
  const [bookings, setBookings] = useState<ClientBooking[]>([]);
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(() => ({ local: Date.now(), offset: 0 }));
  const alive = useRef(false);
  const epoch = useRef(0);
  const mutating = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const createAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    try {
      const records = await gateway.listBookings(officeId);
      if (!alive.current || request !== epoch.current) return;
      setBookings(records);
      setAvailable(true);
      setError('');
    } catch (cause) {
      if (!alive.current || request !== epoch.current) return;
      setAvailable(false);
      setError(message(cause));
    } finally {
      if (alive.current && request === epoch.current) setLoading(false);
    }
  }, [officeId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    void gateway
      .getPolicy()
      .then((value) => {
        if (alive.current) {
          setPolicy(value);
          setClock({ local: Date.now(), offset: Date.parse(value.serverNow) - Date.now() });
        }
      })
      .catch(() => {
        /* Commands still enforce the server policy. */
      });
    const clockTimer = window.setInterval(
      () => setClock((previous) => ({ ...previous, local: Date.now() })),
      30_000,
    );
    const update = (event: Event) => {
      if ((event as CustomEvent<string>).detail === officeId) void refresh();
    };
    const focus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const sync = (event: Event) => {
      const data = (event as CustomEvent<ServerSync>).detail;
      if (
        data.type === 'ready' ||
        data.type === 'resync' ||
        (data.type === 'booking.changed' && data.officeId === officeId)
      )
        void refresh();
    };
    window.addEventListener(UPDATE_EVENT, update);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener(SERVER_SYNC_EVENT, sync);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('plan-room.server-bookings');
      channel.current.onmessage = (event) => {
        if (event.data === officeId) void refresh();
      };
    }
    return () => {
      alive.current = false;
      ++epoch.current;
      window.clearInterval(clockTimer);
      window.removeEventListener(UPDATE_EVENT, update);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener(SERVER_SYNC_EVENT, sync);
      channel.current?.close();
      channel.current = null;
    };
  }, [officeId, refresh]);

  const mutate = useCallback(
    async (command: () => Promise<ClientBooking>) => {
      if (mutating.current) throw new Error('Дождитесь завершения предыдущего действия.');
      mutating.current = true;
      setSaving(true);
      ++epoch.current;
      try {
        const result = await command();
        if (alive.current) {
          ++epoch.current;
          setBookings((previous) => [...previous.filter((item) => item.id !== result.id), result]);
          setError('');
          setAvailable(true);
          channel.current?.postMessage(officeId);
          window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: officeId }));
        }
        return result;
      } catch (cause) {
        // A timeout can hide a successful write. Re-read, never repeat the command blindly.
        if (!(cause instanceof ApiError) || cause.status !== 401) await refresh();
        throw cause;
      } finally {
        mutating.current = false;
        if (alive.current) setSaving(false);
      }
    },
    [officeId, refresh],
  );

  return {
    bookings,
    policy,
    serverNow: clock.local + clock.offset,
    loading,
    available,
    error,
    saving,
    refresh,
    create: (input: BookingInput) =>
      mutate(async () => {
        const fingerprint = JSON.stringify(input);
        if (createAttempt.current?.fingerprint !== fingerprint)
          createAttempt.current = { fingerprint, key: crypto.randomUUID() };
        const result = await gateway.createBooking(officeId, input, createAttempt.current.key);
        createAttempt.current = null;
        return result;
      }),
    update: (booking: ClientBooking, input: BookingInput) =>
      mutate(() => gateway.updateBooking(officeId, booking, input)),
    cancel: (booking: ClientBooking) => mutate(() => gateway.cancelBooking(officeId, booking)),
  };
}
