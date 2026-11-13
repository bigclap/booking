import { resolveBookingBuildingId } from '../client/bookingModel';
import { loadOffices } from '../offices/officeStore';
import type { AppUser, UserInput, UserUpdate } from './types';

// Local-preview storage only. Browser-controlled storage is not a server trust boundary.
export const AUTH_STORAGE_KEYS = {
  accounts: 'plan-room.auth.accounts.v1',
  session: 'plan-room.auth.session.v1',
} as const;
export const AUTH_UPDATED_EVENT = 'plan-room:auth-updated';
export const BOOKINGS_UPDATED_EVENT = 'plan-room:bookings-updated';
const BOOKINGS_KEY = 'plan-room.client-bookings.v1';
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 210000;

interface Credential {
  salt: string;
  hash: string;
  iterations: number;
}
interface Account {
  user: AppUser;
  credential: Credential;
  sessionVersion: number;
}
interface AccountsState {
  version: 1;
  accounts: Account[];
}
interface LocalSession {
  version: 1;
  userId: string;
  expiresAt: number;
  sessionVersion: number;
}
export interface AuthSnapshot {
  user: AppUser | null;
  users: AppUser[];
  expiresAt: number | null;
}

function announce(event: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(event));
}

function copyUser(user: AppUser): AppUser {
  return { ...user, buildingIds: [...user.buildingIds] };
}
function normalizeLogin(login: string): string {
  const value = typeof login === 'string' ? login.trim().toLowerCase() : '';
  if (!/^[a-z0-9._-]{3,40}$/.test(value))
    throw new Error('Логин: 3–40 латинских букв, цифр или символов . _ -');
  return value;
}
function normalizeName(name: string, label: string): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value.length > 60) throw new Error(`${label}: от 1 до 60 символов.`);
  return value;
}
function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8)
    throw new Error('Пароль должен содержать не меньше 8 символов.');
}
function normalizeInput(input: Omit<UserInput, 'password'>): Omit<UserInput, 'password'> {
  if (input.role !== 'admin' && input.role !== 'employee')
    throw new Error('Неизвестная роль пользователя.');
  if (
    !Array.isArray(input.buildingIds) ||
    input.buildingIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 160)
  ) {
    throw new Error('Некорректный список зданий.');
  }
  return {
    login: normalizeLogin(input.login),
    firstName: normalizeName(input.firstName, 'Имя'),
    lastName: normalizeName(input.lastName, 'Фамилия'),
    role: input.role,
    buildingIds: [...new Set(input.buildingIds.map((id) => id.trim()))],
  };
}

