import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoConfig, serializeConfig } from '../model';
import type { ClientBooking } from '../client/types';
import type { AppUser, UserInput, UserUpdate } from './types';
import {
  AUTH_STORAGE_KEYS,
  BOOKINGS_UPDATED_EVENT,
  changePassword,
  createUser,
  getAuthSnapshot,
  initializeAuthStore,
  resetPassword,
  signIn,
  signOut,
  terminateBookingsForAccessLoss,
  updateUser,
} from './authModel';

const BOOKINGS_KEY = 'plan-room.client-bookings.v1';
const OFFICE_KEY = 'plan-room.office-builder.v1';
const CATALOG_KEY = 'plan-room.offices.v1';
const office = createDemoConfig();
const officeRaw = serializeConfig(office);
let accountsFixture = '';
let values: Map<string, string>;
let local: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
};

function useStorage(initial: Record<string, string> = {}) {
  values = new Map(Object.entries(initial));
  local = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  vi.stubGlobal('localStorage', local);
}
function fields(user: AppUser, patch: Partial<UserUpdate> = {}): UserUpdate {
  return {
    login: user.login,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    active: user.active,
    buildingIds: [...user.buildingIds],
    ...patch,
  };
}
function findUser(id: string): AppUser {
  return getAuthSnapshot().users.find((user) => user.id === id)!;
}
const input: UserInput = {
  login: 'new.user',
  firstName: 'Иван',
  lastName: 'Петров',
  role: 'employee',
  buildingIds: [],
  password: 'newPassword9',
};
const booking = (
  id: string,
  patch: Partial<ClientBooking> & { buildingId?: string } = {},
): ClientBooking & { buildingId?: string } => ({
  id,
  floorId: office.floors[0].id,
  resourceId: 'f1-open-0-left',
  date: '2026-11-12',
  start: 900,
  end: 960,
  ownerId: 'anna-sokolova',
  ownerName: 'Анна Соколова',
  status: 'active',
  ...patch,
});
function freezeMoscowMinute() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T10:25:50Z')); // Moscow 13:25; retain whole elapsed minutes.
}
function secondOffice() {
  const second = structuredClone(office);
  second.id = 'office-b';
  second.name = 'Второе здание';
  const desk = structuredClone(
    office.floors[0].elements.find((item) => item.kind === 'desk' && !item.roomId)!,
  );
  desk.id = 'desk-b';
  second.floors = [{ id: 'floor-b', name: '1 этаж', width: 1000, height: 1000, elements: [desk] }];
  return second;
}

