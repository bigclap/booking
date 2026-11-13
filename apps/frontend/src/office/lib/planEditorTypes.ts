import type { OfficeConfig, PlanElement } from './officeModel';
import type { UnderlayBounds, UnderlayCorner } from './underlayGeometry';
export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Tool = 'select' | 'pan' | 'wall' | 'room' | string;
export type DragState = {
  mode:
    | 'pan'
    | 'move'
    | 'resize'
    | 'rotate'
    | 'draw'
    | 'underlay-move'
    | 'underlay-resize'
    | 'wall-end';
  wallEndpoint?: 0 | 1;
  underlay?: UnderlayBounds;
  corner?: UnderlayCorner;
  point: Point;
  client: Point;
  before: OfficeConfig;
  original?: PlanElement;
  camera: Camera;
  drawKind?: 'wall' | 'room';
};
