import type { Floor } from './model';

export interface UnderlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type UnderlayCorner = 'nw' | 'ne' | 'se' | 'sw';
interface Point {
  x: number;
  y: number;
}

export function getUnderlayBounds(floor: Floor): UnderlayBounds {
  return {
    x: floor.background?.x ?? 0,
    y: floor.background?.y ?? 0,
    width: floor.background?.width ?? floor.width,
    height: floor.background?.height ?? floor.height,
  };
}

/** Keep the opposite corner fixed and project pointer movement onto the corner diagonal. */
export function resizeUnderlay(
  original: UnderlayBounds,
  start: Point,
  end: Point,
  corner: UnderlayCorner,
): UnderlayBounds {
  const east = corner.endsWith('e');
  const south = corner.startsWith('s');
  const dx = (east ? 1 : -1) * original.width;
  const dy = (south ? 1 : -1) * original.height;
  const projected = 1 + ((end.x - start.x) * dx + (end.y - start.y) * dy) / (dx * dx + dy * dy);
  const maxScale = 20000 / Math.max(original.width, original.height);
  // Extremely narrow images cannot satisfy both side limits without distortion.
  const minScale = Math.min(maxScale, 20 / Math.min(original.width, original.height));
  const scale = Math.max(minScale, Math.min(maxScale, projected));
  const width = original.width * scale;
  const height = original.height * scale;
  const anchorX = original.x + (east ? 0 : original.width);
  const anchorY = original.y + (south ? 0 : original.height);
  return { x: anchorX - (east ? 0 : width), y: anchorY - (south ? 0 : height), width, height };
}
