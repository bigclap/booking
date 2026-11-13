import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Floor, OfficeConfig, PlanElement } from '../model';
import { createDemoConfig, serializeConfig } from '../model';
import type { ClientBooking } from './types';
import { CURRENT_USER_ID } from './types';
import {
  createDemoBookings,
  getBookingConflicts,
  getMoscowDate,
  getOfficeHours,
  getResources,
  getResourceEquipment,
  getRoomOccupancy,
  getRoomOccupancyBands,
  isResourceAvailable,
  loadClientBookings,
  loadClientOffice,
  minutesToTime,
  saveClientBookings,
  timeToMinutes,
  isWorkplace,
  prepareClientOffice,
  resolveBookingBuildingId,
} from './bookingModel';

const date = '2026-11-11';
const element = (
  id: string,
  kind: PlanElement['kind'],
  extra: Partial<PlanElement> = {},
): PlanElement => ({
  id,
  kind,
  type: kind,
  name: id,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  color: '#fff',
  locked: false,
  bookable: true,
  ...extra,
});
const floor: Floor = {
  id: 'f',
  name: 'Этаж',
  width: 1000,
  height: 1000,
  elements: [
    element('room', 'room', { shared: true, seats: 99 }),
    element('a', 'desk', { roomId: 'room' }),
    element('b', 'desk', { roomId: 'room' }),
    element('open', 'desk'),
  ],
};
const booking = (resourceId: string, extra: Partial<ClientBooking> = {}): ClientBooking => ({
  id: `booking-${resourceId}`,
  floorId: 'f',
  resourceId,
  date,
  start: 600,
  end: 660,
  ownerId: 'someone',
  ownerName: 'Сотрудник',
  status: 'active',
  ...extra,
});

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const local = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal('localStorage', local);
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('client preview booking rules', () => {
  it('allows adjacent half-open intervals and rejects even a partial overlap', () => {
    const bookings = [booking('a')];
    expect(isResourceAvailable(floor, 'a', date, 540, 600, bookings)).toBe(true);
    expect(isResourceAvailable(floor, 'a', date, 660, 720, bookings)).toBe(true);
    expect(isResourceAvailable(floor, 'a', date, 595, 605, bookings)).toBe(false);
    expect(isResourceAvailable(floor, 'a', date, 630, 635, bookings)).toBe(false);
  });

  it('blocks a whole room for a booked child, while leaving sibling places available', () => {
    const bookings = [booking('a')];
    expect(getBookingConflicts(floor, 'room', date, 600, 660, bookings)).toEqual(bookings);
    expect(isResourceAvailable(floor, 'b', date, 600, 660, bookings)).toBe(true);
    expect(isResourceAvailable(floor, 'open', date, 600, 660, bookings)).toBe(true);
  });

  it('blocks all child places for an exclusive room booking', () => {
    const bookings = [booking('room')];
    expect(isResourceAvailable(floor, 'a', date, 600, 660, bookings)).toBe(false);
    expect(isResourceAvailable(floor, 'b', date, 600, 660, bookings)).toBe(false);
    expect(isResourceAvailable(floor, 'open', date, 600, 660, bookings)).toBe(true);
  });

  it('ignores cancelled, other-date and other-floor records, and excludes the edited booking itself', () => {
    const current = booking('a', { ownerId: CURRENT_USER_ID });
    const others = [
      booking('a', { id: 'cancelled', status: 'cancelled' }),
      booking('a', { id: 'tomorrow', date: '2026-11-12' }),
      booking('a', { id: 'other-floor', floorId: 'other' }),
    ];
    expect(
      getBookingConflicts(floor, 'a', date, 600, 660, [current, ...others], current.id),
    ).toEqual([]);
    expect(isResourceAvailable(floor, 'a', date, 600, 660, [current, ...others])).toBe(false);
  });

  it('does not offer desks inside an exclusive room, or disabled resources', () => {
    const exclusive: Floor = {
      ...floor,
      elements: floor.elements.map((item) =>
        item.id === 'room'
          ? { ...item, shared: false }
          : item.id === 'open'
            ? { ...item, bookable: false }
            : item,
      ),
    };
    expect(getResources(exclusive).map((item) => item.id)).toEqual(['room']);
    const commonArea: Floor = {
      ...exclusive,
      elements: exclusive.elements.map((item) =>
        item.id === 'room' ? { ...item, bookable: false } : item,
      ),
    };
    expect(getResources(commonArea).map((item) => item.id)).toEqual(['a', 'b']);
    expect(isResourceAvailable(floor, 'missing', date, 600, 660, [])).toBe(false);
    expect(isResourceAvailable(floor, 'a', date, 660, 600, [])).toBe(false);
    expect(isResourceAvailable(floor, 'a', '2026-02-31', 600, 660, [])).toBe(false);
  });

  it('counts actual bookable places at the cursor, not room seating capacity', () => {
    const bookings = [booking('a')];
    expect(getRoomOccupancy(floor, 'room', date, 600, bookings)).toEqual({
      total: 2,
      occupied: 1,
      exclusive: false,
    });
    expect(getRoomOccupancy(floor, 'room', date, 660, bookings)).toEqual({
      total: 2,
      occupied: 0,
      exclusive: false,
    });
    expect(getRoomOccupancy(floor, 'room', date, 630, [booking('room')])).toEqual({
      total: 2,
      occupied: 2,
      exclusive: true,
    });
    expect(isResourceAvailable(floor, 'a', date, 540, 660, bookings)).toBe(false);
    expect(getRoomOccupancy(floor, 'room', date, 540, bookings).occupied).toBe(0);
  });

  it('seeds distinct rooms, partial room occupancy and own bookings without physical conflicts', () => {
    const config = createDemoConfig();
    const bookings = createDemoBookings(config, date);
    expect(bookings.some((item) => item.ownerId === CURRENT_USER_ID)).toBe(true);
    expect(new Set(bookings.map((item) => item.floorId)).size).toBe(2);
    for (const item of bookings) {
      const targetFloor = config.floors.find((candidate) => candidate.id === item.floorId)!;
      expect(
        getBookingConflicts(
          targetFloor,
          item.resourceId,
          date,
          item.start,
          item.end,
          bookings,
          item.id,
        ),
      ).toEqual([]);
    }
    const cabinet = config.floors[0].elements.find((item) => item.name === 'Кабинет')!;
    expect(getRoomOccupancy(config.floors[0], cabinet.id, date, 850, bookings)).toMatchObject({
      total: 4,
      occupied: 2,
    });
  });
});

