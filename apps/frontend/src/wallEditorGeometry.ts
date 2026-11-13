import type { PlanElement } from './model';
import { WALL_THICKNESS } from './wallGeometry';

export interface WallPoint {
  x: number;
  y: number;
}

/** Exact endpoints of the painted centerline, including legacy rectangles. */
export function getWallEndpoints(element: PlanElement): [WallPoint, WallPoint] {
  const horizontal = element.type === 'wall-segment' || element.width >= element.height;
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  const half = (horizontal ? element.width : element.height) / 2;
  const radians = (element.rotation * Math.PI) / 180;
  const dx = horizontal ? half * Math.cos(radians) : -half * Math.sin(radians);
  const dy = horizontal ? half * Math.sin(radians) : half * Math.cos(radians);
  return [
    { x: center.x - dx, y: center.y - dy },
    { x: center.x + dx, y: center.y + dy },
  ];
}

/** Canonical local horizontal segment: changing length never changes its thickness. */
export function wallFromEndpoints(
  original: PlanElement,
  start: WallPoint,
  end: WallPoint,
): PlanElement {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  let angle = Math.atan2(dy, dx);
  if (distance < 1e-8) {
    const [a, b] = getWallEndpoints(original);
    angle = Math.atan2(b.y - a.y, b.x - a.x);
  }
  const length = Math.min(20000, Math.max(1, distance));
  const finalEnd = { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
  return {
    ...original,
    type: 'wall-segment',
    x: (start.x + finalEnd.x) / 2 - length / 2,
    y: (start.y + finalEnd.y) / 2 - WALL_THICKNESS / 2,
    width: length,
    height: WALL_THICKNESS,
    rotation: (angle * 180) / Math.PI,
  };
}

/** Snap to endpoints first, then wall centerlines for T junctions; radius is in screen pixels. */
export function snapWallPoint(
  point: WallPoint,
  elements: PlanElement[],
  zoom: number,
  excludeId?: string,
): { point: WallPoint; matched: boolean } {
  const radius = 8 / Math.max(1e-6, zoom);
  const segments = elements
    .filter((element) => element.kind === 'wall' && element.id !== excludeId)
    .map(getWallEndpoints);
  const nearestPoint = (candidates: WallPoint[]): WallPoint | undefined => {
    let nearest: WallPoint | undefined;
    let distance = radius;
    for (const candidate of candidates) {
      const candidateDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (candidateDistance <= distance) {
        distance = candidateDistance;
        nearest = candidate;
      }
    }
    return nearest;
  };
  const endpoint = nearestPoint(segments.flat());
  if (endpoint) return { point: { ...endpoint }, matched: true };
  const projections: WallPoint[] = [];
  for (const [start, end] of segments) {
    const dx = end.x - start.x,
      dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) continue;
    const fraction = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
    );
    projections.push({ x: start.x + dx * fraction, y: start.y + dy * fraction });
  }
  const nearest = nearestPoint(projections);
  return { point: nearest ? { ...nearest } : { ...point }, matched: Boolean(nearest) };
}
