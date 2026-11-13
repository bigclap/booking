import type { Floor, OfficeConfig, PlanElement } from '../model';
import { CURRENT_USER_ID } from './types';
import type { ClientBooking } from './types';
import { getCatalogItem } from '../catalog';
import { loadOffice, loadOffices } from '../offices/officeStore';

const BOOKINGS_STORAGE_KEY = 'plan-room.client-bookings.v1';

/** A booking target can be an individual desk or an explicitly configured seat. */
export function isWorkplace(resource: PlanElement): boolean {
  return (
    resource.kind === 'desk' ||
    (resource.kind === 'furniture' &&
      resource.resourceType === 'workplace' &&
      resource.bookable === true)
  );
}

export function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return -1;
  const hours = Number(match[1]),
    minutes = Number(match[2]);
  return minutes < 60 && (hours < 24 || (hours === 24 && minutes === 0))
    ? hours * 60 + minutes
    : -1;
}

export function minutesToTime(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1440) return '--:--';
  const minutes = Math.round(value);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function getMoscowDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function loadClientOffice(id?: string): OfficeConfig {
  const office = id === undefined ? loadOffices()[0] : loadOffice(id);
  if (!office) throw new Error('Здание не найдено.');
  return prepareClientOffice(office);
}

const TABLE_TYPES = new Set(['desk', 'standing-desk', 'meeting-table']);

/** Demo-only enrichment; explicit real-office settings and the builder draft stay intact. */
export function prepareClientOffice(config: OfficeConfig): OfficeConfig {
  if (config.id !== 'office-demo') return config;
  const prepared = structuredClone(config);
  for (const floor of prepared.floors) {
    // The initial demo's lounge exclusion was illustrative, not a product rule.
    // Keep this correction restricted to those stable demo resources.
    for (const room of floor.elements) {
      if (room.kind === 'room' && ['f1-lounge', 'f2-lounge'].includes(room.id)) {
        room.bookable = true;
        room.resourceType = 'meeting_room';
      }
    }
    for (const room of floor.elements.filter(
      (item) => item.kind === 'room' && item.bookable !== false,
    )) {
      const tables = floor.elements.filter(
        (item) =>
          item.kind === 'furniture' && item.roomId === room.id && TABLE_TYPES.has(item.type),
      );
      if (!tables.length) continue;
      const desks = floor.elements.filter(
        (item) => item.kind === 'desk' && item.roomId === room.id,
      );
      const seats = floor.elements.filter(
        (item) =>
          item.kind === 'furniture' &&
          item.roomId === room.id &&
          getCatalogItem(item.type)?.seats === 1 &&
          getCatalogItem(item.type)?.isSeating &&
          !closestFurnitureTarget(item, desks, 80, true) &&
          closestFurnitureTarget(item, tables, 80, true),
      );
      if (!seats.length) continue;
      room.shared = true;
      seats.forEach((seat, index) => {
        seat.bookable = true;
        seat.resourceType = 'workplace';
        if (
          seat.name.trim().toLocaleLowerCase('ru') ===
          getCatalogItem(seat.type)?.name.toLocaleLowerCase('ru')
        ) {
          seat.name = `${room.name} · место ${index + 1}`;
        }
      });
    }
  }
  return prepared;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validRange(start: number, end: number): boolean {
  return (
    Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 1440 && start < end
  );
}

export function getOfficeHours(
  config: OfficeConfig,
  date: string,
): { enabled: boolean; start: number; end: number } {
  if (!validDate(date)) return { enabled: false, start: 540, end: 1140 };
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
    new Date(`${date}T12:00:00Z`).getUTCDay()
  ];
  const hours = config.hours[day];
  const start = timeToMinutes(hours?.start ?? '09:00');
  const end = timeToMinutes(hours?.end ?? '19:00');
  if (!validRange(start, end)) return { enabled: false, start: 540, end: 1140 };
  return { enabled: hours?.enabled === true, start, end };
}

function ancestors(element: PlanElement, floor: Floor): Set<string> {
  const result = new Set<string>();
  let parentId = element.roomId;
  while (parentId && !result.has(parentId)) {
    result.add(parentId);
    parentId = floor.elements.find((item) => item.id === parentId)?.roomId;
  }
  return result;
}