beforeAll(async () => {
  useStorage({ [OFFICE_KEY]: officeRaw });
  await initializeAuthStore();
  accountsFixture = values.get(AUTH_STORAGE_KEYS.accounts)!;
  vi.unstubAllGlobals();
});
beforeEach(() => {
  useStorage({ [OFFICE_KEY]: officeRaw, [AUTH_STORAGE_KEYS.accounts]: accountsFixture });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local account credentials and sessions', () => {
  it('seeds stable demo identities with individual salts and no plaintext passwords', async () => {
    const stored = JSON.parse(accountsFixture);
    expect(stored.accounts.map((account: { user: AppUser }) => account.user.id)).toEqual([
      'current-user',
      'anna-sokolova',
      'ilya-kuznetsov',
      'maria-orlova',
    ]);
    expect(
      new Set(
        stored.accounts.map((account: { credential: { salt: string } }) => account.credential.salt),
      ).size,
    ).toBe(4);
    expect(accountsFixture).not.toContain('admin12345');
    expect(accountsFixture).not.toContain('office2026');
    await signIn(' ADMIN ', 'admin12345');
    expect(getAuthSnapshot().user).toMatchObject({
      id: 'current-user',
      login: 'admin',
      firstName: 'Алексей',
      role: 'admin',
    });
    expect(getAuthSnapshot().users).toHaveLength(4);
    expect(JSON.stringify(getAuthSnapshot())).not.toContain('credential');
  });

  it('rejects wrong credentials and restricts the directory and mutations to administrators', async () => {
    await expect(signIn('admin', 'incorrect')).rejects.toThrow('Неверный');
    expect(getAuthSnapshot().user).toBeNull();
    await signIn('anna', 'office2026');
    expect(getAuthSnapshot().users).toEqual([]);
    await expect(createUser(input)).rejects.toThrow('администратору');
    await expect(resetPassword('current-user', 'anotherPass9')).rejects.toThrow('администратору');
    await expect(
      updateUser(
        'anna-sokolova',
        fields({
          id: 'anna-sokolova',
          login: 'anna',
          firstName: 'Анна',
          lastName: 'Соколова',
          role: 'employee',
          active: true,
          buildingIds: [],
          createdAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow('администратору');
  });

  it('expires the session after 30 days and removes it on sign-out', async () => {
    freezeMoscowMinute();
    const now = Date.now();
    await signIn('admin', 'admin12345');
    expect(getAuthSnapshot().expiresAt).toBe(now + 30 * 24 * 60 * 60 * 1000);
    vi.setSystemTime(now + 29 * 24 * 60 * 60 * 1000);
    expect(getAuthSnapshot().user?.id).toBe('current-user');
    vi.setSystemTime(now + 30 * 24 * 60 * 60 * 1000);
    expect(getAuthSnapshot().user).toBeNull();
    expect(values.has(AUTH_STORAGE_KEYS.session)).toBe(false);
    await signIn('admin', 'admin12345');
    signOut();
    expect(getAuthSnapshot().user).toBeNull();
  });

  it('normalizes unique logins, accepts empty building access, and validates names and passwords', async () => {
    await signIn('admin', 'admin12345');
    const user = await createUser({ ...input, login: '  New.User  ', firstName: ' Иван ' });
    expect(user).toMatchObject({
      login: 'new.user',
      firstName: 'Иван',
      active: true,
      buildingIds: [],
    });
    await expect(createUser({ ...input, login: ' NEW.USER ' })).rejects.toThrow('уже существует');
    await expect(createUser({ ...input, login: 'bad login' })).rejects.toThrow('Логин');
    await expect(createUser({ ...input, firstName: ' ' })).rejects.toThrow('Имя');
    await expect(createUser({ ...input, lastName: 'a'.repeat(61) })).rejects.toThrow('Фамилия');
    await expect(createUser({ ...input, password: 'short' })).rejects.toThrow('8');
    expect(values.get(AUTH_STORAGE_KEYS.accounts)).not.toContain(input.password);
  });

  it('blocks self-disable and removal of the remaining administrator role', async () => {
    await signIn('admin', 'admin12345');
    const admin = findUser('current-user');
    await expect(updateUser(admin.id, fields(admin, { active: false }))).rejects.toThrow('себя');
    await expect(updateUser(admin.id, fields(admin, { role: 'employee' }))).rejects.toThrow(
      'собственную',
    );
    expect(
      getAuthSnapshot().users.filter((user) => user.active && user.role === 'admin'),
    ).toHaveLength(1);
  });

  it('revokes a reset user session, rejects the old password and accepts the new password', async () => {
    await signIn('anna', 'office2026');
    const oldSession = values.get(AUTH_STORAGE_KEYS.session)!;
    await signIn('admin', 'admin12345');
    await resetPassword('anna-sokolova', 'changedPass9');
    values.set(AUTH_STORAGE_KEYS.session, oldSession); // A stale session in another tab cannot survive the new version.
    expect(getAuthSnapshot().user).toBeNull();
    await expect(signIn('anna', 'office2026')).rejects.toThrow('Неверный');
    await signIn('anna', 'changedPass9');
    expect(getAuthSnapshot().user?.id).toBe('anna-sokolova');
  });

  it('changes the current password only after verification and requires a new login', async () => {
    await signIn('anna', 'office2026');
    await expect(changePassword('wrong-current', 'changedPass9')).rejects.toThrow('Текущий пароль');
    expect(getAuthSnapshot().user?.id).toBe('anna-sokolova');
    await changePassword('office2026', 'changedPass9');
    expect(values.has(AUTH_STORAGE_KEYS.session)).toBe(false);
    await expect(signIn('anna', 'office2026')).rejects.toThrow('Неверный');
    await signIn('anna', 'changedPass9');
    expect(getAuthSnapshot().user?.id).toBe('anna-sokolova');
  });

  it('preserves damaged account storage instead of resetting identities', async () => {
    values.set(AUTH_STORAGE_KEYS.accounts, '{ damaged');
    await expect(initializeAuthStore()).rejects.toThrow('повреждены');
    expect(values.get(AUTH_STORAGE_KEYS.accounts)).toBe('{ damaged');
  });
});

describe('booking history when access is lost', () => {
  it('cancels future bookings, truncates the current one and preserves past and unrelated history', async () => {
    freezeMoscowMinute();
    const bookings = [
      booking('past-date', { date: '2026-11-11' }),
      booking('ended', { start: 780, end: 805 }),
      booking('current', { start: 780, end: 900 }),
      booking('starts-now', { start: 805, end: 900 }),
      booking('future-date', { date: '2026-11-13' }),
      booking('future-today'),
      booking('cancelled', { status: 'cancelled' }),
      booking('other-owner', { ownerId: 'ilya-kuznetsov' }),
      booking('other-building', { floorId: 'another-floor', buildingId: 'another-office' }),
    ];
    values.set(BOOKINGS_KEY, JSON.stringify(bookings));
    const events = new EventTarget(),
      changed = vi.fn();
    events.addEventListener(BOOKINGS_UPDATED_EVENT, changed);
    vi.stubGlobal('window', events);
    await signIn('admin', 'admin12345');
    await updateUser('anna-sokolova', fields(findUser('anna-sokolova'), { buildingIds: [] }));
    const result = JSON.parse(values.get(BOOKINGS_KEY)!);
    expect(result.find((item: ClientBooking) => item.id === 'current')).toMatchObject({
      start: 780,
      end: 805,
      status: 'active',
    });
    for (const id of ['starts-now', 'future-date', 'future-today'])
      expect(result.find((item: ClientBooking) => item.id === id).status).toBe('cancelled');
    for (const id of ['past-date', 'ended', 'cancelled', 'other-owner', 'other-building']) {
      expect(result.find((item: ClientBooking) => item.id === id)).toEqual(
        bookings.find((item) => item.id === id),
      );
    }
    expect(findUser('anna-sokolova')).toMatchObject({ active: true, buildingIds: [] });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(values.get(OFFICE_KEY)).toBe(officeRaw);
  });

  it('disables the account across buildings and invalidates its previously issued session', async () => {
    freezeMoscowMinute();
    await signIn('anna', 'office2026');
    const stale = values.get(AUTH_STORAGE_KEYS.session)!;
    await signIn('admin', 'admin12345');
    values.set(
      BOOKINGS_KEY,
      JSON.stringify([
        booking('other-building', { floorId: 'other', buildingId: 'another-office' }),
      ]),
    );
    await updateUser('anna-sokolova', fields(findUser('anna-sokolova'), { active: false }));
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)[0].status).toBe('cancelled');
    values.set(AUTH_STORAGE_KEYS.session, stale);
    expect(getAuthSnapshot().user).toBeNull();
    await expect(signIn('anna', 'office2026')).rejects.toThrow('Неверный');
  });

  it('does not seed booking data while creating, updating or disabling users', async () => {
    await signIn('admin', 'admin12345');
    const user = await createUser(input);
    await updateUser(user.id, fields(user, { active: false, firstName: 'Новое имя' }));
    expect(values.has(BOOKINGS_KEY)).toBe(false);
    expect(terminateBookingsForAccessLoss(user.id, null)).toBeUndefined();
  });

  it('updates owner names across saved history without changing intervals, states or unrelated owners', async () => {
    await signIn('admin', 'admin12345');
    const records = [
      booking('past', { date: '2026-11-11' }),
      booking('cancelled', { status: 'cancelled' }),
      booking('other-owner', { ownerId: 'ilya-kuznetsov', ownerName: 'Илья Кузнецов' }),
    ];
    values.set(BOOKINGS_KEY, JSON.stringify(records));
    local.setItem.mockClear();
    await updateUser(
      'anna-sokolova',
      fields(findUser('anna-sokolova'), { firstName: 'Анна-Мария', lastName: 'Смирнова' }),
    );
    const expected = records.map((item) =>
      item.ownerId === 'anna-sokolova' ? { ...item, ownerName: 'Анна-Мария Смирнова' } : item,
    );
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)).toEqual(expected);
    expect(findUser('anna-sokolova')).toMatchObject({
      firstName: 'Анна-Мария',
      lastName: 'Смирнова',
    });
    expect(local.setItem.mock.calls.filter(([key]) => key === BOOKINGS_KEY)).toHaveLength(1);
  });

  it('combines rename and access loss in one booking snapshot while preserving other-building history', async () => {
    freezeMoscowMinute();
    await signIn('admin', 'admin12345');
    const records = [
      booking('current', { start: 780, end: 900 }),
      booking('future'),
      booking('past', { date: '2026-11-11' }),
      booking('other-building', { floorId: 'elsewhere', buildingId: 'another-office' }),
    ];
    values.set(BOOKINGS_KEY, JSON.stringify(records));
    local.setItem.mockClear();
    await updateUser(
      'anna-sokolova',
      fields(findUser('anna-sokolova'), { lastName: 'Смирнова', buildingIds: [] }),
    );
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)).toEqual([
      { ...records[0], end: 805, ownerName: 'Анна Смирнова' },
      { ...records[1], status: 'cancelled', ownerName: 'Анна Смирнова' },
      { ...records[2], ownerName: 'Анна Смирнова' },
      { ...records[3], ownerName: 'Анна Смирнова' },
    ]);
    expect(local.setItem.mock.calls.filter(([key]) => key === BOOKINGS_KEY)).toHaveLength(1);
  });

  it('keeps administrator bookings when checkboxes change because effective access remains', async () => {
    freezeMoscowMinute();
    await signIn('admin', 'admin12345');
    const records = [booking('admin-future', { ownerId: 'current-user' })];
    values.set(BOOKINGS_KEY, JSON.stringify(records));
    await updateUser('current-user', fields(findUser('current-user'), { buildingIds: [] }));
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)).toEqual(records);
    expect(getAuthSnapshot().user?.role).toBe('admin');
  });

  it('revokes current-office bookings on admin-to-employee downgrade even when the old list was empty', async () => {
    freezeMoscowMinute();
    await signIn('admin', 'admin12345');
    await updateUser('current-user', fields(findUser('current-user'), { buildingIds: [] }));
    await createUser({ ...input, login: 'backup-admin', role: 'admin' });
    await signIn('backup-admin', input.password);
    values.set(
      BOOKINGS_KEY,
      JSON.stringify([booking('admin-future', { ownerId: 'current-user' })]),
    );
    await updateUser(
      'current-user',
      fields(findUser('current-user'), { role: 'employee', buildingIds: [] }),
    );
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)[0].status).toBe('cancelled');
  });

  it('leaves account and booking data unchanged if affected booking storage cannot be parsed', async () => {
    await signIn('admin', 'admin12345');
    values.set(BOOKINGS_KEY, '{ damaged');
    await expect(
      updateUser('anna-sokolova', fields(findUser('anna-sokolova'), { active: false })),
    ).rejects.toThrow('брони повреждены');
    expect(findUser('anna-sokolova').active).toBe(true);
    expect(values.get(BOOKINGS_KEY)).toBe('{ damaged');
  });

  it('does not rename the account when the booking owner names cannot be updated', async () => {
    await signIn('admin', 'admin12345');
    values.set(BOOKINGS_KEY, '{ damaged');
    await expect(
      updateUser('anna-sokolova', fields(findUser('anna-sokolova'), { lastName: 'Смирнова' })),
    ).rejects.toThrow('брони повреждены');
    expect(findUser('anna-sokolova').lastName).toBe('Соколова');
    expect(values.get(BOOKINGS_KEY)).toBe('{ damaged');
  });

  it('restores booking data if the account write fails after preparing access revocation', async () => {
    freezeMoscowMinute();
    await signIn('admin', 'admin12345');
    const before = JSON.stringify([booking('future')]);
    values.set(BOOKINGS_KEY, before);
    local.setItem.mockImplementation((key: string, value: string) => {
      if (key === AUTH_STORAGE_KEYS.accounts) throw new Error('quota');
      values.set(key, value);
    });
    await expect(
      updateUser('anna-sokolova', fields(findUser('anna-sokolova'), { active: false })),
    ).rejects.toThrow('quota');
    expect(values.get(BOOKINGS_KEY)).toBe(before);
    expect(findUser('anna-sokolova').active).toBe(true);
  });
});

