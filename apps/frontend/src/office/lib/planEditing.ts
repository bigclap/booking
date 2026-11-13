import { getRoomCapacity } from './officeModel';
import type { Floor, OfficeConfig, PlanElement } from './officeModel';
import type { Point } from './planEditorTypes';
import { getCatalogItem } from './catalog';
export const COLORS = ['#e5edf9', '#e3efe6', '#eee7f5', '#f6eadb', '#e2f0f1', '#f3e6e9'];
export const clone = <T>(value: T): T => structuredClone(value);
export const round = (value: number) => Math.round(value * 100) / 100;
export function inside(point: Point, room: PlanElement) {
  const cx = room.x + room.width / 2,
    cy = room.y + room.height / 2;
  const angle = (-(room.rotation || 0) * Math.PI) / 180;
  const x = (point.x - cx) * Math.cos(angle) - (point.y - cy) * Math.sin(angle);
  const y = (point.x - cx) * Math.sin(angle) + (point.y - cy) * Math.cos(angle);
  return Math.abs(x) <= room.width / 2 && Math.abs(y) <= room.height / 2;
}
export function assignRoom(element: PlanElement, floor: Floor): PlanElement {
  if (element.kind !== 'furniture' && element.kind !== 'desk') return element;
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  const rooms = floor.elements
    .filter((item) => item.kind === 'room' && inside(center, item))
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return { ...element, roomId: rooms[0]?.id };
}
export function reconcile(config: OfficeConfig, before: OfficeConfig): OfficeConfig {
  return {
    ...config,
    floors: config.floors.map((floor) => {
      const previous = before.floors.find((item) => item.id === floor.id);
      const roomIds = new Set(
        floor.elements.filter((item) => item.kind === 'room').map((item) => item.id),
      );
      const elements = floor.elements.map((item) =>
        item.roomId && !roomIds.has(item.roomId) ? { ...item, roomId: undefined } : item,
      );
      return {
        ...floor,
        elements: elements.map((item) => {
          if (item.kind !== 'room') return item;
          const counts = (items: PlanElement[]) => {
            const result = new Map<string, number>();
            items
              .filter((child) => child.kind === 'furniture' && child.roomId === item.id)
              .forEach((child) => result.set(child.type, (result.get(child.type) || 0) + 1));
            return result;
          };
          const was = counts(previous?.elements || []),
            now = counts(elements);
          const changed = [...new Set([...was.keys(), ...now.keys()])].filter(
            (type) => was.get(type) !== now.get(type),
          );
          // A geometry edit must preserve equipment declared by the server without furniture on the plan.
          if (!changed.length) return item;
          const quantities = new Map(
            (item.equipment || []).map((entry) => [entry.type, entry.quantity]),
          );
          changed.forEach((type) => {
            if (now.has(type)) quantities.set(type, now.get(type)!);
            else quantities.delete(type);
          });
          const room = {
            ...item,
            equipment: [...quantities].map(([type, quantity]) => ({ type, quantity })),
          };
          return changed.some((type) => (getCatalogItem(type)?.seats || 0) > 0)
            ? { ...room, seats: getRoomCapacity(room) }
            : room;
        }),
      };
    }),
  };
}
