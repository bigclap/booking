import type { PlanElement } from './officeModel';

/** All physical boundaries are painted once, with this uniform world-space width. */
export const WALL_THICKNESS = 12;

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WallJoint {
  points: Array<{ x: number; y: number }>;
}

interface Line extends WallSegment {
  ux: number;
  uy: number;
  offset: number;
  start: number;
  end: number;
  minOffset: number;
  maxOffset: number;
  priority: number;
  explicitOffset?: number;
}

const EPSILON = 1e-6;
const SNAP_DISTANCE = 8;

function rotatePoint(x: number, y: number, element: PlanElement): [number, number] {
  const angle = (element.rotation * Math.PI) / 180;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  return [
    cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
}

function lineFromPoints(
  a: [number, number],
  b: [number, number],
  priority: number,
): Line | undefined {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!Number.isFinite(length) || length < EPSILON) return undefined;
  let ux = (b[0] - a[0]) / length;
  let uy = (b[1] - a[1]) / length;
  // A single orientation makes reversed endpoints describe the same line.
  if (ux < -EPSILON || (Math.abs(ux) <= EPSILON && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  if (Math.abs(ux) < EPSILON) ux = 0;
  if (Math.abs(uy) < EPSILON) uy = 0;
  const offset = -uy * a[0] + ux * a[1];
  const projectionA = ux * a[0] + uy * a[1];
  const projectionB = ux * b[0] + uy * b[1];
  return {
    x1: a[0],
    y1: a[1],
    x2: b[0],
    y2: b[1],
    ux,
    uy,
    offset,
    minOffset: offset,
    maxOffset: offset,
    start: Math.min(projectionA, projectionB),
    end: Math.max(projectionA, projectionB),
    priority,
    explicitOffset: priority === 0 ? offset : undefined,
  };
}

function rawLines(elements: PlanElement[]): Line[] {
  const result: Line[] = [];
  const add = (
    element: PlanElement,
    a: [number, number],
    b: [number, number],
    priority: number,
  ) => {
    const line = lineFromPoints(rotatePoint(...a, element), rotatePoint(...b, element), priority);
    if (line) result.push(line);
  };
  for (const element of elements) {
    if (
      ![element.x, element.y, element.width, element.height, element.rotation].every(
        Number.isFinite,
      ) ||
      element.width <= 0 ||
      element.height <= 0
    )
      continue;
    const { x, y, width, height } = element;
    if (element.kind === 'wall') {
      if (element.type === 'wall-segment' || width >= height)
        add(element, [x, y + height / 2], [x + width, y + height / 2], 0);
      else add(element, [x + width / 2, y], [x + width / 2, y + height], 0);
    } else if (element.kind === 'room') {
      add(element, [x, y], [x + width, y], 1);
      add(element, [x + width, y], [x + width, y + height], 1);
      add(element, [x + width, y + height], [x, y + height], 1);
      add(element, [x, y + height], [x, y], 1);
    }
  }
  return result;
}

function compatible(a: Line, b: Line): boolean {
  const parallel = Math.abs(a.ux * b.uy - a.uy * b.ux) <= EPSILON && a.ux * b.ux + a.uy * b.uy > 0;
  if (!parallel) return false;
  // A room outline may join an explicit wall, but it must never bridge two
  // different explicit centerlines and move either wall away from its handles.
  if (
    a.explicitOffset !== undefined &&
    b.explicitOffset !== undefined &&
    Math.abs(a.explicitOffset - b.explicitOffset) > EPSILON
  )
    return false;
  // Check the entire original offset range: a chain of nearby lines cannot
  // accidentally consume two real walls on opposite sides of a corridor.
  const offsetRange = Math.max(a.maxOffset, b.maxOffset) - Math.min(a.minOffset, b.minOffset);
  if (offsetRange > SNAP_DISTANCE + EPSILON) return false;
  return Math.max(a.start, b.start) <= Math.min(a.end, b.end) + EPSILON;
}

function merge(a: Line, b: Line): Line {
  // Explicit wall centerlines win over inferred room outlines. Equal-priority
  // outlines use a stable anchor instead of averaging and changing wall width.
  const anchor =
    a.priority < b.priority ? a : b.priority < a.priority ? b : a.offset <= b.offset ? a : b;
  return {
    ...anchor,
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    minOffset: Math.min(a.minOffset, b.minOffset),
    maxOffset: Math.max(a.maxOffset, b.maxOffset),
    explicitOffset: a.explicitOffset ?? b.explicitOffset,
  };
}

const clean = (number: number) => {
  const rounded = Math.round(number * 1e8) / 1e8;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Build one physical wall layer from explicit walls and rectangular rooms.
 * Shared/overlapping boundaries are merged; close touching boundaries are
 * snapped to the same centerline, so their stroke never becomes double thick.
 * This is derived display geometry: source resources and IDs are unchanged.
 */
export function getWallSegments(elements: PlanElement[]): WallSegment[] {
  const groups: Line[] = [];
  const lines = rawLines(elements).sort(
    (a, b) =>
      a.priority - b.priority ||
      Math.atan2(a.uy, a.ux) - Math.atan2(b.uy, b.ux) ||
      a.offset - b.offset ||
      a.start - b.start,
  );
  for (const line of lines) {
    let candidate = line;
    for (let index = 0; index < groups.length;) {
      if (compatible(candidate, groups[index])) {
        candidate = merge(candidate, groups[index]);
        groups.splice(index, 1);
        // The enlarged interval can bridge a previously separate segment.
        index = 0;
      } else index++;
    }
    groups.push(candidate);
  }
  return groups.map((line) => ({
    x1: clean(line.ux * line.start - line.uy * line.offset),
    y1: clean(line.uy * line.start + line.ux * line.offset),
    x2: clean(line.ux * line.end - line.uy * line.offset),
    y2: clean(line.uy * line.end + line.ux * line.offset),
  }));
}

/**
 * Fill only the outside wedge of two walls meeting at the same endpoint.
 * Separate butt-ended paths otherwise leave a square hole at an L corner.
 * Unconnected ends and openings receive no extension or cap.
 */
export function getWallJoints(segments: WallSegment[], thickness = WALL_THICKNESS): WallJoint[] {
  if (!Number.isFinite(thickness) || thickness <= 0) return [];
  interface Node {
    x: number;
    y: number;
    rays: Array<{ x: number; y: number }>;
  }
  const nodes = new Map<string, Node>();
  const addRay = (x: number, y: number, dx: number, dy: number) => {
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < EPSILON) return;
    const key = `${Math.round(x / EPSILON)},${Math.round(y / EPSILON)}`;
    const node = nodes.get(key) ?? { x, y, rays: [] };
    const ray = { x: dx / length, y: dy / length };
    if (
      !node.rays.some(
        (existing) =>
          Math.abs(existing.x - ray.x) < EPSILON && Math.abs(existing.y - ray.y) < EPSILON,
      )
    )
      node.rays.push(ray);
    nodes.set(key, node);
  };
  for (const segment of segments) {
    if (![segment.x1, segment.y1, segment.x2, segment.y2].every(Number.isFinite)) continue;
    addRay(segment.x1, segment.y1, segment.x2 - segment.x1, segment.y2 - segment.y1);
    addRay(segment.x2, segment.y2, segment.x1 - segment.x2, segment.y1 - segment.y2);
  }
  const radius = thickness / 2;
  const joints: WallJoint[] = [];
  for (const node of nodes.values()) {
    for (let index = 0; index < node.rays.length; index++) {
      for (let other = index + 1; other < node.rays.length; other++) {
        const a = node.rays[index],
          b = node.rays[other];
        const cross = a.x * b.y - a.y * b.x;
        if (Math.abs(cross) <= EPSILON) continue;
        const normalA = { x: -a.y, y: a.x },
          normalB = { x: -b.y, y: b.x };
        const side = cross > 0 ? -1 : 1;
        const first = {
          x: node.x + side * normalA.x * radius,
          y: node.y + side * normalA.y * radius,
        };
        const last = {
          x: node.x - side * normalB.x * radius,
          y: node.y - side * normalB.y * radius,
        };
        const denominator = 1 - (a.x * b.x + a.y * b.y);
        const miter = {
          x: (side * radius * (normalA.x - normalB.x)) / denominator,
          y: (side * radius * (normalA.y - normalB.y)) / denominator,
        };
        const points = [{ x: node.x, y: node.y }, first];
        // Bound sharp corners instead of drawing a long spike into an opening.
        if (Math.hypot(miter.x, miter.y) <= radius * 4 + EPSILON) {
          points.push({ x: node.x + miter.x, y: node.y + miter.y });
        }
        points.push(last);
        joints.push({ points });
      }
    }
  }
  return joints;
}