describe('resource equipment in the preview', () => {
  const furniture = (
    id: string,
    type: string,
    x: number,
    y: number,
    extra: Partial<PlanElement> = {},
  ) => element(id, 'furniture', { type, x, y, width: 20, height: 20, roomId: 'room', ...extra });
  const equipmentFloor = (): Floor => ({
    ...floor,
    elements: [
      element('room', 'room', { shared: true }),
      element('a', 'desk', { x: 0, y: 0, width: 100, height: 60, roomId: 'room' }),
      element('b', 'desk', { x: 150, y: 0, width: 100, height: 60, roomId: 'room' }),
      furniture('monitor-a', 'monitor', 25, 5, { width: 50 }),
      furniture('keyboard-b', 'keyboard', 175, 30, { width: 50, height: 15 }),
      furniture('mouse-gap', 'mouse', 124, 15, { width: 8, height: 12 }),
      furniture('chair-a', 'chair', 30, 85, { width: 40, height: 40 }),
      furniture('chair-b', 'ergonomic-chair', 180, 85, { width: 40, height: 40 }),
      furniture('board', 'board', 5, 0),
      furniture('projector', 'projector', 160, 0),
      furniture('far-mouse', 'mouse', 600, 600),
      furniture('other-room-monitor', 'monitor', 20, 0, { roomId: 'other-room' }),
    ],
  });

  it('assigns neighboring accessories and seats to one nearest desk without borrowing room equipment', () => {
    const target = equipmentFloor();
    expect(getResourceEquipment(target, 'a')).toEqual([
      { type: 'monitor', quantity: 1 },
      { type: 'chair', quantity: 1 },
    ]);
    expect(getResourceEquipment(target, 'b')).toEqual([
      { type: 'keyboard', quantity: 1 },
      { type: 'mouse', quantity: 1 },
      { type: 'ergonomic-chair', quantity: 1 },
    ]);
    expect(getResourceEquipment(target, 'a').some((item) => item.type === 'mouse')).toBe(false);
  });

  it('uses the rotated desk rectangle when assigning equipment and nearby seating', () => {
    const target: Floor = {
      ...floor,
      elements: [
        element('rotated', 'desk', { x: 100, y: 100, width: 120, height: 60, rotation: 90 }),
        element('neighbor', 'desk', { x: 210, y: 100, width: 120, height: 60 }),
        furniture('rotated-mouse', 'mouse', 181, 120, { roomId: undefined }),
        furniture('rotated-seat', 'chair', 150, 210, { roomId: undefined }),
        furniture('neighbor-monitor', 'monitor', 260, 110, { roomId: undefined }),
      ],
    };
    expect(getResourceEquipment(target, 'rotated')).toEqual([
      { type: 'mouse', quantity: 1 },
      { type: 'chair', quantity: 1 },
    ]);
    expect(getResourceEquipment(target, 'neighbor')).toEqual([{ type: 'monitor', quantity: 1 }]);
  });

  it('prefers explicit equipment, including an explicitly empty list', () => {
    const target = equipmentFloor();
    target.elements.find((item) => item.id === 'a')!.equipment = [
      { type: 'monitor', quantity: 2 },
      { type: 'chair', quantity: 0 },
    ];
    target.elements.find((item) => item.id === 'b')!.equipment = [];
    expect(getResourceEquipment(target, 'a')).toEqual([{ type: 'monitor', quantity: 2 }]);
    expect(getResourceEquipment(target, 'b')).toEqual([]);
    expect(getResourceEquipment(target, 'missing')).toEqual([]);
  });

  it('uses room inventory when provided and otherwise counts its actual furniture', () => {
    const target = equipmentFloor();
    expect(getResourceEquipment(target, 'room')).toContainEqual({ type: 'board', quantity: 1 });
    expect(getResourceEquipment(target, 'room')).toContainEqual({ type: 'mouse', quantity: 2 });
    expect(getResourceEquipment(target, 'room')).toContainEqual({ type: 'monitor', quantity: 1 });
    target.elements.find((item) => item.id === 'room')!.equipment = [
      { type: 'projector', quantity: 3 },
    ];
    expect(getResourceEquipment(target, 'room')).toEqual([{ type: 'projector', quantity: 3 }]);
  });

  it('keeps demo cabinet chairs with the desk they face instead of the back of the next row', () => {
    const target = createDemoConfig().floors[0];
    const top = getResourceEquipment(target, 'f1-cabinet-desk-1');
    const bottom = getResourceEquipment(target, 'f1-cabinet-desk-3');
    expect(top).toContainEqual({ type: 'chair', quantity: 1 });
    expect(top).not.toContainEqual({ type: 'ergonomic-chair', quantity: 1 });
    expect(bottom).toContainEqual({ type: 'ergonomic-chair', quantity: 1 });
    expect(bottom.some((item) => item.type === 'chair')).toBe(false);
  });
});

