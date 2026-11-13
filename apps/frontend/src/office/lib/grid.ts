export const GRID_STEP = 5;

const VISIBLE_STEPS = [GRID_STEP, 10, 25, 50, 100, 250, 500, 1000];

/** The visible grid adapts to zoom without changing the fixed snap interval. */
export function getVisibleGridStep(zoom: number): number {
  return VISIBLE_STEPS.find((step) => step * zoom >= 8) ?? VISIBLE_STEPS[VISIBLE_STEPS.length - 1];
}