export function getResources(floor: Floor): PlanElement[] {
  return floor.elements.filter((element) => {
    if (!(element.kind === 'room' || isWorkplace(element)) || element.bookable === false)
      return false;
    if (!isWorkplace(element)) return true;
    return [...ancestors(element, floor)].every((id) => {
      const parent = floor.elements.find((item) => item.id === id);
      return !parent || parent.bookable === false || parent.shared === true;
    });
  });
}

function furnitureDistance(item: PlanElement, desk: PlanElement): { edge: number; center: number } {
  const dx = item.x + item.width / 2 - desk.x - desk.width / 2;
  const dy = item.y + item.height / 2 - desk.y - desk.height / 2;
  const angle = (-desk.rotation * Math.PI) / 180;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    edge: Math.hypot(
      Math.max(0, Math.abs(localX) - desk.width / 2),
      Math.max(0, Math.abs(localY) - desk.height / 2),
    ),
    center: Math.hypot(dx, dy),
  };
}

function closestFurnitureTarget(
  item: PlanElement,
  targets: PlanElement[],
  threshold: number,
  seating: boolean,
): PlanElement | undefined {
  let candidates = targets
    .map((target) => ({ target, ...furnitureDistance(item, target) }))
    .filter((candidate) => candidate.edge <= threshold);
  if (seating && ['chair', 'ergonomic-chair', 'armchair'].includes(item.type)) {
    const angle = (item.rotation * Math.PI) / 180;
    const front = candidates.filter((candidate) => {
      const dx = candidate.target.x + candidate.target.width / 2 - item.x - item.width / 2;
      const dy = candidate.target.y + candidate.target.height / 2 - item.y - item.height / 2;
      return dx * -Math.sin(angle) + dy * Math.cos(angle) > 1e-6;
    });
    if (front.length) candidates = front;
  }
  return candidates.sort(
    (a, b) => a.edge - b.edge || a.center - b.center || a.target.id.localeCompare(b.target.id),
  )[0]?.target;
}

/**
 * Temporary derived equipment until the constructor stores an explicit desk assignment.
 * Each nearby accessory/seat belongs to at most one physical desk in the same room.
 * Unknown or distant furniture is omitted rather than inherited from room inventory.
 */
export function getResourceEquipment(
  floor: Floor,
  resourceId: string,
): Array<{ type: string; quantity: number }> {
  const resource = floor.elements.find((item) => item.id === resourceId);
  if (!resource || (resource.kind !== 'room' && !isWorkplace(resource))) return [];
  const counts = new Map<string, number>();
  const add = (type: string, quantity = 1) => {
    if (Number.isFinite(quantity) && quantity > 0)
      counts.set(type, (counts.get(type) ?? 0) + quantity);
  };
  if (resource.equipment !== undefined) {
    resource.equipment.forEach((item) => add(item.type, item.quantity));
  } else if (resource.kind === 'room') {
    floor.elements
      .filter((item) => item.kind === 'furniture' && item.roomId === resource.id)
      .forEach((item) => add(item.type));
  } else {
    const desks = floor.elements.filter(
      (item) => item.kind === 'desk' && item.roomId === resource.roomId,
    );
    const workplaces = floor.elements.filter(
      (item) => isWorkplace(item) && item.roomId === resource.roomId,
    );
    if (resource.kind === 'furniture') {
      const tables = floor.elements.filter(
        (item) =>
          item.kind === 'furniture' &&
          item.roomId === resource.roomId &&
          TABLE_TYPES.has(item.type),
      );
      const table = closestFurnitureTarget(resource, tables, 80, true);
      if (table) add(table.type);
    }
    for (const item of floor.elements) {
      if (item.kind !== 'furniture' || item.id === resource.id || item.roomId !== resource.roomId)
        continue;
      const seating = getCatalogItem(item.type)?.isSeating === true;
      if (!seating && !['monitor', 'keyboard', 'mouse'].includes(item.type)) continue;
      if (seating && (resource.kind !== 'desk' || isWorkplace(item))) continue;
      const threshold = seating ? 80 : 32;
      const nearest = closestFurnitureTarget(
        item,
        seating ? desks : workplaces,
        threshold,
        seating,
      );
      if (nearest?.id === resource.id) add(item.type);
    }
  }
  return [...counts].map(([type, quantity]) => ({ type, quantity }));
}