describe('individual seats at a common table', () => {
  const seat = (id: string, extra: Partial<PlanElement> = {}) =>
    element(id, 'furniture', {
      type: 'chair',
      name: 'Стул',
      resourceType: 'workplace',
      bookable: true,
      roomId: 'room',
      width: 40,
      height: 40,
      ...extra,
    });
  const sharedFloor = (): Floor => ({
    ...floor,
    elements: [
      element('room', 'room', { shared: true, seats: 20 }),
      seat('chair-a'),
      seat('chair-b', { x: 80 }),
    ],
  });

  it('offers explicit seats as separate resources and applies whole-room conflicts in both directions', () => {
    const target = sharedFloor();
    expect(isWorkplace(target.elements[1])).toBe(true);
    expect(getResources(target).map((item) => item.id)).toEqual(['room', 'chair-a', 'chair-b']);
    const bookings = [booking('chair-a')];
    expect(isResourceAvailable(target, 'chair-b', date, 600, 660, bookings)).toBe(true);
    expect(isResourceAvailable(target, 'room', date, 600, 660, bookings)).toBe(false);
    expect(isResourceAvailable(target, 'chair-a', date, 600, 660, [booking('room')])).toBe(false);
    expect(getRoomOccupancy(target, 'room', date, 630, bookings)).toEqual({
      total: 2,
      occupied: 1,
      exclusive: false,
    });
    target.elements[0].shared = false;
    expect(getResources(target).map((item) => item.id)).toEqual(['room']);
  });

  it('enriches only the demo common-table chairs, preserving IDs, custom names and its input', () => {
    const config = createDemoConfig();
    const original = structuredClone(config);
    config.floors[0].elements.find((item) => item.id === 'f1-meeting-chair-top-0')!.name =
      'Место у доски';
    original.floors[0].elements.find((item) => item.id === 'f1-meeting-chair-top-0')!.name =
      'Место у доски';
    const prepared = prepareClientOffice(config);
    const target = prepared.floors[0];
    const meeting = target.elements.find((item) => item.id === 'f1-meeting')!;
    const chairs = getResources(target).filter(
      (item) => item.kind === 'furniture' && item.roomId === meeting.id,
    );
    expect(chairs).toHaveLength(8);
    expect(chairs[0].id).toBe('f1-meeting-chair-top-0');
    expect(chairs[0].name).toBe('Место у доски');
    expect(chairs[1].name).toBe('Заводная · место 2');
    expect(meeting.shared).toBe(true);
    expect(
      isWorkplace(target.elements.find((item) => item.id === 'f1-cabinet-desk-1-chair')!),
    ).toBe(false);
    expect(config).toEqual(original);
    expect(prepareClientOffice(prepared)).toEqual(prepared);
    const realOffice = { ...config, id: 'real-office' };
    expect(prepareClientOffice(realOffice)).toBe(realOffice);
    expect(realOffice.floors[0].elements.find((item) => item.id === 'f1-meeting')!.shared).toBe(
      false,
    );
  });

  it('loads the demo projection without replacing the constructor draft', () => {
    const config = createDemoConfig();
    const serialized = serializeConfig(config);
    const values = storage({ 'plan-room.office-builder.v1': serialized });
    const loaded = loadClientOffice();
    expect(
      getResources(loaded.floors[0]).filter(
        (item) => item.kind === 'furniture' && item.roomId === 'f1-meeting',
      ),
    ).toHaveLength(8);
    expect(values.get('plan-room.office-builder.v1')).toBe(serialized);
    expect(
      config.floors[0].elements.find((item) => item.id === 'f1-meeting-chair-top-1')!.bookable,
    ).toBeUndefined();
  });

  it('makes the default demo lounges bookable without overriding real-office exclusions', () => {
    const config = createDemoConfig();
    const prepared = prepareClientOffice(config);
    for (const [index, id] of ['f1-lounge', 'f2-lounge'].entries()) {
      const lounge = getResources(prepared.floors[index]).find((item) => item.id === id)!;
      expect(lounge.bookable).toBe(true);
      expect(lounge.resourceType).toBe('meeting_room');
      expect(config.floors[index].elements.find((item) => item.id === id)!.bookable).toBe(false);
    }
    const realOffice = { ...config, id: 'real-office' };
    expect(
      getResources(prepareClientOffice(realOffice).floors[0]).some(
        (item) => item.id === 'f1-lounge',
      ),
    ).toBe(false);
    expect(realOffice.floors[0].elements.find((item) => item.id === 'f1-lounge')!.bookable).toBe(
      false,
    );
  });

  it('counts bookable chairs as workplaces and keeps all enriched demo fixtures physically valid', () => {
    const config = prepareClientOffice(createDemoConfig());
    const target = config.floors[0];
    expect(getRoomOccupancy(target, 'f1-meeting', date, 630, [])).toEqual({
      total: 8,
      occupied: 0,
      exclusive: false,
    });
    expect(
      getRoomOccupancy(target, 'f1-meeting', date, 630, [
        booking('f1-meeting', { floorId: target.id }),
      ]),
    ).toEqual({ total: 8, occupied: 8, exclusive: true });
    const bookings = createDemoBookings(config, date);
    expect(
      bookings.some((item) =>
        target.elements.some(
          (resource) => resource.id === item.resourceId && resource.kind === 'furniture',
        ),
      ),
    ).toBe(true);
    for (const item of bookings) {
      const bookedFloor = config.floors.find((candidate) => candidate.id === item.floorId)!;
      expect(
        getBookingConflicts(
          bookedFloor,
          item.resourceId,
          date,
          item.start,
          item.end,
          bookings,
          item.id,
        ),
      ).toEqual([]);
    }
  });

  it('shows the nearby common table and individually associated accessories without room-wide inventory', () => {
    const target: Floor = {
      ...floor,
      elements: [
        element('room', 'room', { shared: true }),
        element('common-table', 'furniture', {
          type: 'meeting-table',
          roomId: 'room',
          x: 100,
          y: 100,
          width: 200,
          height: 80,
        }),
        seat('chair-a', { x: 120, y: 200, rotation: 180 }),
        seat('chair-b', { x: 240, y: 200, rotation: 180 }),
        element('monitor-a', 'furniture', {
          type: 'monitor',
          roomId: 'room',
          x: 132,
          y: 198,
          width: 16,
          height: 10,
        }),
        element('room-board', 'furniture', {
          type: 'board',
          roomId: 'room',
          x: 130,
          y: 170,
          width: 10,
          height: 10,
        }),
        element('far-monitor', 'furniture', {
          type: 'monitor',
          roomId: 'room',
          x: 210,
          y: 50,
          width: 16,
          height: 10,
        }),
      ],
    };
    expect(getResourceEquipment(target, 'chair-a')).toEqual([
      { type: 'meeting-table', quantity: 1 },
      { type: 'monitor', quantity: 1 },
    ]);
    expect(getResourceEquipment(target, 'chair-b')).toEqual([
      { type: 'meeting-table', quantity: 1 },
    ]);
    target.elements.find((item) => item.id === 'chair-a')!.equipment = [
      { type: 'keyboard', quantity: 1 },
    ];
    expect(getResourceEquipment(target, 'chair-a')).toEqual([{ type: 'keyboard', quantity: 1 }]);
  });

  it('restores a saved explicit workplace-seat booking', () => {
    const config = createDemoConfig();
    const target = sharedFloor();
    config.floors = [target];
    storage();
    const bookings = [booking('chair-a')];
    saveClientBookings(bookings);
    expect(loadClientBookings(config, date)).toEqual(
      bookings.map((item) => ({ ...item, buildingId: config.id })),
    );
  });
});

