import { describe, expect, it } from 'vitest';
import type { Floor, PlanElement } from '../model';
import { getNearbyContext } from './spatialContext';

const object = (
  id: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<PlanElement> = {},
): PlanElement => ({
  id,
  kind: 'furniture',
  type,
  name: id,
  x,
  y,
  width,
  height,
  rotation: 0,
  color: '#fff',
  locked: false,
  ...extra,
});
const floor = (...elements: PlanElement[]): Floor => ({
  id: 'floor',
  name: 'Этаж',
  width: 1000,
  height: 1000,
  elements,
});

describe('environment context geometry', () => {
  it('ranks windows and coffee by the nearest boundary instead of their center distance', () => {
    const target = floor(
      object('desk', 'desk', 100, 100, 100, 50, { kind: 'desk', bookable: true }),
      object('coffee', 'coffee-machine', 250, 100, 20, 20),
      object('window', 'window', 80, 100, 10, 50, { name: 'Окно у фасада' }),
      object('plant', 'plant', 100, 100, 10, 10),
    );
    expect(getNearbyContext(target, 'desk')).toEqual([
      { id: 'window', type: 'window', name: 'Окно у фасада', context: 'window', distance: 10 },
      { id: 'coffee', type: 'coffee-machine', name: 'coffee', context: 'coffee', distance: 50 },
    ]);
  });

  it('accounts for rotation of the resource rectangle', () => {
    const target = floor(
      object('desk', 'desk', 100, 100, 120, 40, { kind: 'desk', rotation: 90 }),
      object('window', 'window', 190, 100, 10, 20),
    );
    expect(getNearbyContext(target, 'desk')[0].distance).toBeCloseTo(10);
    target.elements[0].rotation = 0;
    expect(getNearbyContext(target, 'desk')[0].distance).toBe(0);
  });

  it('accounts for rotation of the environment object and diagonal closest edges', () => {
    const target = floor(
      object('desk', 'desk', 100, 100, 100, 50, { kind: 'desk' }),
      object('window', 'window', 220, 100, 100, 20, { rotation: 90 }),
    );
    expect(getNearbyContext(target, 'desk')[0].distance).toBeCloseTo(60);
    const diagonal = floor(
      object('desk', 'desk', 0, 0, 100, 100, { kind: 'desk', rotation: 45 }),
      object('coffee', 'coffee-machine', 150, 40, 10, 20),
    );
    expect(getNearbyContext(diagonal, 'desk')[0].distance).toBeCloseTo(150 - 50 - Math.sqrt(5000));
  });

  it('returns zero for contained, touching and crossing boundaries', () => {
    const contained = floor(
      object('room', 'room', 0, 0, 100, 100, { kind: 'room' }),
      object('water', 'water-cooler', 40, 40, 20, 20),
    );
    expect(getNearbyContext(contained, 'room')[0].distance).toBe(0);
    const crossing = floor(
      object('desk', 'desk', 0, 40, 100, 20, { kind: 'desk' }),
      object('window', 'window', 40, 0, 20, 100),
    );
    expect(getNearbyContext(crossing, 'desk')[0].distance).toBe(0);
    const touching = floor(
      object('desk', 'desk', 0, 0, 100, 100, { kind: 'desk' }),
      object('fridge', 'fridge', 100, 20, 20, 40),
    );
    expect(getNearbyContext(touching, 'desk')[0].distance).toBe(0);
  });

  it('returns all supported types without a fabricated metre or proximity cutoff', () => {
    const target = floor(
      object('desk', 'desk', 0, 0, 10, 10, { kind: 'desk' }),
      object('far-restroom', 'toilet', 9000, 0, 10, 10),
      object('water', 'water-cooler', 20, 0, 10, 10),
      object('fridge', 'fridge', 40, 0, 10, 10),
    );
    expect(getNearbyContext(target, 'desk').map((item) => item.context)).toEqual([
      'water',
      'fridge',
      'restroom',
    ]);
    expect(getNearbyContext(target, 'desk')[2].distance).toBe(8990);
  });

  it('excludes the amenity itself, bookable resources and unsupported furniture', () => {
    const target = floor(
      object('window', 'window', 0, 0, 10, 10),
      object('coffee', 'coffee-machine', 20, 0, 10, 10),
      object('bookable-coffee', 'coffee-machine', 30, 0, 10, 10, {
        resourceType: 'workplace',
        bookable: true,
      }),
      object('plant', 'plant', 10, 0, 10, 10),
      object('fake-room-window', 'window', 10, 0, 10, 10, { kind: 'room' }),
    );
    expect(getNearbyContext(target, 'window').map((item) => item.id)).toEqual(['coffee']);
    expect(getNearbyContext(target, 'missing')).toEqual([]);
  });

  it('stays scoped to the supplied floor and skips damaged geometry', () => {
    const first = floor(
      object('desk', 'desk', 0, 0, 100, 100, { kind: 'desk' }),
      object('bad-window', 'window', Number.NaN, 0, 10, 10),
    );
    const second = {
      ...floor(object('coffee', 'coffee-machine', 0, 0, 10, 10)),
      id: 'other-floor',
    };
    expect(getNearbyContext(first, 'desk')).toEqual([]);
    expect(getNearbyContext(second, 'desk')).toEqual([]);
  });
});
