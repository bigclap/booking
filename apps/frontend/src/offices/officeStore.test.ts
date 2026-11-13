import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoConfig, parseConfig, serializeConfig } from '../model';
import type { OfficeConfig } from '../model';
import {
  OFFICES_CHANGED_EVENT,
  OFFICES_STORAGE_KEY,
  OFFICE_SELECTION_PREFIX,
  SELECTION_CHANGED_EVENT,
  createOffice,
  getAccessibleOffices,
  getSelectedOfficeId,
  loadOffice,
  loadOffices,
  saveOffice,
  selectOffice,
} from './officeStore';

const LEGACY_KEY = 'plan-room.office-builder.v1';
const BOOKINGS_KEY = 'plan-room.client-bookings.v1';
let values: Map<string, string>;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
};
let events: EventTarget;

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  events = new EventTarget();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', events);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function putCatalog(offices: OfficeConfig[]) {
  values.set(OFFICES_STORAGE_KEY, JSON.stringify({ version: 1, offices }));
}

describe('office catalog and legacy migration', () => {
  it('reads legacy without mutation and preserves all floors, ids, background and bookings on first write', () => {
    const legacy = createDemoConfig();
    legacy.floors[1].background = {
      src: 'data:image/png;base64,aGVsbG8=',
      name: 'Пожарный план.png',
      opacity: 0.47,
      visible: true,
      locked: false,
      x: 50,
      y: 70,
      width: 800,
      height: 540,
    };
    const raw = serializeConfig(legacy);
    values.set(LEGACY_KEY, raw);
    values.set(BOOKINGS_KEY, '[{"id":"do-not-touch","buildingId":"office-demo"}]');

    expect(loadOffices()).toEqual([legacy]);
    expect(loadOffice(legacy.id)).toEqual(legacy);
    expect(values.has(OFFICES_STORAGE_KEY)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();

    const created = createOffice({ name: '  Офис у реки  ', address: '  Набережная, 18  ' });
    expect(created).toMatchObject({ name: 'Офис у реки', address: 'Набережная, 18' });
    expect(loadOffice(legacy.id)).toEqual(legacy);
    expect(loadOffices()).toHaveLength(2);
    expect(values.get(LEGACY_KEY)).toBe(raw);
    expect(values.get(BOOKINGS_KEY)).toBe('[{"id":"do-not-touch","buildingId":"office-demo"}]');
  });

  it('uses a virtual demo only when both stores are absent and does not seed while reading', () => {
    expect(loadOffices()[0].id).toBe('office-demo');
    expect(loadOffices()[0].floors).toHaveLength(2);
    expect(storage.setItem).not.toHaveBeenCalled();
    const created = createOffice({ name: 'Новый офис' });
    expect(loadOffices().map((office) => office.id)).toEqual(['office-demo', created.id]);
  });

  it('creates independent empty offices with unique office/floor ids and separate schedules', () => {
    const first = createOffice({ name: 'Первый' });
    const second = createOffice({ name: 'Второй' });
    expect(first.id).not.toBe(second.id);
    expect(first.floors[0].id).not.toBe(second.floors[0].id);
    for (const office of [first, second]) {
      expect(office.floors).toHaveLength(1);
      expect(office.floors[0]).toMatchObject({ name: '1 этаж', elements: [] });
      expect(office.hours.mon).toEqual({ enabled: true, start: '09:00', end: '19:00' });
      expect(office.hours.sun.enabled).toBe(false);
    }
    first.hours.mon.start = '11:00';
    expect(second.hours.mon.start).toBe('09:00');
    expect(loadOffice(first.id)?.hours.mon.start).toBe('09:00');
  });

  it('updates only the requested office and never replaces another office’s plan', () => {
    const first = createOffice({ name: 'Первый' });
    const second = createOffice({ name: 'Второй' });
    const unchanged = loadOffice(second.id);
    first.floors[0].name = 'Лаборатории';
    first.floors[0].background = {
      src: 'data:image/jpeg;base64,aGVsbG8=',
      name: 'Скан.jpg',
      opacity: 0.6,
      visible: true,
      locked: true,
    };
    saveOffice(first);
    expect(loadOffice(first.id)?.floors[0].name).toBe('Лаборатории');
    expect(loadOffice(second.id)).toEqual(unchanged);
    expect(loadOffices()).toHaveLength(3);
    expect(loadOffice('does-not-exist')).toBeUndefined();
  });

  it('does not silently replace malformed catalog or legacy with a demo, even during writes', () => {
    for (const key of [OFFICES_STORAGE_KEY, LEGACY_KEY]) {
      values.clear();
      values.set(key, '{ damaged');
      const before = new Map(values);
      expect(() => loadOffices()).toThrow();
      expect(() => createOffice({ name: 'Новый' })).toThrow();
      expect(() => saveOffice(createDemoConfig())).toThrow();
      expect(values).toEqual(before);
    }
  });

  it('rejects invalid catalog shapes and duplicate office ids; valid catalog takes precedence over legacy', () => {
    values.set(OFFICES_STORAGE_KEY, JSON.stringify({ version: 2, offices: [] }));
    expect(() => loadOffices()).toThrow('формат');
    const office = createDemoConfig();
    putCatalog([office, office]);
    expect(() => loadOffices()).toThrow('идентификатор');
    values.set(LEGACY_KEY, '{ damaged legacy');
    putCatalog([office]);
    expect(loadOffices()).toEqual([office]);
    putCatalog([]);
    expect(loadOffices()).toEqual([]);
  });

  it('validates office metadata before writing and removes an empty optional address without mutating caller', () => {
    const office = createOffice({ name: 'Север', address: '  Лесная, 5  ' });
    const before = new Map(values);
    expect(() => createOffice({ name: '   ' })).toThrow(/название/i);
    expect(() => createOffice({ name: 'x'.repeat(81) })).toThrow('80');
    expect(() => createOffice({ name: 'Юг', address: 'x'.repeat(161) })).toThrow('160');
    expect(values).toEqual(before);
    const changed = { ...office, name: '  Северный офис  ', address: '   ' };
    saveOffice(changed);
    expect(loadOffice(office.id)?.name).toBe('Северный офис');
    expect(loadOffice(office.id)?.address).toBeUndefined();
    expect(changed.address).toBe('   ');
    expect(() => parseConfig(JSON.stringify({ ...office, address: 'x'.repeat(161) }))).toThrow(
      'адрес',
    );
  });
});

describe('selection, access and persistence failures', () => {
  it('keeps the selected office per user and emits same-window events only after persistence', () => {
    const first = createOffice({ name: 'Первый' });
    const second = createOffice({ name: 'Второй' });
    const selected: Array<{ userId: string; officeId: string }> = [];
    events.addEventListener(SELECTION_CHANGED_EVENT, (event) => {
      const detail = (event as CustomEvent<{ userId: string; officeId: string }>).detail;
      expect(getSelectedOfficeId(detail.userId)).toBe(detail.officeId);
      selected.push(detail);
    });
    selectOffice('anna', first.id);
    selectOffice('pavel', second.id);
    expect(getSelectedOfficeId('anna')).toBe(first.id);
    expect(getSelectedOfficeId('pavel')).toBe(second.id);
    expect(getSelectedOfficeId('another-user')).toBeNull();
    expect(values.get(OFFICE_SELECTION_PREFIX + 'anna')).toBe(first.id);
    expect(selected).toEqual([
      { userId: 'anna', officeId: first.id },
      { userId: 'pavel', officeId: second.id },
    ]);
    expect(() => selectOffice('anna', 'removed-office')).toThrow('не найден');
    expect(getSelectedOfficeId('anna')).toBe(first.id);
  });

  it('returns all offices to an administrator and only explicitly assigned offices to an employee', () => {
    const office = createOffice({ name: 'Ограниченный офис' });
    createOffice({ name: 'Другой офис' });
    expect(getAccessibleOffices(null)).toEqual([]);
    expect(getAccessibleOffices({ role: 'admin', buildingIds: [] })).toHaveLength(3);
    expect(
      getAccessibleOffices({ role: 'employee', buildingIds: [office.id, 'missing'] }).map(
        (item) => item.id,
      ),
    ).toEqual([office.id]);
    expect(getAccessibleOffices({ role: 'employee', buildingIds: [] })).toEqual([]);
  });

  it('does not mutate storage or emit success events if persistence fails', () => {
    const office = createDemoConfig();
    values.set(LEGACY_KEY, serializeConfig(office));
    const catalogEvent = vi.fn();
    const selectionEvent = vi.fn();
    events.addEventListener(OFFICES_CHANGED_EVENT, catalogEvent);
    events.addEventListener(SELECTION_CHANGED_EVENT, selectionEvent);
    const before = new Map(values);
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => createOffice({ name: 'Новый' })).toThrow('quota');
    expect(() => saveOffice(office)).toThrow('quota');
    expect(() => selectOffice('anna', office.id)).toThrow('quota');
    expect(values).toEqual(before);
    expect(catalogEvent).not.toHaveBeenCalled();
    expect(selectionEvent).not.toHaveBeenCalled();
    storage.getItem.mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => loadOffices()).toThrow('storage disabled');
  });

  it('notifies consumers after the saved office is visible in the catalog', () => {
    const notifications: string[] = [];
    events.addEventListener(OFFICES_CHANGED_EVENT, (event) => {
      const { officeId } = (event as CustomEvent<{ officeId: string }>).detail;
      expect(loadOffice(officeId)).toBeDefined();
      notifications.push(officeId);
    });
    const created = createOffice({ name: 'Первый' });
    saveOffice({ ...created, name: 'Переименован' });
    expect(notifications).toEqual([created.id, created.id]);
  });
});