describe('room occupancy summary bands', () => {
  it('splits actual overlapping child bookings into full and partial counts', () => {
    const bookings = [
      booking('a', { start: 840, end: 960 }),
      booking('b', { start: 840, end: 900 }),
    ];
    expect(getRoomOccupancyBands(floor, 'room', date, bookings, 540, 1140)).toEqual([
      { start: 840, end: 900, occupied: 2, total: 2 },
      { start: 900, end: 960, occupied: 1, total: 2 },
    ]);
  });

  it('omits periods occupied by the whole room and leaves them to its actual booking bar', () => {
    const bookings = [
      booking('a', { start: 840, end: 960 }),
      booking('room', { start: 870, end: 900 }),
    ];
    expect(getRoomOccupancyBands(floor, 'room', date, bookings, 540, 1140)).toEqual([
      { start: 840, end: 870, occupied: 1, total: 2 },
      { start: 900, end: 960, occupied: 1, total: 2 },
    ]);
  });

  it('merges adjacent equal counts without inventing an overlap at the shared endpoint', () => {
    const bookings = [
      booking('a', { start: 840, end: 900 }),
      booking('b', { start: 900, end: 960 }),
    ];
    expect(getRoomOccupancyBands(floor, 'room', date, bookings, 540, 1140)).toEqual([
      { start: 840, end: 960, occupied: 1, total: 2 },
    ]);
  });

  it('clips to the requested office hours and ignores cancelled or unrelated records', () => {
    const bookings = [
      booking('a', { start: 480, end: 570 }),
      booking('b', { start: 540, end: 600, status: 'cancelled' }),
      booking('open', { start: 540, end: 600 }),
      booking('b', { start: 540, end: 600, date: '2026-11-12' }),
    ];
    expect(getRoomOccupancyBands(floor, 'room', date, bookings, 540, 600)).toEqual([
      { start: 540, end: 570, occupied: 1, total: 2 },
    ]);
    expect(getRoomOccupancyBands(floor, 'missing', date, bookings, 540, 600)).toEqual([]);
    expect(getRoomOccupancyBands(floor, 'room', date, bookings, 600, 540)).toEqual([]);
  });

  it('includes configured workplace seats as well as desks', () => {
    const target: Floor = {
      ...floor,
      elements: [
        element('room', 'room', { shared: true }),
        element('seat', 'furniture', {
          type: 'chair',
          resourceType: 'workplace',
          bookable: true,
          roomId: 'room',
        }),
        element('a', 'desk', { roomId: 'room' }),
      ],
    };
    const bookings = [booking('seat', { start: 840, end: 900 })];
    expect(getRoomOccupancyBands(target, 'room', date, bookings, 540, 1140)).toEqual([
      { start: 840, end: 900, occupied: 1, total: 2 },
    ]);
  });

  it('counts descendants of nested rooms and suppresses an ancestor-exclusive period', () => {
    const target: Floor = {
      ...floor,
      elements: [
        element('parent', 'room', { shared: true }),
        element('room', 'room', { shared: true, roomId: 'parent' }),
        element('a', 'desk', { roomId: 'room' }),
        element('b', 'desk', { roomId: 'parent' }),
      ],
    };
    const bookings = [booking('room', { start: 840, end: 900 })];
    expect(getRoomOccupancyBands(target, 'parent', date, bookings, 540, 1140)).toEqual([
      { start: 840, end: 900, occupied: 1, total: 2 },
    ]);
    expect(getRoomOccupancyBands(target, 'room', date, bookings, 540, 1140)).toEqual([]);
    expect(
      getRoomOccupancyBands(
        target,
        'room',
        date,
        [booking('a', { start: 840, end: 960 }), booking('parent', { start: 870, end: 900 })],
        540,
        1140,
      ),
    ).toEqual([
      { start: 840, end: 870, occupied: 1, total: 1 },
      { start: 900, end: 960, occupied: 1, total: 1 },
    ]);
  });
});