/** Actual physical conflicts, independent of owner and the current accordion state. */
export function getBookingConflicts(
  floor: Floor,
  resourceId: string,
  date: string,
  start: number,
  end: number,
  bookings: ClientBooking[],
  excludeId?: string,
): ClientBooking[] {
  const target = floor.elements.find(
    (item) => item.id === resourceId && (item.kind === 'room' || isWorkplace(item)),
  );
  if (!target || !validRange(start, end)) return [];
  const parents = ancestors(target, floor);
  return bookings.filter((booking) => {
    if (
      booking.id === excludeId ||
      booking.status !== 'active' ||
      booking.floorId !== floor.id ||
      booking.date !== date ||
      booking.start >= end ||
      booking.end <= start
    )
      return false;
    if (booking.resourceId === target.id) return true;
    const booked = floor.elements.find((item) => item.id === booking.resourceId);
    if (!booked) return false;
    return (
      (target.kind === 'room' && ancestors(booked, floor).has(target.id)) ||
      (booked.kind === 'room' && parents.has(booked.id))
    );
  });
}

export function isResourceAvailable(
  floor: Floor,
  resourceId: string,
  date: string,
  start: number,
  end: number,
  bookings: ClientBooking[],
  excludeId?: string,
): boolean {
  return (
    validDate(date) &&
    validRange(start, end) &&
    getResources(floor).some((item) => item.id === resourceId) &&
    getBookingConflicts(floor, resourceId, date, start, end, bookings, excludeId).length === 0
  );
}

/** Occupancy at the time cursor is distinct from availability for a whole interval. */
export function getRoomOccupancy(
  floor: Floor,
  roomId: string,
  date: string,
  minute: number,
  bookings: ClientBooking[],
): { total: number; occupied: number; exclusive: boolean } {
  const room = floor.elements.find((item) => item.id === roomId && item.kind === 'room');
  if (!room) return { total: 0, occupied: 0, exclusive: false };
  const desks = getResources(floor).filter(
    (item) => isWorkplace(item) && ancestors(item, floor).has(roomId),
  );
  const active = bookings.filter(
    (item) =>
      item.floorId === floor.id &&
      item.date === date &&
      item.status === 'active' &&
      item.start <= minute &&
      minute < item.end,
  );
  const roomParents = ancestors(room, floor);
  const exclusive = active.some(
    (item) => item.resourceId === roomId || roomParents.has(item.resourceId),
  );
  const occupied = exclusive
    ? desks.length
    : desks.filter((desk) => {
        const deskParents = ancestors(desk, floor);
        return active.some(
          (item) => item.resourceId === desk.id || deskParents.has(item.resourceId),
        );
      }).length;
  return { total: desks.length, occupied, exclusive };
}

/** Actual child-place occupancy across time; whole-room bars are rendered separately. */
export function getRoomOccupancyBands(
  floor: Floor,
  roomId: string,
  date: string,
  bookings: ClientBooking[],
  start: number,
  end: number,
): Array<{ start: number; end: number; occupied: number; total: number }> {
  const room = floor.elements.find((item) => item.id === roomId && item.kind === 'room');
  if (!room || !validDate(date) || !validRange(start, end)) return [];
  const relevantIds = new Set([roomId, ...ancestors(room, floor)]);
  for (const resource of getResources(floor)) {
    if (!isWorkplace(resource)) continue;
    const parents = ancestors(resource, floor);
    if (!parents.has(roomId)) continue;
    relevantIds.add(resource.id);
    parents.forEach((id) => relevantIds.add(id));
  }
  const boundaries = new Set([start, end]);
  for (const item of bookings) {
    if (
      item.floorId !== floor.id ||
      item.date !== date ||
      item.status !== 'active' ||
      !relevantIds.has(item.resourceId) ||
      !validRange(item.start, item.end) ||
      item.start >= end ||
      item.end <= start
    )
      continue;
    boundaries.add(Math.max(start, item.start));
    boundaries.add(Math.min(end, item.end));
  }
  const times = [...boundaries].sort((a, b) => a - b);
  const bands: Array<{ start: number; end: number; occupied: number; total: number }> = [];
  for (let index = 0; index < times.length - 1; index++) {
    const segmentStart = times[index],
      segmentEnd = times[index + 1];
    const state = getRoomOccupancy(floor, roomId, date, (segmentStart + segmentEnd) / 2, bookings);
    if (!state.occupied || state.exclusive) continue;
    const previous = bands[bands.length - 1];
    if (
      previous &&
      previous.end === segmentStart &&
      previous.occupied === state.occupied &&
      previous.total === state.total
    ) {
      previous.end = segmentEnd;
    } else {
      bands.push({
        start: segmentStart,
        end: segmentEnd,
        occupied: state.occupied,
        total: state.total,
      });
    }
  }
  return bands;
}

