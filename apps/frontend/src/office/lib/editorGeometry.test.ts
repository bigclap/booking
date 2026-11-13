import { describe, expect, it } from 'vitest';
import type { PlanElement } from './officeModel';
import { resizeFromCorner, transformRoomChildren } from './editorGeometry';

const make = (patch: Partial<PlanElement> = {}): PlanElement => ({
  id: 'room',
  kind: 'room',
  type: 'meeting-room',
  name: 'Room',
  x: 100,
  y: 200,
  width: 200,
  height: 100,
  rotation: 0,
  color: '#abc',
  locked: false,
  ...patch,
});

function corner(element: PlanElement, east = false): { x: number; y: number } {
  const sign = east ? 1 : -1;
  const angle = (element.rotation * Math.PI) / 180;
  const x = (sign * element.width) / 2;
  const y = (sign * element.height) / 2;
  return {
    x: element.x + element.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: element.y + element.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe('resizeFromCorner', () => {
  it('keeps the ordinary opposite corner fixed', () => {
    const original = make();
    const resized = resizeFromCorner(
      original,
      { x: 300, y: 300 },
      { x: 330, y: 340 },
      (value) => value,
    );
    expect(resized.width).toBe(230);
    expect(resized.height).toBe(140);
    expectPoint(corner(resized), corner(original));
    expectPoint(corner(resized, true), { x: 330, y: 340 });
  });

  it('keeps the world-space anchor fixed at 90 degrees', () => {
    const original = make({ rotation: 90 });
    const start = corner(original, true);
    const end = { x: start.x - 40, y: start.y + 20 };
    const resized = resizeFromCorner(original, start, end, (value) => value);
    expect(resized.width).toBeCloseTo(220);
    expect(resized.height).toBeCloseTo(140);
    expectPoint(corner(resized), corner(original));
    expectPoint(corner(resized, true), end);
  });

  it('tracks the pointer and preserves the opposite corner at an arbitrary angle', () => {
    const original = make({ rotation: 37 });
    const start = corner(original, true);
    const end = { x: start.x + 27, y: start.y + 53 };
    const resized = resizeFromCorner(original, start, end, (value) => value);
    expectPoint(corner(resized), corner(original));
    expectPoint(corner(resized, true), end);
    expect(original.width).toBe(200);
    expect(original.height).toBe(100);
  });

  it('clamps and snaps dimensions without moving the anchor', () => {
    const original = make({ rotation: 45 });
    const start = corner(original, true);
    const resized = resizeFromCorner(
      original,
      start,
      { x: start.x, y: start.y - 1000 },
      (value) => Math.round(value / 10) * 10,
    );
    expect(resized.width).toBe(20);
    expect(resized.height).toBe(20);
    expectPoint(corner(resized), corner(original));
  });
});

describe('transformRoomChildren', () => {
  const child = make({
    id: 'chair',
    kind: 'furniture',
    type: 'chair',
    roomId: 'room',
    x: 120,
    y: 220,
    width: 40,
    height: 20,
    rotation: 15,
  });

  it('moves the parent and its children while retaining unrelated objects', () => {
    const original = make();
    const updated = { ...original, x: 140, y: 260 };
    const other = make({ id: 'other', kind: 'furniture' });
    const result = transformRoomChildren(original, updated, [original, child, other]);
    expect(result[0]).toBe(updated);
    expect(result[1].x).toBe(160);
    expect(result[1].y).toBe(280);
    expect(result[2]).toBe(other);
    expect(child.x).toBe(120);
  });

  it('rotates child positions and orientations with the room', () => {
    const original = make();
    const result = transformRoomChildren(original, { ...original, rotation: 90 }, [
      original,
      child,
    ]);
    expect(result[1].x).toBeCloseTo(200);
    expect(result[1].y).toBeCloseTo(180);
    expect(result[1].rotation).toBe(105);
    expect(result[1].roomId).toBe('room');
  });

  it('scales layout positions without resizing physical furniture', () => {
    const original = make();
    const result = transformRoomChildren(original, { ...original, width: 400, height: 200 }, [
      original,
      child,
    ]);
    expect(result[1].x).toBe(160);
    expect(result[1].y).toBe(250);
    expect(result[1].width).toBe(40);
    expect(result[1].height).toBe(20);
    expect(result[1].rotation).toBe(15);
  });

  it('transforms an already rotated room in its local coordinate system', () => {
    const original = make({ rotation: 90 });
    const localChild = make({
      id: 'desk',
      kind: 'desk',
      roomId: 'room',
      x: 200,
      y: 180,
      width: 40,
      height: 20,
      rotation: 90,
    });
    const updated = { ...original, x: 500, y: 400, width: 400, height: 200, rotation: 180 };
    const result = transformRoomChildren(original, updated, [original, localChild]);
    // Its original room-local center is (-60, -20), scaled to (-120, -40).
    // Turning 180 degrees places it at updated center + (120, 40).
    expectPoint({ x: result[1].x + 20, y: result[1].y + 10 }, { x: 820, y: 540 });
    expect(result[1].rotation).toBe(180);
  });
});
