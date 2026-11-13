import { describe, expect, it } from 'vitest';
import type { PlanElement } from './officeModel';
import { getWallSegments, WALL_THICKNESS } from './wallGeometry';

function element(
  kind: PlanElement['kind'],
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
): PlanElement {
  return {
    id: `${kind}-${x}-${y}-${rotation}`,
    kind,
    type: kind,
    name: kind,
    x,
    y,
    width,
    height,
    rotation,
    color: '#555',
    locked: false,
  };
}

describe('shared wall display geometry', () => {
  it('merges the shared boundary and adjoining outer edges of two rooms', () => {
    const segments = getWallSegments([
      element('room', 0, 0, 100, 100),
      element('room', 100, 0, 100, 100),
    ]);
    expect(WALL_THICKNESS).toBe(12);
    expect(segments).toHaveLength(5);
    expect(segments.filter((segment) => segment.x1 === 100 && segment.x2 === 100)).toEqual([
      { x1: 100, y1: 0, x2: 100, y2: 100 },
    ]);
  });

  it('snaps a room boundary touching an exterior wall to its existing centerline', () => {
    const segments = getWallSegments([
      element('room', 12, 10, 100, 100),
      element('wall', 0, 0, 12, 130),
    ]);
    expect(
      segments.filter((segment) => Math.abs(segment.x1 - 6) < 0.01 && segment.x1 === segment.x2),
    ).toEqual([{ x1: 6, y1: 0, x2: 6, y2: 130 }]);
    expect(segments.some((segment) => segment.x1 === 12 && segment.x2 === 12)).toBe(false);
  });

  it('preserves separate parallel walls across a genuine corridor', () => {
    expect(
      getWallSegments([element('wall', 0, 0, 12, 200), element('wall', 30, 0, 12, 200)]),
    ).toEqual([
      { x1: 36, y1: 0, x2: 36, y2: 200 },
      { x1: 6, y1: 0, x2: 6, y2: 200 },
    ]);
  });

  it('deduplicates rotated shared room boundaries', () => {
    const shift = 100 / Math.sqrt(2);
    const segments = getWallSegments([
      element('room', 0, 0, 100, 100, 45),
      element('room', shift, shift, 100, 100, 45),
    ]);
    expect(segments).toHaveLength(5);
    const shared = segments.filter(
      (segment) =>
        Math.abs(Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) - 100) < 0.001,
    );
    expect(shared).toHaveLength(3);
    expect(
      segments.some(
        (segment) =>
          Math.abs(segment.x1 - 50) < 0.001 &&
          Math.abs(segment.y1 - (50 + shift)) < 0.001 &&
          Math.abs(segment.x2 - (50 + shift)) < 0.001 &&
          Math.abs(segment.y2 - 50) < 0.001,
      ),
    ).toBe(true);
  });

  it('merges an identical wall with reversed endpoints', () => {
    expect(
      getWallSegments([element('wall', 0, 0, 100, 12), element('wall', 0, 0, 100, 12, 180)]),
    ).toEqual([{ x1: 0, y1: 6, x2: 100, y2: 6 }]);
  });

  it('does not bridge disconnected near-parallel wall sections', () => {
    expect(
      getWallSegments([element('wall', 0, 0, 100, 12), element('wall', 150, 4, 100, 12)]),
    ).toHaveLength(2);
  });

  it('does not move a distinct explicit centerline to another wall within the room snap tolerance', () => {
    expect(
      getWallSegments([element('wall', 0, 0, 100, 12), element('wall', 0, 4, 100, 12)]),
    ).toEqual([
      { x1: 0, y1: 6, x2: 100, y2: 6 },
      { x1: 0, y1: 10, x2: 100, y2: 10 },
    ]);
  });

  it('does not let an inferred room boundary bridge two explicit centerlines', () => {
    const segments = getWallSegments([
      element('wall', 0, 0, 100, 12),
      element('wall', 0, 4, 100, 12),
      element('room', 0, 6, 100, 100),
    ]);
    expect(segments.filter((segment) => segment.y1 === segment.y2 && segment.y1 <= 10)).toEqual([
      { x1: 0, y1: 10, x2: 100, y2: 10 },
      { x1: 0, y1: 6, x2: 100, y2: 6 },
    ]);
  });

  it('ignores furniture instead of treating its outline as a physical wall', () => {
    expect(getWallSegments([element('furniture', 0, 0, 100, 50)])).toEqual([]);
  });
});