describe('multi-building booking storage', () => {
  const catalogKey = 'plan-room.offices.v1';
  const bookingsKey = 'plan-room.client-bookings.v1';
  function officeWithResource(id: string, floorId: string, resourceId: string): OfficeConfig {
    const config = createDemoConfig();
    return {
      ...config,
      id,
      name: id,
      floors: [{ ...floor, id: floorId, elements: [element(resourceId, 'desk')] }],
    };
  }
  function scoped(
    officeId: string,
    floorId: string,
    resourceId: string,
    id: string,
  ): ClientBooking {
    return { ...booking(resourceId), id, buildingId: officeId, floorId };
  }

  it('loads the requested office and never seeds a new office, even with copied geometry', () => {
    const a = officeWithResource('office-a', 'floor-a', 'desk-a');
    const b = officeWithResource('office-b', 'floor-b', 'desk-b');
    storage({ [catalogKey]: JSON.stringify({ version: 1, offices: [a, b] }) });
    expect(loadClientOffice().id).toBe(a.id);
    expect(loadClientOffice(b.id).id).toBe(b.id);
    expect(() => loadClientOffice('missing')).toThrow('не найдено');
    expect(createDemoBookings(b, date)).toEqual([]);
    expect(loadClientBookings(b, date)).toEqual([]);
  });

  it('loads and saves A without changing B when floor, resource and booking IDs collide', () => {
    const a = officeWithResource('office-a', 'same-floor', 'same-desk');
    const b = officeWithResource('office-b', 'same-floor', 'same-desk');
    const aBooking = scoped(a.id, 'same-floor', 'same-desk', 'same-booking');
    const bBooking = {
      ...scoped(b.id, 'same-floor', 'same-desk', 'same-booking'),
      ownerName: 'Другой офис',
    };
    const values = storage({
      [catalogKey]: JSON.stringify({ version: 1, offices: [a, b] }),
      [bookingsKey]: JSON.stringify([aBooking, bBooking]),
    });
    expect(loadClientBookings(a, date)).toEqual([aBooking]);
    expect(loadClientBookings(b, date)).toEqual([bBooking]);
    saveClientBookings([{ ...aBooking, status: 'cancelled' }], a.id);
    expect(loadClientBookings(a, date)[0].status).toBe('cancelled');
    expect(loadClientBookings(b, date)).toEqual([bBooking]);
    saveClientBookings(loadClientBookings(b, date), b.id);
    expect(JSON.parse(values.get(bookingsKey)!)).toEqual([
      { ...aBooking, status: 'cancelled' },
      bBooking,
    ]);
  });

  it('migrates an unambiguous legacy office only when saved and preserves other legacy and orphan history', () => {
    const a = officeWithResource('office-a', 'floor-a', 'desk-a');
    const b = officeWithResource('office-b', 'floor-b', 'desk-b');
    const legacyA = { ...booking('desk-a'), id: 'old-a', floorId: 'floor-a' };
    const legacyB = { ...booking('desk-b'), id: 'old-b', floorId: 'floor-b' };
    const orphan = { ...scoped(a.id, 'floor-a', 'deleted-desk', 'orphan'), date: '2026-11-10' };
    const unknown = { ...booking('unknown-desk'), id: 'unknown', floorId: 'unknown-floor' };
    const original = [legacyA, legacyB, orphan, unknown];
    const values = storage({
      [catalogKey]: JSON.stringify({ version: 1, offices: [a, b] }),
      [bookingsKey]: JSON.stringify(original),
    });
    const loadedA = loadClientBookings(a, date);
    expect(loadedA).toEqual([{ ...legacyA, buildingId: a.id }]);
    expect(values.get(bookingsKey)).toBe(JSON.stringify(original));
    saveClientBookings(loadedA, a.id);
    expect(JSON.parse(values.get(bookingsKey)!)).toEqual([
      { ...legacyA, buildingId: a.id },
      legacyB,
      orphan,
      unknown,
    ]);
    saveClientBookings(loadClientBookings(b, date), b.id);
    expect(JSON.parse(values.get(bookingsKey)!)).toEqual([
      { ...legacyA, buildingId: a.id },
      { ...legacyB, buildingId: b.id },
      orphan,
      unknown,
    ]);
    saveClientBookings([], a.id);
    expect(JSON.parse(values.get(bookingsKey)!)).toEqual([
      { ...legacyB, buildingId: b.id },
      orphan,
      unknown,
    ]);
  });

  it('does not guess which office owns an ambiguous legacy record', () => {
    const a = officeWithResource('office-a', 'shared-floor', 'shared-desk');
    const b = officeWithResource('office-b', 'shared-floor', 'shared-desk');
    const legacy = { ...booking('shared-desk'), floorId: 'shared-floor' };
    const values = storage({
      [catalogKey]: JSON.stringify({ version: 1, offices: [a, b] }),
      [bookingsKey]: JSON.stringify([legacy]),
    });
    expect(resolveBookingBuildingId(legacy, [a, b])).toBeUndefined();
    expect(loadClientBookings(a, date)).toEqual([]);
    expect(loadClientBookings(b, date)).toEqual([]);
    saveClientBookings([], a.id);
    saveClientBookings([], b.id);
    expect(JSON.parse(values.get(bookingsKey)!)).toEqual([legacy]);
    expect(() => saveClientBookings([legacy], a.id)).toThrow('неопределённого');
    expect(JSON.parse(values.get(bookingsKey)!)).toEqual([legacy]);
  });

  it('uses floor plus resource to disambiguate legacy records and a unique floor for orphan history', () => {
    const a = officeWithResource('office-a', 'shared-floor', 'desk-a');
    const b = officeWithResource('office-b', 'shared-floor', 'desk-b');
    expect(
      resolveBookingBuildingId({ floorId: 'shared-floor', resourceId: 'desk-a' }, [a, b]),
    ).toBe(a.id);
    expect(
      resolveBookingBuildingId({ floorId: 'shared-floor', resourceId: 'missing' }, [a, b]),
    ).toBeUndefined();
    b.floors[0].id = 'different-floor';
    expect(
      resolveBookingBuildingId({ floorId: 'shared-floor', resourceId: 'missing' }, [a, b]),
    ).toBe(a.id);
    expect(
      resolveBookingBuildingId(
        { buildingId: b.id, floorId: 'shared-floor', resourceId: 'desk-a' },
        [a, b],
      ),
    ).toBe(b.id);
  });

  it('does not seed demo bookings when a global store already exists for another office', () => {
    const a = officeWithResource('office-a', 'floor-a', 'desk-a');
    const demo = createDemoConfig();
    storage({
      [catalogKey]: JSON.stringify({ version: 1, offices: [a, demo] }),
      [bookingsKey]: JSON.stringify([scoped(a.id, 'floor-a', 'desk-a', 'only-a')]),
    });
    expect(loadClientBookings(demo, date)).toEqual([]);
    expect(loadClientBookings(a, date)).toHaveLength(1);
  });

  it.each([undefined, 'office-demo'])(
    'keeps saved demo chair bookings through raw-office load and scoped save (buildingId=%s)',
    (buildingId) => {
      const raw = createDemoConfig();
      const row: ClientBooking = {
        ...booking('f1-meeting-chair-top-0'),
        id: 'saved-chair-booking',
        floorId: 'floor-first',
        ...(buildingId ? { buildingId } : {}),
      };
      const catalogRaw = JSON.stringify({ version: 1, offices: [raw] });
      const values = storage({ [catalogKey]: catalogRaw, [bookingsKey]: JSON.stringify([row]) });
      expect(
        raw.floors[0].elements.find((item) => item.id === row.resourceId)!.bookable,
      ).toBeUndefined();
      const loaded = loadClientBookings(raw, date);
      expect(loaded).toEqual([{ ...row, buildingId: raw.id }]);
      saveClientBookings(loaded, raw.id);
      expect(JSON.parse(values.get(bookingsKey)!)).toEqual([{ ...row, buildingId: raw.id }]);
      expect(loadClientBookings(raw, date)).toEqual(loaded);
      expect(values.get(catalogKey)).toBe(catalogRaw);
      expect(
        raw.floors[0].elements.find((item) => item.id === row.resourceId)!.bookable,
      ).toBeUndefined();
    },
  );

  it('refuses foreign-office writes and preserves broken global storage byte-for-byte', () => {
    const a = officeWithResource('office-a', 'floor-a', 'desk-a');
    const b = officeWithResource('office-b', 'floor-b', 'desk-b');
    const values = storage({
      [catalogKey]: JSON.stringify({ version: 1, offices: [a, b] }),
      [bookingsKey]: '[]',
    });
    expect(() => saveClientBookings([scoped(b.id, 'floor-b', 'desk-b', 'b')], a.id)).toThrow(
      'другого',
    );
    expect(values.get(bookingsKey)).toBe('[]');
    values.set(bookingsKey, '{ broken');
    expect(() => loadClientBookings(a, date)).toThrow('повреждены');
    expect(() => saveClientBookings([], a.id)).toThrow('повреждены');
    expect(values.get(bookingsKey)).toBe('{ broken');
  });
});