describe('access revocation across multiple offices', () => {
  it('revokes just one office and resolves legacy bookings against the whole catalog', async () => {
    freezeMoscowMinute();
    const b = secondOffice();
    values.set(CATALOG_KEY, JSON.stringify({ version: 1, offices: [office, b] }));
    await signIn('admin', 'admin12345');
    await updateUser(
      'anna-sokolova',
      fields(findUser('anna-sokolova'), { buildingIds: [office.id, b.id] }),
    );
    const records = [
      booking('a-current', { buildingId: office.id, start: 780, end: 900 }),
      booking('a-legacy-future'),
      booking('b-future', { buildingId: b.id, floorId: 'floor-b', resourceId: 'desk-b' }),
      booking('b-legacy-current', {
        floorId: 'floor-b',
        resourceId: 'desk-b',
        start: 780,
        end: 900,
      }),
      booking('unknown-legacy', { floorId: 'unknown-floor', resourceId: 'unknown-resource' }),
    ];
    values.set(BOOKINGS_KEY, JSON.stringify(records));
    await updateUser('anna-sokolova', fields(findUser('anna-sokolova'), { buildingIds: [b.id] }));
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)).toEqual([
      { ...records[0], end: 805 },
      { ...records[1], status: 'cancelled' },
      records[2],
      records[3],
      records[4],
    ]);
  });

  it('removes an administrator’s effective access to every catalog office on downgrade', async () => {
    freezeMoscowMinute();
    const b = secondOffice();
    values.set(CATALOG_KEY, JSON.stringify({ version: 1, offices: [office, b] }));
    await signIn('admin', 'admin12345');
    await updateUser('current-user', fields(findUser('current-user'), { buildingIds: [] }));
    await createUser({ ...input, login: 'backup-admin', role: 'admin' });
    await signIn('backup-admin', input.password);
    const records = [
      booking('a-current', {
        ownerId: 'current-user',
        buildingId: office.id,
        start: 780,
        end: 900,
      }),
      booking('b-legacy-future', {
        ownerId: 'current-user',
        floorId: 'floor-b',
        resourceId: 'desk-b',
      }),
      booking('b-explicit-future', {
        ownerId: 'current-user',
        buildingId: b.id,
        floorId: 'floor-b',
        resourceId: 'desk-b',
      }),
    ];
    values.set(BOOKINGS_KEY, JSON.stringify(records));
    await updateUser(
      'current-user',
      fields(findUser('current-user'), { role: 'employee', buildingIds: [] }),
    );
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)).toEqual([
      { ...records[0], end: 805 },
      { ...records[1], status: 'cancelled' },
      { ...records[2], status: 'cancelled' },
    ]);
  });

  it('uses explicit building IDs but does not guess a collision-prone legacy record', async () => {
    freezeMoscowMinute();
    const b = { ...structuredClone(office), id: 'office-b' };
    values.set(CATALOG_KEY, JSON.stringify({ version: 1, offices: [office, b] }));
    await signIn('admin', 'admin12345');
    await updateUser(
      'anna-sokolova',
      fields(findUser('anna-sokolova'), { buildingIds: [office.id, b.id] }),
    );
    const records = [
      booking('explicit-a', { buildingId: office.id }),
      booking('explicit-b', { buildingId: b.id }),
      booking('ambiguous-legacy'),
    ];
    values.set(BOOKINGS_KEY, JSON.stringify(records));
    await updateUser('anna-sokolova', fields(findUser('anna-sokolova'), { buildingIds: [b.id] }));
    expect(JSON.parse(values.get(BOOKINGS_KEY)!)).toEqual([
      { ...records[0], status: 'cancelled' },
      records[1],
      records[2],
    ]);
  });

  it('seeds demo user access to the first catalog office without changing legacy office or booking data', async () => {
    const b = secondOffice();
    values.set(CATALOG_KEY, JSON.stringify({ version: 1, offices: [b, office] }));
    values.delete(AUTH_STORAGE_KEYS.accounts);
    await initializeAuthStore();
    await signIn('admin', 'admin12345');
    expect(findUser('anna-sokolova').buildingIds).toEqual([b.id]);
    expect(values.get(OFFICE_KEY)).toBe(officeRaw);
    expect(values.has(BOOKINGS_KEY)).toBe(false);
  });
});
