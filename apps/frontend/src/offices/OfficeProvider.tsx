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
import { parseConfig } from '../model';
import type { Floor, OfficeConfig } from '../model';
import { useAuth } from '../auth/AuthProvider';
import { gateway } from '../api/gateway';
import type { OfficeCreateInput, OfficeSettingsInput } from '../api/client';

export interface OfficeContextValue {
  offices: OfficeConfig[];
  accessibleOffices: OfficeConfig[];
  office: OfficeConfig | null;
  error: string | null;
  ready: boolean;
  hasSnapshot: boolean;
  selectOffice(id: string): void;
  createOffice(input: OfficeCreateInput): Promise<OfficeConfig>;
  updateOfficeSettings(
    id: string,
    input: OfficeSettingsInput,
    revision?: number,
  ): Promise<OfficeConfig>;
  saveOfficePlan(id: string, floors: Floor[], revision?: number): Promise<OfficeConfig>;
  refresh(): Promise<void>;
}
const OfficeContext = createContext<OfficeContextValue | null>(null);
const EMPTY_OFFICES: OfficeConfig[] = [];
// Only this UI preference is local. Office documents and plans are server data.
const SELECTION_PREFIX = 'plan-room.office-selection.v1.';
const SELECTION_EVENT = 'plan-room:office-selection';
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Не удалось загрузить офисы.';
const staleIdentity = () => new Error('Сессия изменилась. Повторите действие после входа.');

interface Scope {
  key: string;
  epoch: number;
}
interface OfficeSnapshot extends Scope {
  offices: OfficeConfig[];
  selectedId: string | null;
  error: string | null;
  ready: boolean;
  hasSnapshot: boolean;
}
interface MutationSnapshot extends Scope {
  sequence: number;
  office: OfficeConfig;
}
const sameScope = (a: Scope, b: Scope) => a.key === b.key && a.epoch === b.epoch;
const emptySnapshot = (scope: Scope): OfficeSnapshot => ({
  ...scope,
  offices: [],
  selectedId: null,
  error: null,
  ready: false,
  hasSnapshot: false,
});

function selectionKey(userId: string): string {
  return SELECTION_PREFIX + encodeURIComponent(userId);
}
function readSelection(userId: string): string | null {
  try {
    return localStorage.getItem(selectionKey(userId));
  } catch {
    return null;
  }
}
function writeSelection(userId: string, officeId: string): void {
  try {
    localStorage.setItem(selectionKey(userId), officeId);
  } catch {
    /* An unavailable preference store must not block the HTTP application. */
  }
}
function readServerOffice(value: unknown): OfficeConfig {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') throw new Error();
    const document = parseConfig(json);
    if (!Number.isSafeInteger(document.revision) || (document.revision ?? 0) < 1) throw new Error();
    return document;
  } catch {
    throw new Error('Сервер вернул офис в неподдерживаемом формате.');
  }
}
function readServerOffices(value: unknown): OfficeConfig[] {
  if (!Array.isArray(value)) throw new Error('Сервер вернул неподдерживаемый список офисов.');
  const offices = value.map(readServerOffice);
  if (new Set(offices.map((office) => office.id)).size !== offices.length)
    throw new Error('В ответе сервера повторяются офисы.');
  return offices;
}
function latestOffice(current: OfficeConfig | undefined, incoming: OfficeConfig): OfficeConfig {
  return current && (current.revision ?? -1) > (incoming.revision ?? -1) ? current : incoming;
}