export function createDemoBookings(config: OfficeConfig, date: string): ClientBooking[] {
  if (config.id !== 'office-demo') return [];
  const hours = getOfficeHours(config, date);
  if (!hours.enabled) return [];
  const bookings: ClientBooking[] = [];
  const owners = [
    { ownerId: 'anna-sokolova', ownerName: 'Анна Соколова' },
    { ownerId: 'ilya-kuznetsov', ownerName: 'Илья Кузнецов' },
    { ownerId: CURRENT_USER_ID, ownerName: 'Алексей Кузнецов' },
    { ownerId: 'maria-orlova', ownerName: 'Мария Орлова' },
  ];
  config.floors.forEach((floor, floorIndex) => {
    const resources = getResources(floor);
    const rooms = resources.filter((item) => item.kind === 'room');
    const desks = resources.filter((item) => item.kind === 'desk');
    const add = (
      resource: PlanElement | undefined,
      start: number,
      end: number,
      owner: number,
      participants?: number,
    ) => {
      if (!resource) return;
      start = Math.max(start, hours.start);
      end = Math.min(end, hours.end);
      if (
        !validRange(start, end) ||
        getBookingConflicts(floor, resource.id, date, start, end, bookings).length
      )
        return;
      bookings.push({
        id: `demo-${date}-${floor.id}-${resource.id}-${start}`,
        buildingId: config.id,
        floorId: floor.id,
        resourceId: resource.id,
        date,
        start,
        end,
        ...owners[(owner + floorIndex) % owners.length],
        status: 'active',
        ...(participants ? { participants } : {}),
      });
    };
    add(rooms[0], 540, 630, 0, 4);
    add(rooms[0], 780, 870, 1, 6);
    add(rooms[0], 960, 1050, 2, 3);
    add(rooms[1], 600, 690, 3, 2);
    add(rooms[1], 900, 960, 0, 4);
    // Shared-room desks show partial occupancy without conflicting with a room booking.
    add(desks[0], 720, 780, 0);
    add(desks[1], 840, 960, 1);
    add(desks[2], 840, 900, 3);
    add(desks[3], 570, 660, 2);
    add(desks[4], 780, 960, 0);
    add(desks[6], 840, 1020, 2);
    add(desks[8], 660, 750, 1);
    for (const room of rooms) {
      const seats = resources.filter(
        (item) => item.kind === 'furniture' && isWorkplace(item) && item.roomId === room.id,
      );
      add(seats[0], 660, 720, 0);
      add(seats[1], 840, 900, 1);
      add(seats[2], 900, 960, 3);
      add(seats[4], 1050, 1110, 2);
    }
  });
  return bookings;
}

function validBooking(value: unknown): value is ClientBooking {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    ['id', 'floorId', 'resourceId', 'ownerId', 'ownerName'].every(
      (field) => typeof item[field] === 'string' && (item[field] as string).length > 0,
    ) &&
    (item.buildingId === undefined ||
      (typeof item.buildingId === 'string' && !!item.buildingId.trim())) &&
    validDate(item.date) &&
    typeof item.start === 'number' &&
    typeof item.end === 'number' &&
    validRange(item.start, item.end) &&
    (item.status === 'active' || item.status === 'cancelled') &&
    (item.participants === undefined ||
      (typeof item.participants === 'number' &&
        Number.isInteger(item.participants) &&
        item.participants > 0))
  );
}

