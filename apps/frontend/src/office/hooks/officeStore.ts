import {
  createBlankFloor,
  createDemoConfig,
  parseConfig,
  serializeConfig,
  uid,
} from '../lib/officeModel';
import type { OfficeConfig } from '../lib/officeModel';

export const OFFICES_STORAGE_KEY = 'plan-room.offices.v1';
export const OFFICES_CHANGED_EVENT = 'plan-room:offices-updated';
export const SELECTION_CHANGED_EVENT = 'plan-room:office-selection';
export const OFFICE_SELECTION_PREFIX = 'plan-room.office-selection.v1.';

const LEGACY_OFFICE_KEY = 'plan-room.office-builder.v1';

interface OfficeCatalog {
  version: 1;
  offices: OfficeConfig[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function notify(name: string, detail: { officeId: string; userId?: string }): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}

function parseCatalog(raw: string): OfficeConfig[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Не удалось загрузить офисы: сохранённый список повреждён.');
  }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.offices)) {
    throw new Error('Не удалось загрузить офисы: неподдерживаемый формат списка.');
  }
  const offices = value.offices.map((office) => parseConfig(JSON.stringify(office)));
  const ids = new Set<string>();
  for (const office of offices) {
    if (ids.has(office.id))
      throw new Error(`Не удалось загрузить офисы: повторяется идентификатор «${office.id}».`);
    ids.add(office.id);
  }
  return offices;
}

/** Reading never migrates, overwrites, or seeds browser storage. */
export function loadOffices(): OfficeConfig[] {
  const catalog = localStorage.getItem(OFFICES_STORAGE_KEY);
  if (catalog !== null) return parseCatalog(catalog);
  const legacy = localStorage.getItem(LEGACY_OFFICE_KEY);
  return [legacy !== null ? parseConfig(legacy) : createDemoConfig()];
}

export function loadOffice(id: string): OfficeConfig | undefined {
  return loadOffices().find((office) => office.id === id);
}

function normalizeInput(input: { name: string; address?: string }): {
  name: string;
  address?: string;
} {
  if (typeof input.name !== 'string') throw new Error('Укажите название офиса.');
  const name = input.name.trim();
  if (!name || name.length > 80)
    throw new Error('Название офиса должно содержать от 1 до 80 символов.');
  if (input.address !== undefined && typeof input.address !== 'string')
    throw new Error('Укажите адрес текстом.');
  const address = input.address?.trim();
  if (address && address.length > 160)
    throw new Error('Адрес офиса должен быть не длиннее 160 символов.');
  return address ? { name, address } : { name };
}

function writeCatalog(offices: OfficeConfig[], officeId: string): void {
  const catalog: OfficeCatalog = { version: 1, offices };
  localStorage.setItem(OFFICES_STORAGE_KEY, JSON.stringify(catalog));
  notify(OFFICES_CHANGED_EVENT, { officeId });
}

export function saveOffice(config: OfficeConfig): void {
  const input = normalizeInput(config);
  const candidate: OfficeConfig = { ...config, ...input };
  if (!input.address) delete candidate.address;
  // Validate and copy the target before any storage mutation or success event.
  const office = parseConfig(serializeConfig(candidate));
  const offices = loadOffices();
  const index = offices.findIndex((item) => item.id === office.id);
  if (index === -1) offices.push(office);
  else offices[index] = office;
  writeCatalog(offices, office.id);
}

function uniqueId(prefix: string, used: Set<string>): string {
  const base = uid(prefix);
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

export function createOffice(input: { name: string; address?: string }): OfficeConfig {
  const fields = normalizeInput(input);
  const offices = loadOffices();
  const used = new Set(
    offices.flatMap((office) => [
      office.id,
      ...office.floors.flatMap((floor) => [
        floor.id,
        ...floor.elements.map((element) => element.id),
      ]),
    ]),
  );
  const floor = createBlankFloor('1 этаж');
  if (used.has(floor.id)) floor.id = uniqueId('floor', used);
  else used.add(floor.id);
  const defaults = createDemoConfig().hours;
  const office: OfficeConfig = {
    version: 1,
    id: uniqueId('office', used),
    ...fields,
    updatedAt: new Date().toISOString(),
    floors: [floor],
    hours: Object.fromEntries(Object.entries(defaults).map(([day, hours]) => [day, { ...hours }])),
  };
  const validated = parseConfig(serializeConfig(office));
  writeCatalog([...offices, validated], validated.id);
  return validated;
}

function selectionKey(userId: string): string {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 160) {
    throw new Error('Не удалось выбрать офис: пользователь не определён.');
  }
  return OFFICE_SELECTION_PREFIX + encodeURIComponent(userId);
}

export function getSelectedOfficeId(userId: string): string | null {
  return localStorage.getItem(selectionKey(userId));
}

export function selectOffice(userId: string, id: string): void {
  const key = selectionKey(userId);
  if (!loadOffice(id)) throw new Error('Выбранный офис не найден.');
  if (localStorage.getItem(key) === id) return;
  localStorage.setItem(key, id);
  notify(SELECTION_CHANGED_EVENT, { userId, officeId: id });
}

export function getAccessibleOffices(
  user: { role: 'admin' | 'employee'; buildingIds: string[] } | null,
): OfficeConfig[] {
  if (!user) return [];
  const offices = loadOffices();
  if (user.role === 'admin') return offices;
  const allowed = new Set(user.buildingIds);
  return offices.filter((office) => allowed.has(office.id));
}
