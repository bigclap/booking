import { describe, expect, it } from 'vitest';
import { createBlankFloor } from './officeModel';
import { getUnderlayBounds, resizeUnderlay } from './underlayGeometry';
import type { UnderlayBounds, UnderlayCorner } from './underlayGeometry';

const original: UnderlayBounds = { x: 100, y: 200, width: 600, height: 400 };
function cornerPoint(bounds: UnderlayBounds, corner: UnderlayCorner) {
  return {
    x: bounds.x + (corner.endsWith('e') ? bounds.width : 0),
    y: bounds.y + (corner.startsWith('s') ? bounds.height : 0),
  };
}
const opposite: Record<UnderlayCorner, UnderlayCorner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };

describe('underlay geometry', () => {
  it.each<UnderlayCorner>(['nw', 'ne', 'se', 'sw'])(
    'resizes %s proportionally while anchoring its opposite corner',
    (corner) => {
      const start = cornerPoint(original, corner);
      const anchor = cornerPoint(original, opposite[corner]);
      const end = {
        x: anchor.x + (start.x - anchor.x) * 1.5,
        y: anchor.y + (start.y - anchor.y) * 1.5,
      };
      const result = resizeUnderlay(original, start, end, corner);
      expect(result.width).toBeCloseTo(900);
      expect(result.height).toBeCloseTo(600);
      expect(cornerPoint(result, opposite[corner])).toEqual(anchor);
      expect(cornerPoint(result, corner)).toEqual(end);
      expect(original).toEqual({ x: 100, y: 200, width: 600, height: 400 });
    },
  );

  it('projects an off-diagonal drag instead of distorting the image', () => {
    const start = cornerPoint(original, 'se');
    const result = resizeUnderlay(original, start, { x: start.x + 100, y: start.y - 20 }, 'se');
    expect(result.width / result.height).toBeCloseTo(1.5, 12);
    expect(result.width).toBeCloseTo(660);
    expect(result.height).toBeCloseTo(440);
    expect(cornerPoint(result, 'nw')).toEqual(cornerPoint(original, 'nw'));
  });

  it('does not change size for movement perpendicular to the corner diagonal', () => {
    const start = cornerPoint(original, 'se');
    expect(resizeUnderlay(original, start, { x: start.x + 400, y: start.y - 600 }, 'se')).toEqual(
      original,
    );
  });

  it('clamps a drag past the anchor to a positive minimum size without flipping', () => {
    const start = cornerPoint(original, 'nw');
    const result = resizeUnderlay(original, start, { x: 9000, y: 9000 }, 'nw');
    expect(result.width).toBe(30);
    expect(result.height).toBe(20);
    expect(cornerPoint(result, 'se')).toEqual(cornerPoint(original, 'se'));
  });

  it('limits the largest side while preserving the image ratio', () => {
    const start = cornerPoint(original, 'sw');
    const result = resizeUnderlay(original, start, { x: -1e7, y: 1e7 }, 'sw');
    expect(result.width).toBeCloseTo(20000);
    expect(result.width / result.height).toBeCloseTo(1.5, 12);
    expect(cornerPoint(result, 'ne')).toEqual(cornerPoint(original, 'ne'));
  });

  it('uses the floor bounds for older background configurations', () => {
    const floor = createBlankFloor();
    floor.background = {
      src: 'data:image/png;base64,aGVsbG8=',
      name: 'Plan',
      opacity: 0.7,
      visible: true,
      locked: true,
    };
    expect(getUnderlayBounds(floor)).toEqual({ x: 0, y: 0, width: 1800, height: 1100 });
    floor.background = { ...floor.background, x: -50, y: 70, width: 900, height: 600 };
    expect(getUnderlayBounds(floor)).toEqual({ x: -50, y: 70, width: 900, height: 600 });
  });
});
