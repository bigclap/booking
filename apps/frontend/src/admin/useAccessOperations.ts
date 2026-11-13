import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCESS_OPERATION_EVENT, gateway } from '../api/gateway';
import { createAccessOperationsTracker, type AccessOperationsState } from './accessOperations';

const empty: AccessOperationsState = { operations: [], loading: false, error: false };

export function useAccessOperations(adminId: string | null) {
  const [snapshot, setSnapshot] = useState<AccessOperationsState & { owner: string | null }>({
    ...empty,
    owner: null,
  });
  const currentOwner = useRef(adminId);
  currentOwner.current = adminId;
  const trackerRef = useRef<{
    owner: string;
    tracker: ReturnType<typeof createAccessOperationsTracker>;
  } | null>(null);

  useEffect(() => {
    if (!adminId) return;
    let active = true;
    const tracker = createAccessOperationsTracker(
      gateway,
      (state) => {
        if (active && currentOwner.current === adminId) setSnapshot({ ...state, owner: adminId });
      },
      () => document.visibilityState === 'visible',
    );
    trackerRef.current = { owner: adminId, tracker };
    const receipt = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id === 'string' && id.trim()) void tracker.observe(id);
    };
    const focus = () => {
      if (document.visibilityState === 'visible') void tracker.refresh();
    };
    const visibility = () => tracker.visibilityChanged();
    window.addEventListener(ACCESS_OPERATION_EVENT, receipt);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    tracker.start();
    return () => {
      active = false;
      tracker.dispose();
      if (trackerRef.current?.tracker === tracker) trackerRef.current = null;
      window.removeEventListener(ACCESS_OPERATION_EVENT, receipt);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [adminId]);

  const refresh = useCallback(() => {
    const current = trackerRef.current;
    return current?.owner === adminId ? current.tracker.refresh() : Promise.resolve();
  }, [adminId]);
  const visible =
    adminId && snapshot.owner === adminId ? snapshot : { ...empty, loading: !!adminId };
  return { ...visible, refresh };
}
