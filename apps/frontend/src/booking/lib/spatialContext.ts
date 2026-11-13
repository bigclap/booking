import type { Floor, PlanElement } from '../../office';

export type NearbyContextKind = 'window' | 'coffee' | 'fridge' | 'water' | 'restroom';
export interface NearbyContextItem {
  id: string;
  type: string;
  name: string;
  context: NearbyContextKind;
  /** Straight-line distance between drawn boundaries, in internal plan units. */
  distance: number;
}

interface Point {
  x: number;
  y: number;
}
const EPSILON = 1e-8;
const CONTEXT_TYPES: Record<string, { context: NearbyContextKind; name: string }> = {
  window: { context: 'window', name: 'Окно' },
  'coffee-machine': { context: 'coffee', name: 'Кофемашина' },
  fridge: { context: 'fridge', name: 'Холодильник' },
  'water-cooler': { context: 'water', name: 'Кулер' },
  toilet: { context: 'restroom', name: 'Туалет' },
};

function rectangle(element: PlanElement): Point[] | undefined {
  if (
    ![element.x, element.y, element.width, element.height, element.rotation].every(
      Number.isFinite,
    ) ||
    element.width <= 0 ||
    element.height <= 0
  )
    return undefined;
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  const angle = (element.rotation * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sideX, sideY]) => {
    const x = (sideX * element.width) / 2,
      y = (sideY * element.height) / 2;
    return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
  });
}

function cross(a: Point, b: Point, point: Point): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function contains(polygon: Point[], point: Point): boolean {
  let positive = false,
    negative = false;
  for (let index = 0; index < polygon.length; index++) {
    const side = cross(polygon[index], polygon[(index + 1) % polygon.length], point);
    if (side > EPSILON) positive = true;
    if (side < -EPSILON) negative = true;
    if (positive && negative) return false;
  }
  return true;
}

function onSegment(a: Point, b: Point, point: Point): boolean {
  return (
    Math.abs(cross(a, b, point)) <= EPSILON &&
    point.x >= Math.min(a.x, b.x) - EPSILON &&
    point.x <= Math.max(a.x, b.x) + EPSILON &&
    point.y >= Math.min(a.y, b.y) - EPSILON &&
    point.y <= Math.max(a.y, b.y) + EPSILON
  );
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const first = cross(a, b, c),
    second = cross(a, b, d);
  const third = cross(c, d, a),
    fourth = cross(c, d, b);
  return (
    (((first > EPSILON && second < -EPSILON) || (first < -EPSILON && second > EPSILON)) &&
      ((third > EPSILON && fourth < -EPSILON) || (third < -EPSILON && fourth > EPSILON))) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}

function pointToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  const fraction =
    squaredLength === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength),
        );
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy);
}

function distanceBetween(first: Point[], second: Point[]): number {
  if (contains(first, second[0]) || contains(second, first[0])) return 0;
  let distance = Infinity;
  for (let i = 0; i < first.length; i++) {
    const a = first[i],
      b = first[(i + 1) % first.length];
    for (let j = 0; j < second.length; j++) {
      const c = second[j],
        d = second[(j + 1) % second.length];
      if (intersects(a, b, c, d)) return 0;
      distance = Math.min(
        distance,
        pointToSegment(a, c, d),
        pointToSegment(b, c, d),
        pointToSegment(c, a, b),
        pointToSegment(d, a, b),
      );
    }
  }
  return distance <= EPSILON ? 0 : distance;
}

/**
 * Rank environmental objects on this floor by geometric proximity. The result
 * describes the drawing, not a walking route, travel time or distance in metres.
 * No cutoff is imposed; consumers choose how many contextual hints to display.
 */
export function getNearbyContext(floor: Floor, resourceId: string): NearbyContextItem[] {
  const resource = floor.elements.find((item) => item.id === resourceId);
  const boundary = resource && rectangle(resource);
  if (!boundary) return [];
  const nearby: NearbyContextItem[] = [];
  for (const item of floor.elements) {
    const metadata = CONTEXT_TYPES[item.type];
    if (
      !metadata ||
      item.id === resourceId ||
      item.kind !== 'furniture' ||
      item.bookable === true ||
      item.resourceType === 'workplace' ||
      item.resourceType === 'meeting_room'
    )
      continue;
    const otherBoundary = rectangle(item);
    if (!otherBoundary) continue;
    nearby.push({
      id: item.id,
      type: item.type,
      name: item.name.trim() || metadata.name,
      context: metadata.context,
      distance: distanceBetween(boundary, otherBoundary),
    });
  }
  return nearby.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}