export function OfficeProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const identityKey = !authReady
    ? 'auth-pending'
    : !user || !user.active
      ? 'anonymous'
      : JSON.stringify([user.id, user.role, [...user.buildingIds].sort()]);
  const scopeRef = useRef<Scope>({ key: identityKey, epoch: 0 });
  if (scopeRef.current.key !== identityKey)
    scopeRef.current = { key: identityKey, epoch: scopeRef.current.epoch + 1 };
  const userRef = useRef(user);
  userRef.current = user;
  const authReadyRef = useRef(authReady);
  authReadyRef.current = authReady;
  const alive = useRef(false);
  const readSequence = useRef(0);
  const mutationSequence = useRef(0);
  const mutations = useRef(new Map<string, MutationSnapshot>());
  const [snapshot, setSnapshot] = useState<OfficeSnapshot>(() => emptySnapshot(scopeRef.current));
  const snapshotRef = useRef(snapshot);
  const publish = useCallback((change: (previous: OfficeSnapshot) => OfficeSnapshot) => {
    const next = change(snapshotRef.current);
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const current = useCallback(
    (scope: Scope) => alive.current && sameScope(scope, scopeRef.current),
    [],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      scopeRef.current = { ...scopeRef.current, epoch: scopeRef.current.epoch + 1 };
      readSequence.current++;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const scope = { ...scopeRef.current };
    const actor = userRef.current;
    if (!authReadyRef.current || !actor?.active) {
      if (alive.current) publish(() => ({ ...emptySnapshot(scope), ready: authReadyRef.current }));
      return;
    }
    const request = ++readSequence.current;
    const startedAfter = mutationSequence.current;
    publish((previous) => ({
      ...(sameScope(previous, scope) ? previous : emptySnapshot(scope)),
      selectedId: sameScope(previous, scope) ? previous.selectedId : readSelection(actor.id),
      ready: sameScope(previous, scope) && previous.hasSnapshot ? previous.ready : false,
      error: null,
    }));
    try {
      const result = await gateway.listOffices();
      if (!current(scope) || request !== readSequence.current) return;
      const received = readServerOffices(result);
      const byId = new Map(received.map((office) => [office.id, office]));
      for (const update of mutations.current.values()) {
        if (!sameScope(update, scope) || update.sequence <= startedAfter) continue;
        byId.set(update.office.id, latestOffice(byId.get(update.office.id), update.office));
      }
      publish((previous) => {
        if (!current(scope)) return previous;
        const offices = [...byId.values()].map((office) =>
          latestOffice(
            sameScope(previous, scope)
              ? previous.offices.find((item) => item.id === office.id)
              : undefined,
            office,
          ),
        );
        const preferred = sameScope(previous, scope)
          ? previous.selectedId
          : readSelection(actor.id);
        const accessible = offices.filter(
          (item) => actor.role === 'admin' || actor.buildingIds.includes(item.id),
        );
        return {
          ...scope,
          offices,
          selectedId: accessible.some((item) => item.id === preferred)
            ? preferred
            : (accessible[0]?.id ?? null),
          ready: true,
          error: null,
          hasSnapshot: true,
        };
      });
    } catch (cause) {
      if (!current(scope) || request !== readSequence.current) return;
      publish((previous) => ({
        ...(sameScope(previous, scope) ? previous : emptySnapshot(scope)),
        ready: true,
        error: message(cause),
      }));
    }
  }, [current, publish]);

  useEffect(() => {
    mutations.current.clear();
    void refresh();
  }, [identityKey, refresh]);

  useEffect(() => {
    const applyPreference = () => {
      const actor = userRef.current;
      const scope = scopeRef.current;
      if (!actor?.active || !authReadyRef.current) return;
      const selectedId = readSelection(actor.id);
      publish((previous) => {
        if (!sameScope(previous, scope)) return previous;
        const available = previous.offices.filter(
          (item) => actor.role === 'admin' || actor.buildingIds.includes(item.id),
        );
        return {
          ...previous,
          selectedId: available.some((item) => item.id === selectedId)
            ? selectedId
            : (available[0]?.id ?? null),
        };
      });
    };
    const storage = (event: StorageEvent) => {
      const actor = userRef.current;
      if (actor && (event.key === null || event.key === selectionKey(actor.id))) applyPreference();
    };
    const selected = (event: Event) => {
      if ((event as CustomEvent<{ userId?: string }>).detail?.userId === userRef.current?.id)
        applyPreference();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(SELECTION_EVENT, selected);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(SELECTION_EVENT, selected);
    };
  }, [publish]);

  useEffect(() => {
    const focus = () => {
      void refresh();
    };
    const sync = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (type === 'ready' || type === 'resync' || type === 'office.changed') void refresh();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('plan-room:server-sync', sync);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('plan-room:server-sync', sync);
    };
  }, [refresh]);

  const selectOffice = useCallback(
    (id: string) => {
      const actor = userRef.current;
      const cache = snapshotRef.current;
      if (!authReadyRef.current || !actor?.active || !sameScope(cache, scopeRef.current))
        throw staleIdentity();
      const target = cache.offices.find((item) => item.id === id);
      if (!target || (actor.role !== 'admin' && !actor.buildingIds.includes(id)))
        throw new Error('Этот офис вам недоступен.');
      writeSelection(actor.id, id);
      publish((previous) => ({ ...previous, selectedId: id }));
      window.dispatchEvent(
        new CustomEvent(SELECTION_EVENT, { detail: { userId: actor.id, officeId: id } }),
      );
    },
    [publish],
  );

  const beginAdminMutation = useCallback(() => {
    const actor = userRef.current;
    if (!alive.current || !authReadyRef.current || !actor?.active) throw staleIdentity();
    if (actor.role !== 'admin') throw new Error('Это действие доступно только администратору.');
    return { actor, scope: { ...scopeRef.current } };
  }, []);
  const revisionFor = useCallback((id: string, supplied: number | undefined, scope: Scope) => {
    const cache = snapshotRef.current;
    const revision =
      supplied ??
      (sameScope(cache, scope)
        ? cache.offices.find((item) => item.id === id)?.revision
        : undefined);
    if (!Number.isSafeInteger(revision) || (revision ?? 0) < 1)
      throw new Error('Обновите офис перед сохранением: его версия неизвестна.');
    return revision as number;
  }, []);
  const applyOffice = useCallback(
    (document: OfficeConfig, scope: Scope) => {
      if (!current(scope)) throw staleIdentity();
      mutations.current.set(document.id, {
        ...scope,
        sequence: ++mutationSequence.current,
        office: document,
      });
      publish((previous) => {
        const base = sameScope(previous, scope) ? previous : emptySnapshot(scope);
        const existing = base.offices.find((item) => item.id === document.id);
        const office = latestOffice(existing, document);
        const offices = existing
          ? base.offices.map((item) => (item.id === office.id ? office : item))
          : [...base.offices, office];
        return {
          ...base,
          offices,
          selectedId: base.selectedId ?? offices[0]?.id ?? null,
          ready: true,
          error: null,
        };
      });
      return document;
    },
    [current, publish],
  );
  const createOffice = useCallback(
    async (input: OfficeCreateInput): Promise<OfficeConfig> => {
      const { scope } = beginAdminMutation();
      const result = await gateway.createOffice({ ...input });
      if (!current(scope)) throw staleIdentity();
      return applyOffice(readServerOffice(result), scope);
    },
    [applyOffice, beginAdminMutation, current],
  );
  const updateOfficeSettings = useCallback(
    async (id: string, input: OfficeSettingsInput, revision?: number): Promise<OfficeConfig> => {
      const { scope } = beginAdminMutation();
      const expected = revisionFor(id, revision, scope);
      const result = await gateway.updateOfficeSettings(id, structuredClone(input), expected);
      if (!current(scope)) throw staleIdentity();
      const document = readServerOffice(result);
      if (document.id !== id) throw new Error('Сервер вернул настройки другого офиса.');
      return applyOffice(document, scope);
    },
    [applyOffice, beginAdminMutation, current, revisionFor],
  );
  const saveOfficePlan = useCallback(
    async (id: string, floors: Floor[], revision?: number): Promise<OfficeConfig> => {
      const { scope } = beginAdminMutation();
      const expected = revisionFor(id, revision, scope);
      const result = await gateway.saveOfficePlan(id, structuredClone(floors), expected);
      if (!current(scope)) throw staleIdentity();
      const document = readServerOffice(result);
      if (document.id !== id) throw new Error('Сервер вернул план другого офиса.');
      return applyOffice(document, scope);
    },
    [applyOffice, beginAdminMutation, current, revisionFor],
  );

  const visible = !!(authReady && user?.active && sameScope(snapshot, scopeRef.current));
  const offices = visible ? snapshot.offices : EMPTY_OFFICES;
  const error = visible ? snapshot.error : null;
  const ready = authReady && (!user?.active || (visible && snapshot.ready));
  const hasSnapshot = !!visible && snapshot.hasSnapshot;
  const accessibleOffices = useMemo(
    () =>
      user
        ? offices.filter((item) => user.role === 'admin' || user.buildingIds.includes(item.id))
        : EMPTY_OFFICES,
    [offices, user],
  );
  const office =
    accessibleOffices.find((item) => item.id === (visible ? snapshot.selectedId : null)) ||
    accessibleOffices[0] ||
    null;
  const value = useMemo(
    () => ({
      offices,
      accessibleOffices,
      office,
      error,
      ready,
      hasSnapshot,
      selectOffice,
      createOffice,
      updateOfficeSettings,
      saveOfficePlan,
      refresh,
    }),
    [
      offices,
      accessibleOffices,
      office,
      error,
      ready,
      hasSnapshot,
      selectOffice,
      createOffice,
      updateOfficeSettings,
      saveOfficePlan,
      refresh,
    ],
  );
  return <OfficeContext.Provider value={value}>{children}</OfficeContext.Provider>;
}

export function useOffices(): OfficeContextValue {
  const value = useContext(OfficeContext);
  if (!value) throw new Error('useOffices должен использоваться внутри OfficeProvider.');
  return value;
}