describe('preview dates, hours and persistence', () => {
  it('uses the Moscow calendar date even when UTC is still the previous day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T22:30:00Z'));
    expect(getMoscowDate()).toBe('2026-11-11');
    expect(timeToMinutes('09:05')).toBe(545);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(timeToMinutes('24:05')).toBe(-1);
    expect(timeToMinutes('09:60')).toBe(-1);
    expect(minutesToTime(545)).toBe('09:05');
  });

  it('respects weekday office hours and does not seed bookings on a closed date', () => {
    const config = createDemoConfig();
    expect(getOfficeHours(config, date)).toEqual({ enabled: true, start: 540, end: 1140 });
    expect(getOfficeHours(config, '2026-11-14').enabled).toBe(false);
    expect(createDemoBookings(config, '2026-11-14')).toEqual([]);
  });

  it('reads the constructor office without writing it, and persists bookings under a separate key', () => {
    const config = createDemoConfig();
    config.name = 'План сотрудника';
    const serialized = serializeConfig(config);
    const values = storage({ 'plan-room.office-builder.v1': serialized });
    expect(loadClientOffice().name).toBe('План сотрудника');
    const bookings = createDemoBookings(config, date);
    saveClientBookings(bookings);
    expect(loadClientBookings(config, date)).toEqual(bookings);
    expect(values.get('plan-room.office-builder.v1')).toBe(serialized);
    expect(values.get('plan-room.client-bookings.v1')).toBe(JSON.stringify(bookings));
  });

  it('keeps an intentionally empty booking list and filters references removed from the current office', () => {
    const config = createDemoConfig();
    const values = storage({ 'plan-room.client-bookings.v1': '[]' });
    expect(loadClientBookings(config, date)).toEqual([]);
    const valid = createDemoBookings(config, date)[0];
    values.set(
      'plan-room.client-bookings.v1',
      JSON.stringify([valid, { ...valid, id: 'orphan', resourceId: 'removed' }]),
    );
    expect(loadClientBookings(config, date)).toEqual([valid]);
  });

  it('preserves damaged storage and refuses to replace it with seed data or new writes', () => {
    const config = createDemoConfig();
    const values = storage({
      'plan-room.client-bookings.v1': '{ damaged',
      'plan-room.office-builder.v1': '{ damaged',
    });
    expect(() => loadClientOffice()).toThrow('повреждены');
    expect(() => loadClientBookings(config, date)).toThrow('повреждены');
    expect(() => saveClientBookings(createDemoBookings(config, date))).toThrow('повреждены');
    expect(() => saveClientBookings([booking('a', { start: 660, end: 600 })])).toThrow(
      'некорректные',
    );
    expect(values.get('plan-room.office-builder.v1')).toBe('{ damaged');
  });
});
