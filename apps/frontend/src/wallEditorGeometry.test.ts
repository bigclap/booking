import { describe, expect, it } from 'vitest';
import type { PlanElement } from './model';
import { getWallSegments, WALL_THICKNESS } from './wallGeometry';
import { getWallEndpoints, snapWallPoint, wallFromEndpoints } from './wallEditorGeometry';

function wall(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
  id = 'wall',
): PlanElement {
  return {
    id,
    kind: 'wall',
    type: 'wall',
    name: 'Existing wall',
    x,
    y,
    width,
    height,
    rotation,
    color: '#555',
    locked: false,
  };
}

describe('wall editing geometry', () => {
  it('uses the rendered legacy centerline rather than the oversized rectangle corners', () => {
    expect(getWallEndpoints(wall(10, 20, 100, 20))).toEqual([
      { x: 10, y: 30 },
      { x: 110, y: 30 },
    ]);
    expect(getWallEndpoints(wall(10, 20, 20, 100))).toEqual([
      { x: 20, y: 20 },
      { x: 20, y: 120 },
    ]);
    const endpoints = getWallEndpoints(wall(10, 20, 100, 20, 90));
    expect(endpoints[0].x).toBeCloseTo(60);
    expect(endpoints[0].y).toBeCloseTo(-20);
    expect(endpoints[1].x).toBeCloseTo(60);
    expect(endpoints[1].y).toBeCloseTo(80);
  });

  it('changes one endpoint without drifting the fixed opposite end or changing thickness', () => {
    const original = wall(10, 20, 20, 100);
    const before = structuredClone(original);
    const changed = wallFromEndpoints(original, { x: 20, y: 20 }, { x: 20, y: 160 });
    expect(getWallEndpoints(changed)[0].x).toBeCloseTo(20);
    expect(getWallEndpoints(changed)[0].y).toBeCloseTo(20);
    expect(getWallEndpoints(changed)[1].x).toBeCloseTo(20);
    expect(getWallEndpoints(changed)[1].y).toBeCloseTo(160);
    expect(changed.height).toBe(WALL_THICKNESS);
    expect(changed.id).toBe(original.id);
    expect(changed.name).toBe(original.name);
    expect(original).toEqual(before);
  });

  it('keeps a short segment horizontal in the renderer even when length is below thickness', () => {
    const changed = wallFromEndpoints(wall(0, 0, 100, 12), { x: 10, y: 20 }, { x: 15, y: 20 });
    expect(changed.width).toBe(5);
    expect(changed.height).toBe(12);
    expect(getWallSegments([changed])).toEqual([{ x1: 10, y1: 20, x2: 15, y2: 20 }]);
  });

  it('supports diagonal segments and prevents invalid zero-length geometry', () => {
    const original = wall(0, 0, 100, 12);
    const changed = wallFromEndpoints(original, { x: 5, y: 10 }, { x: 35, y: 50 });
    expect(changed.width).toBeCloseTo(50);
    const [start, end] = getWallEndpoints(changed);
    expect(start.x).toBeCloseTo(5);
    expect(start.y).toBeCloseTo(10);
    expect(end.x).toBeCloseTo(35);
    expect(end.y).toBeCloseTo(50);
    const zero = wallFromEndpoints(original, { x: 5, y: 10 }, { x: 5, y: 10 });
    expect(zero.width).toBe(1);
    expect(getWallEndpoints(zero)).toEqual([
      { x: 5, y: 10 },
      { x: 6, y: 10 },
    ]);
  });

  it('prioritizes endpoint joins over nearer segment projections', () => {
    const walls = [wall(0, -6, 100, 12, 0, 'horizontal'), wall(2, 1, 12, 100, 0, 'vertical')];
    expect(snapWallPoint({ x: 7, y: 3 }, walls, 1)).toEqual({
      point: { x: 8, y: 1 },
      matched: true,
    });
  });

  it('snaps a T junction to a centerline without changing the other wall', () => {
    const original = wall(0, 14, 100, 12);
    const copy = structuredClone(original);
    expect(snapWallPoint({ x: 45, y: 24 }, [original], 1)).toEqual({
      point: { x: 45, y: 20 },
      matched: true,
    });
    expect(original).toEqual(copy);
  });

  it('uses the same screen distance at high zoom and excludes the wall being edited', () => {
    const original = wall(0, 14, 100, 12);
    expect(snapWallPoint({ x: 45, y: 24 }, [original], 3)).toEqual({
      point: { x: 45, y: 24 },
      matched: false,
    });
    expect(snapWallPoint({ x: 45, y: 22 }, [original], 3)).toEqual({
      point: { x: 45, y: 20 },
      matched: true,
    });
    expect(snapWallPoint({ x: 45, y: 22 }, [original], 3, original.id)).toEqual({
      point: { x: 45, y: 22 },
      matched: false,
    });
  });
});