/** Resolve old records conservatively; a collision never assigns them to an arbitrary building. */
export function resolveBookingBuildingId(
  booking: { buildingId?: unknown; floorId?: unknown; resourceId?: unknown },
  offices: OfficeConfig[] = loadOffices(),
): string | undefined {
  if (typeof booking.buildingId === 'string' && booking.buildingId.trim())
    return booking.buildingId;
  if (typeof booking.floorId !== 'string') return undefined;
  const floorMatches = offices.filter((office) =>
    office.floors.some((floor) => floor.id === booking.floorId),
  );
  const exact = floorMatches.filter((office) =>
    office.floors.some(
      (floor) =>
        floor.id === booking.floorId &&
        floor.elements.some((resource) => resource.id === booking.resourceId),
    ),
  );
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return undefined;
  // A deleted resource can still have unambiguous historical ownership through its floor.
  return floorMatches.length === 1 ? floorMatches[0].id : undefined;
}

function readBookingStore(): ClientBooking[] | null {
  const stored = localStorage.getItem(BOOKINGS_STORAGE_KEY);
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.every(validBooking)) throw new Error();
    return parsed;
  } catch {
    throw new Error('Локальные брони повреждены. Исходные данные сохранены.');
  }
}

function hasBookingResource(config: OfficeConfig, booking: ClientBooking): boolean {
  return config.floors.some(
    (floor) =>
      floor.id === booking.floorId &&
      floor.elements.some(
        (resource) =>
          resource.id === booking.resourceId && (isWorkplace(resource) || resource.kind === 'room'),
      ),
  );
}

export function loadClientBookings(config: OfficeConfig, date: string): ClientBooking[] {
  // Callers may pass the raw catalog entry. Resource visibility must use the same
  // demo projection as the plan and scoped saver, or seat history would disappear.
  const prepared = prepareClientOffice(config);
  const stored = readBookingStore();
  if (stored === null) return createDemoBookings(prepared, date);
  const catalog = loadOffices();
  const offices = catalog.some((office) => office.id === prepared.id)
    ? catalog.map((office) => (office.id === prepared.id ? prepared : office))
    : [...catalog, prepared];
  const bookings = stored
    .filter(
      (item) =>
        resolveBookingBuildingId(item, offices) === prepared.id &&
        hasBookingResource(prepared, item),
    )
    .map((item) => ({ ...item, buildingId: prepared.id }));
  if (new Set(bookings.map((item) => item.id)).size !== bookings.length)
    throw new Error('Локальные брони содержат повторяющиеся идентификаторы.');
  return bookings;
}

/**
 * The scoped API replaces this building's visible records, preserving other buildings,
 * ambiguous legacy rows and hidden orphan history. The unscoped form is legacy full-list compatibility.
 */
export function saveClientBookings(bookings: ClientBooking[], officeId?: string): void {
  if (!bookings.every(validBooking))
    throw new Error('Не удалось сохранить брони: некорректные данные.');
  const stored = readBookingStore() ?? []; // Fail before any write when the previous store is damaged.
  if (officeId === undefined) {
    localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(bookings));
    return;
  }
  const rawOffice = loadOffice(officeId);
  if (!rawOffice) throw new Error('Не удалось сохранить брони: здание не найдено.');
  const office = prepareClientOffice(rawOffice);
  const offices = loadOffices();
  const next = bookings.map((item) => {
    if (resolveBookingBuildingId(item, offices) !== officeId)
      throw new Error('Не удалось сохранить бронь другого или неопределённого здания.');
    return { ...item, buildingId: officeId };
  });
  if (new Set(next.map((item) => item.id)).size !== next.length)
    throw new Error('Не удалось сохранить брони: повторяются идентификаторы.');
  const incoming = new Map(next.map((item) => [item.id, item]));
  const written = new Set<string>();
  const merged: ClientBooking[] = [];
  for (const item of stored) {
    if (resolveBookingBuildingId(item, offices) !== officeId) {
      merged.push(item);
      continue;
    }
    const updated = incoming.get(item.id);
    if (updated) {
      merged.push(updated);
      written.add(item.id);
    } else if (!hasBookingResource(office, item)) merged.push(item);
  }
  for (const item of next) if (!written.has(item.id)) merged.push(item);
  localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(merged));
}
