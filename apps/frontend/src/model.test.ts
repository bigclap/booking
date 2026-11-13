import { describe, expect, it } from 'vitest';
import {
  createBlankFloor,
  createDemoConfig,
  getRoomCapacity,
  parseConfig,
  serializeConfig,
} from './model';

describe('office configuration', () => {
  it('restores a complete office without losing resource relationships or furniture', () => {
    const config = createDemoConfig();
    const restored = parseConfig(serializeConfig(config));
    expect(restored).toEqual(config);
    const cabinet = restored.floors[0].elements.find((element) => element.name === 'Кабинет')!;
    expect(
      restored.floors[0].elements.filter(
        (element) => element.kind === 'desk' && element.roomId === cabinet.id,
      ),
    ).toHaveLength(4);
    expect(getRoomCapacity(cabinet)).toBe(4);
  });

  it('calculates capacity from placed furniture counts instead of a stale manual total', () => {
    const room = createDemoConfig().floors[0].elements.find(
      (element) => element.name === 'Лесная',
    )!;
    expect(getRoomCapacity({ ...room, seats: 99 })).toBe(6);
    expect(getRoomCapacity({ ...room, seats: 99, equipment: [] })).toBe(0);
    expect(getRoomCapacity({ ...room, seats: 7, equipment: undefined })).toBe(7);
  });

  it('rejects damaged storage and invalid geometry without coercing it', () => {
    expect(() => parseConfig('{ damaged')).toThrow('повреждены');
    const config = createDemoConfig();
    config.floors[0].elements[0].x = Number.NaN;
    expect(() => serializeConfig(config)).toThrow('X');
    expect(() => parseConfig(JSON.stringify(config))).toThrow('X');
  });

  it('rejects duplicate identifiers and orphaned furniture instead of silently losing ownership', () => {
    const config = createDemoConfig();
    config.floors[0].elements[1].id = config.floors[0].elements[0].id;
    expect(() => parseConfig(JSON.stringify(config))).toThrow('повторяется');
    const orphaned = createDemoConfig();
    orphaned.floors[0].elements.find((element) => element.roomId)!.roomId = 'removed-room';
    expect(() => parseConfig(JSON.stringify(orphaned))).toThrow('помещение');
  });

  it('preserves embedded uploaded images and accepts an empty new floor', () => {
    const config = createDemoConfig();
    config.floors.push(createBlankFloor('Новый этаж'));
    config.floors[0].background = {
      src: 'data:image/png;base64,aGVsbG8=',
      name: 'План.png',
      opacity: 0.5,
      visible: true,
      locked: true,
    };
    expect(parseConfig(serializeConfig(config))).toEqual(config);
  });

  it('preserves independently sized hidden underlays without changing floor or object geometry', () => {
    const config = createDemoConfig();
    const originalFloor = structuredClone(config.floors[0]);
    config.floors[0].background = {
      src: 'data:image/png;base64,aGVsbG8=',
      name: 'План.png',
      opacity: 0.5,
      visible: false,
      locked: true,
      x: -240,
      y: 360,
      width: 1200,
      height: 800,
    };
    const restored = parseConfig(serializeConfig(config));
    expect(restored.floors[0].background).toEqual(config.floors[0].background);
    expect(restored.floors[0].width).toBe(originalFloor.width);
    expect(restored.floors[0].height).toBe(originalFloor.height);
    expect(restored.floors[0].elements).toEqual(originalFloor.elements);
  });

  it.each([0, -1, 20001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid underlay dimensions: %s',
    (dimension) => {
      for (const field of ['width', 'height'] as const) {
        const config = createDemoConfig();
        config.floors[0].background = {
          src: 'data:image/png;base64,aGVsbG8=',
          name: 'План.png',
          opacity: 0.5,
          visible: true,
          locked: true,
          [field]: dimension,
        };
        expect(() => serializeConfig(config)).toThrow('подложки');
        expect(() => parseConfig(JSON.stringify(config))).toThrow('подложки');
      }
    },
  );

  it.each([-100001, 100001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid underlay coordinates: %s',
    (coordinate) => {
      for (const field of ['x', 'y'] as const) {
        const config = createDemoConfig();
        config.floors[0].background = {
          src: 'data:image/png;base64,aGVsbG8=',
          name: 'План.png',
          opacity: 0.5,
          visible: true,
          locked: true,
          [field]: coordinate,
        };
        expect(() => serializeConfig(config)).toThrow('подложки');
        expect(() => parseConfig(JSON.stringify(config))).toThrow('подложки');
      }
    },
  );
});