function validUser(value: unknown): value is AppUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as AppUser;
  try {
    const normalized = normalizeInput(user);
    return (
      typeof user.id === 'string' &&
      !!user.id &&
      typeof user.active === 'boolean' &&
      typeof user.createdAt === 'string' &&
      Number.isFinite(Date.parse(user.createdAt)) &&
      normalized.login === user.login &&
      normalized.firstName === user.firstName &&
      normalized.lastName === user.lastName &&
      normalized.buildingIds.length === user.buildingIds.length
    );
  } catch {
    return false;
  }
}
function validAccount(value: unknown): value is Account {
  if (!value || typeof value !== 'object') return false;
  const account = value as Account;
  return (
    validUser(account.user) &&
    Number.isInteger(account.sessionVersion) &&
    account.sessionVersion >= 0 &&
    !!account.credential &&
    /^[a-f0-9]{32}$/.test(account.credential.salt) &&
    /^[a-f0-9]{64}$/.test(account.credential.hash) &&
    Number.isInteger(account.credential.iterations) &&
    account.credential.iterations >= 10000 &&
    account.credential.iterations <= 2000000
  );
}
function readAccounts(): AccountsState | null {
  const stored = localStorage.getItem(AUTH_STORAGE_KEYS.accounts);
  if (stored === null) return null;
  try {
    const state = JSON.parse(stored) as AccountsState;
    if (
      state.version !== 1 ||
      !Array.isArray(state.accounts) ||
      !state.accounts.length ||
      !state.accounts.every(validAccount)
    )
      throw new Error();
    const ids = new Set(state.accounts.map((account) => account.user.id));
    const logins = new Set(state.accounts.map((account) => account.user.login));
    if (ids.size !== state.accounts.length || logins.size !== state.accounts.length)
      throw new Error();
    return state;
  } catch {
    throw new Error('Локальные учётные записи повреждены. Исходные данные сохранены.');
  }
}
function readSession(): LocalSession | null {
  const stored = localStorage.getItem(AUTH_STORAGE_KEYS.session);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as LocalSession;
    if (
      session.version !== 1 ||
      typeof session.userId !== 'string' ||
      !Number.isFinite(session.expiresAt) ||
      !Number.isInteger(session.sessionVersion)
    )
      throw new Error();
    return session;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEYS.session);
    return null;
  }
}
function currentAccount(state: AccountsState): Account | null {
  const session = readSession();
  if (!session) return null;
  const account = state.accounts.find((item) => item.user.id === session.userId);
  if (
    !account?.user.active ||
    session.expiresAt <= Date.now() ||
    account.sessionVersion !== session.sessionVersion
  ) {
    localStorage.removeItem(AUTH_STORAGE_KEYS.session);
    return null;
  }
  return account;
}
function requireActor(state: AccountsState, admin = false): Account {
  const actor = currentAccount(state);
  if (!actor) throw new Error('Войдите в учётную запись.');
  if (admin && actor.user.role !== 'admin')
    throw new Error('Управление пользователями доступно администратору.');
  return actor;
}
function requireState(): AccountsState {
  const state = readAccounts();
  if (!state) throw new Error('Учётные записи ещё не загружены.');
  return state;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function unhex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
async function derive(password: string, salt: string, iterations: number): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Браузер не поддерживает локальную авторизацию.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unhex(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}
async function credential(password: string): Promise<Credential> {
  validatePassword(password);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return {
    salt,
    iterations: PBKDF2_ITERATIONS,
    hash: await derive(password, salt, PBKDF2_ITERATIONS),
  };
}
async function matches(password: string, stored: Credential): Promise<boolean> {
  if (typeof password !== 'string') return false;
  const actual = await derive(password, stored.salt, stored.iterations);
  let difference = actual.length ^ stored.hash.length;
  for (let index = 0; index < actual.length; index++)
    difference |= actual.charCodeAt(index) ^ stored.hash.charCodeAt(index);
  return difference === 0;
}

let initializing: Promise<void> | null = null;
export async function initializeAuthStore(): Promise<AuthSnapshot> {
  if (readAccounts()) return getAuthSnapshot();
  if (!initializing) {
    initializing = (async () => {
      const buildingId = loadOffices()[0]?.id;
      const createdAt = new Date().toISOString();
      const seeds = [
        {
          id: 'current-user',
          login: 'admin',
          firstName: 'Алексей',
          lastName: 'Кузнецов',
          role: 'admin' as const,
          password: 'admin12345',
        },
        {
          id: 'anna-sokolova',
          login: 'anna',
          firstName: 'Анна',
          lastName: 'Соколова',
          role: 'employee' as const,
          password: 'office2026',
        },
        {
          id: 'ilya-kuznetsov',
          login: 'ilya',
          firstName: 'Илья',
          lastName: 'Кузнецов',
          role: 'employee' as const,
          password: 'office2026',
        },
        {
          id: 'maria-orlova',
          login: 'maria',
          firstName: 'Мария',
          lastName: 'Орлова',
          role: 'employee' as const,
          password: 'office2026',
        },
      ];
      const accounts = await Promise.all(
        seeds.map(async ({ password, ...user }) => ({
          user: { ...user, active: true, buildingIds: buildingId ? [buildingId] : [], createdAt },
          credential: await credential(password),
          sessionVersion: 0,
        })),
      );
      // A second tab may have finished initialization while PBKDF2 was running.
      if (!readAccounts())
        localStorage.setItem(AUTH_STORAGE_KEYS.accounts, JSON.stringify({ version: 1, accounts }));
      announce(AUTH_UPDATED_EVENT);
    })().finally(() => {
      initializing = null;
    });
  }
  await initializing;
  return getAuthSnapshot();
}

export function getAuthSnapshot(): AuthSnapshot {
  const state = readAccounts();
  if (!state) return { user: null, users: [], expiresAt: null };
  const actor = currentAccount(state);
  return {
    user: actor ? copyUser(actor.user) : null,
    users:
      actor?.user.role === 'admin' ? state.accounts.map((account) => copyUser(account.user)) : [],
    expiresAt: actor ? (readSession()?.expiresAt ?? null) : null,
  };
}

export async function signIn(login: string, password: string): Promise<void> {
  await initializeAuthStore();
  let normalized: string;
  try {
    normalized = normalizeLogin(login);
  } catch {
    throw new Error('Неверный логин или пароль.');
  }
  const account = requireState().accounts.find((item) => item.user.login === normalized);
  if (!account?.user.active || !(await matches(password, account.credential)))
    throw new Error('Неверный логин или пароль.');
  const latest = requireState().accounts.find((item) => item.user.id === account.user.id);
  if (
    !latest?.user.active ||
    latest.user.login !== normalized ||
    latest.sessionVersion !== account.sessionVersion
  )
    throw new Error('Учётная запись изменилась. Войдите ещё раз.');
  const session: LocalSession = {
    version: 1,
    userId: account.user.id,
    expiresAt: Date.now() + SESSION_DURATION,
    sessionVersion: account.sessionVersion,
  };
  localStorage.setItem(AUTH_STORAGE_KEYS.session, JSON.stringify(session));
  announce(AUTH_UPDATED_EVENT);
}

export function signOut(): void {
  localStorage.removeItem(AUTH_STORAGE_KEYS.session);
  announce(AUTH_UPDATED_EVENT);
}

function persist(state: AccountsState, bookingsChange?: { before: string; after: string }): void {
  let bookingsWritten = false;
  try {
    if (bookingsChange) {
      localStorage.setItem(BOOKINGS_KEY, bookingsChange.after);
      bookingsWritten = true;
    }
    localStorage.setItem(AUTH_STORAGE_KEYS.accounts, JSON.stringify(state));
  } catch (error) {
    if (bookingsWritten && bookingsChange)
      localStorage.setItem(BOOKINGS_KEY, bookingsChange.before);
    throw error;
  }
  currentAccount(state); // Remove a revoked current session even without a mounted provider.
  if (bookingsChange) announce(BOOKINGS_UPDATED_EVENT);
  announce(AUTH_UPDATED_EVENT);
}

function moscowNow(now: number): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

/** D-089: keep elapsed history, release only the remaining time of lost-access bookings. */
export function terminateBookingsForAccessLoss(
  userId: string,
  lostBuildingIds: string[] | null,
  now = Date.now(),
): { before: string; after: string } | undefined {
  return prepareBookingChanges(userId, lostBuildingIds, undefined, now);
}

function prepareBookingChanges(
  userId: string,
  lostBuildingIds?: string[] | null,
  ownerName?: string,
  now = Date.now(),
): { before: string; after: string } | undefined {
  if (lostBuildingIds === undefined && ownerName === undefined) return undefined;
  const before = localStorage.getItem(BOOKINGS_KEY);
  if (before === null) return undefined; // Never seed or replace missing booking data here.
  let bookings: unknown;
  try {
    bookings = JSON.parse(before);
  } catch {
    throw new Error('Не удалось обновить доступ: локальные брони повреждены.');
  }
  if (!Array.isArray(bookings))
    throw new Error('Не удалось обновить доступ: локальные брони повреждены.');
  const offices = lostBuildingIds && lostBuildingIds.length ? loadOffices() : [];
  const current = moscowNow(now);
  let changed = false;
  const next = bookings.map((value: unknown) => {
    if (!value || typeof value !== 'object') return value;
    const item = value as Record<string, unknown>;
    if (item.ownerId !== userId) return value;
    let updated = item;
    if (ownerName !== undefined && item.ownerName !== ownerName) {
      updated = { ...item, ownerName };
      changed = true;
    }
    if (
      lostBuildingIds === undefined ||
      item.status !== 'active' ||
      typeof item.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      typeof item.start !== 'number' ||
      typeof item.end !== 'number' ||
      !Number.isFinite(item.start) ||
      !Number.isFinite(item.end) ||
      item.start >= item.end
    )
      return updated;
    const buildingId = resolveBookingBuildingId(item, offices);
    const affected =
      lostBuildingIds === null ||
      (buildingId !== undefined && lostBuildingIds.includes(buildingId));
    if (
      !affected ||
      item.date < current.date ||
      (item.date === current.date && item.end <= current.minute)
    )
      return updated;
    changed = true;
    if (item.date > current.date || item.start >= current.minute)
      return { ...updated, status: 'cancelled' };
    return { ...updated, end: current.minute };
  });
  return changed ? { before, after: JSON.stringify(next) } : undefined;
}

export async function createUser(input: UserInput): Promise<AppUser> {
  await initializeAuthStore();
  requireActor(requireState(), true);
  const fields = normalizeInput(input);
  validatePassword(input.password);
  const storedCredential = await credential(input.password);
  const state = requireState();
  requireActor(state, true);
  if (state.accounts.some((item) => item.user.login === fields.login))
    throw new Error('Такой логин уже существует.');
  const user: AppUser = {
    ...fields,
    id: `user-${crypto.randomUUID()}`,
    active: true,
    createdAt: new Date().toISOString(),
  };
  state.accounts.push({ user, credential: storedCredential, sessionVersion: 0 });
  persist(state);
  return copyUser(user);
}

export async function updateUser(id: string, input: UserUpdate): Promise<AppUser> {
  await initializeAuthStore();
  const state = requireState(),
    actor = requireActor(state, true);
  const target = state.accounts.find((item) => item.user.id === id);
  if (!target) throw new Error('Пользователь не найден.');
  const fields = normalizeInput(input);
  if (typeof input.active !== 'boolean') throw new Error('Некорректное состояние учётной записи.');
  if (state.accounts.some((item) => item.user.id !== id && item.user.login === fields.login))
    throw new Error('Такой логин уже существует.');
  if (actor.user.id === id && (!input.active || fields.role !== 'admin'))
    throw new Error('Нельзя отключить себя или снять собственную роль администратора.');
  if (
    target.user.active &&
    target.user.role === 'admin' &&
    (!input.active || fields.role !== 'admin') &&
    state.accounts.filter((item) => item.user.active && item.user.role === 'admin').length <= 1
  )
    throw new Error('Нельзя отключить последнего администратора.');
  const officeIds = loadOffices().map((office) => office.id);
  const hadAccess = new Set(
    target.user.role === 'admin'
      ? [...officeIds, ...target.user.buildingIds]
      : target.user.buildingIds,
  );
  const hasAccess = new Set(
    input.active
      ? fields.role === 'admin'
        ? [...officeIds, ...fields.buildingIds]
        : fields.buildingIds
      : [],
  );
  const removedBuildings = [...hadAccess].filter((buildingId) => !hasAccess.has(buildingId));
  const renamed =
    target.user.firstName !== fields.firstName || target.user.lastName !== fields.lastName;
  const bookingsChange = prepareBookingChanges(
    id,
    !input.active ? null : removedBuildings.length ? removedBuildings : undefined,
    renamed ? `${fields.firstName} ${fields.lastName}` : undefined,
  );
  if (target.user.active !== input.active || target.user.role !== fields.role)
    target.sessionVersion++;
  target.user = { ...target.user, ...fields, active: input.active };
  persist(state, bookingsChange);
  return copyUser(target.user);
}

export async function resetPassword(id: string, password: string): Promise<void> {
  await initializeAuthStore();
  requireActor(requireState(), true);
  validatePassword(password);
  const nextCredential = await credential(password);
  const state = requireState();
  requireActor(state, true);
  const target = state.accounts.find((item) => item.user.id === id);
  if (!target) throw new Error('Пользователь не найден.');
  target.credential = nextCredential;
  target.sessionVersion++;
  persist(state);
}

export async function changePassword(current: string, password: string): Promise<void> {
  await initializeAuthStore();
  const account = requireActor(requireState());
  validatePassword(password);
  if (!(await matches(current, account.credential))) throw new Error('Текущий пароль неверен.');
  const nextCredential = await credential(password);
  const state = requireState(),
    actor = requireActor(state);
  if (actor.user.id !== account.user.id || actor.sessionVersion !== account.sessionVersion)
    throw new Error('Учётная запись изменилась. Войдите ещё раз.');
  actor.credential = nextCredential;
  actor.sessionVersion++;
  persist(state);
}
