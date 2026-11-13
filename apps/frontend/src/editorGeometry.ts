import type { PlanElement } from './model';

interface Point {
  x: number;
  y: number;
}

function rotate(point: Point, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function center(element: PlanElement): Point {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
}

/** Resize the SE handle, preserving the opposite corner in world coordinates. */
export function resizeFromCorner(
  original: PlanElement,
  start: Point,
  end: Point,
  snap: (value: number) => number,
): PlanElement {
  const movement = rotate({ x: end.x - start.x, y: end.y - start.y }, -original.rotation);
  const width = Math.max(20, snap(original.width + movement.x));
  const height = Math.max(20, snap(original.height + movement.y));
  const oldCenter = center(original);
  const oldCornerOffset = rotate(
    { x: -original.width / 2, y: -original.height / 2 },
    original.rotation,
  );
  const anchor = { x: oldCenter.x + oldCornerOffset.x, y: oldCenter.y + oldCornerOffset.y };
  const newCenterOffset = rotate({ x: width / 2, y: height / 2 }, original.rotation);

  return {
    ...original,
    x: anchor.x + newCenterOffset.x - width / 2,
    y: anchor.y + newCenterOffset.y - height / 2,
    width,
    height,
  };
}

/**
 * Replace a room and transform the centers/orientation of its direct children.
 * Room resizing scales the layout positions, while physical furniture sizes
 * remain unchanged. Non-members and input objects are never mutated.
 */
export function transformRoomChildren(
  original: PlanElement,
  updated: PlanElement,
  elements: PlanElement[],
): PlanElement[] {
  const oldCenter = center(original);
  const newCenter = center(updated);
  const scaleX = original.width > 0 ? updated.width / original.width : 1;
  const scaleY = original.height > 0 ? updated.height / original.height : 1;
  const rotationDelta = updated.rotation - original.rotation;

  return elements.map((element) => {
    if (element.id === original.id) return updated;
    if (original.kind !== 'room' || element.roomId !== original.id) return element;
    const oldChildCenter = center(element);
    const local = rotate(
      {
        x: oldChildCenter.x - oldCenter.x,
        y: oldChildCenter.y - oldCenter.y,
      },
      -original.rotation,
    );
    const transformed = rotate({ x: local.x * scaleX, y: local.y * scaleY }, updated.rotation);
    return {
      ...element,
      x: newCenter.x + transformed.x - element.width / 2,
      y: newCenter.y + transformed.y - element.height / 2,
      rotation: element.rotation + rotationDelta,
    };
  });
}
