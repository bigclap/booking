import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Hand, MapPinned, Maximize, Minus, Plus } from 'lucide-react';
import type { Floor, PlanElement } from '../model';
import { getCatalogItem } from '../catalog';
import RoomLabel from '../RoomLabel';
import { getWallSegments, WALL_THICKNESS } from '../wallGeometry';
import { getUnderlayBounds } from '../underlayGeometry';
import {
  getBookingConflicts,
  getResources,
  getRoomOccupancy,
  isResourceAvailable,
  isWorkplace,
  minutesToTime,
} from './bookingModel';
import type { ClientBooking, ResourceFilter } from './types';
import './booking-plan.css';

interface Props {
  floor: Floor;
  bookings: ClientBooking[];
  date: string;
  start: number;
  end: number;
  cursorMinute: number;
  selectedId: string | null;
  filter: ResourceFilter;
  onSelect: (id: string) => void;
  disabled?: boolean;
  viewMode?: 'moment' | 'interval';
}
interface Point {
  x: number;
  y: number;
}
interface Camera extends Point {
  zoom: number;
}
interface Pan {
  pointerId: number;
  client: Point;
  camera: Camera;
  resourceId?: string;
}
interface Pinch {
  distance: number;
  zoom: number;
  world: Point;
}
const FREE = '#35aa88';
const BUSY = '#d66e7b';
const PARTIAL = '#df9b3e';
const SELECTED = '#7181df';
const rotation = (item: PlanElement) =>
  `rotate(${item.rotation} ${item.x + item.width / 2} ${item.y + item.height / 2})`;

export default function BookingPlan({
  floor,
  bookings,
  date,
  start,
  end,
  cursorMinute,
  selectedId,
  filter,
  onSelect,
  disabled = false,
  viewMode = 'interval',
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [camera, setCamera] = useState<Camera>({ x: -100, y: -100, zoom: 0.4 });
  const [panning, setPanning] = useState(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const fittedFloor = useRef<string | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pan = useRef<Pan | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const moved = useRef(false);
  const resources = useMemo(() => getResources(floor), [floor]);
  const resourceIds = useMemo(() => new Set(resources.map((item) => item.id)), [resources]);
  const visibleResources = useMemo(
    () =>
      resources.filter(
        (item) =>
          filter === 'all' || (filter === 'desk' ? isWorkplace(item) : item.kind === 'room'),
      ),
    [resources, filter],
  );
  const visibleIds = useMemo(
    () => new Set(visibleResources.map((item) => item.id)),
    [visibleResources],
  );
  const walls = useMemo(
    () =>
      getWallSegments(
        floor.elements.filter((item) => item.kind !== 'room' || item.walls !== false),
      ),
    [floor.elements],
  );
  const underlay = getUnderlayBounds(floor);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let previousSize: { width: number; height: number } | null = null;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (previousSize && previousSize.width > 40 && previousSize.height > 40) {
        const dx = (previousSize.width - next.width) / 2,
          dy = (previousSize.height - next.height) / 2;
        setCamera((current) => ({
          ...current,
          x: current.x + dx / current.zoom,
          y: current.y + dy / current.zoom,
        }));
      }
      previousSize = next;
      setSize(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit = useCallback(() => {
    const zoom = Math.max(
      0.1,
      Math.min((size.width - 88) / floor.width, (size.height - 72) / floor.height, 1.15),
    );
    setCamera({
      x: (floor.width - size.width / zoom) / 2,
      y: (floor.height - size.height / zoom) / 2,
      zoom,
    });
  }, [floor.width, floor.height, size]);
  useEffect(() => {
    if (size.width > 40 && size.height > 40 && fittedFloor.current !== floor.id) {
      fittedFloor.current = floor.id;
      pointers.current.clear();
      pan.current = null;
      pinch.current = null;
      setPanning(false);
      fit();
    }
  }, [floor.id, size, fit]);
  const zoomAt = useCallback(
    (factor: number, client?: Point) => {
      setCamera((previous) => {
        const bounds = svgRef.current?.getBoundingClientRect();
        const px = client && bounds ? client.x - bounds.left : size.width / 2;
        const py = client && bounds ? client.y - bounds.top : size.height / 2;
        const zoom = Math.max(0.1, Math.min(3, previous.zoom * factor));
        return {
          x: previous.x + px / previous.zoom - px / zoom,
          y: previous.y + py / previous.zoom - py / zoom,
          zoom,
        };
      });
    },
    [size],
  );
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0015), { x: event.clientX, y: event.clientY });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  const beginPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    svgRef.current?.setPointerCapture(event.pointerId);
    if (pointers.current.size === 1) {
      const resourceId =
        (event.target as Element).closest('[data-resource-id]')?.getAttribute('data-resource-id') ||
        undefined;
      pan.current = {
        pointerId: event.pointerId,
        client: point,
        camera: { ...cameraRef.current },
        resourceId,
      };
      moved.current = false;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const bounds = svgRef.current!.getBoundingClientRect();
      const current = cameraRef.current;
      const middle = { x: (a.x + b.x) / 2 - bounds.left, y: (a.y + b.y) / 2 - bounds.top };
      pinch.current = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: current.zoom,
        world: { x: current.x + middle.x / current.zoom, y: current.y + middle.y / current.zoom },
      };
      moved.current = true;
      setPanning(true);
    }
  };
  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const bounds = svgRef.current!.getBoundingClientRect();
      const zoom = Math.max(
        0.1,
        Math.min(
          3,
          (pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance,
        ),
      );
      setCamera({
        x: pinch.current.world.x - ((a.x + b.x) / 2 - bounds.left) / zoom,
        y: pinch.current.world.y - ((a.y + b.y) / 2 - bounds.top) / zoom,
        zoom,
      });
      return;
    }
    const current = pan.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.client.x,
      dy = event.clientY - current.client.y;
    if (!moved.current && Math.hypot(dx, dy) < 5) return;
    moved.current = true;
    setPanning(true);
    setCamera({
      ...current.camera,
      x: current.camera.x - dx / current.camera.zoom,
      y: current.camera.y - dy / current.camera.zoom,
    });
  };
  const endPointer = (event: ReactPointerEvent<SVGSVGElement>, cancelled = false) => {
    const current = pan.current;
    if (
      !cancelled &&
      pointers.current.size === 1 &&
      !moved.current &&
      current?.resourceId &&
      visibleIds.has(current.resourceId)
    )
      onSelect(current.resourceId);
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current.releasePointerCapture(event.pointerId);
    if (pointers.current.size === 1) {
      const [pointerId, client] = [...pointers.current.entries()][0];
      pan.current = { pointerId, client, camera: { ...cameraRef.current } };
    } else {
      pan.current = null;
      setPanning(false);
    }
  };
  const selectByKeyboard = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(id);
    }
  };
  const available = (id: string) => isResourceAvailable(floor, id, date, start, end, bookings);
  const workplaceName = (item: PlanElement) => {
    if (item.kind !== 'furniture' || !isWorkplace(item)) return item.name;
    const room = floor.elements.find((candidate) => candidate.id === item.roomId);
    if (!room) return item.name;
    const places = resources.filter(
      (candidate) => isWorkplace(candidate) && candidate.roomId === room.id,
    );
    return (
      room.name + ' · место ' + (places.findIndex((candidate) => candidate.id === item.id) + 1)
    );
  };
  const roomOccupancy = (room: PlanElement) => {
    const atCursor = getRoomOccupancy(floor, room.id, date, cursorMinute, bookings);
    if (viewMode === 'moment') return atCursor;
    const hasAncestor = (item: PlanElement, ancestorId: string) => {
      const visited = new Set<string>();
      let parentId = item.roomId;
      while (parentId && !visited.has(parentId)) {
        if (parentId === ancestorId) return true;
        visited.add(parentId);
        parentId = floor.elements.find((candidate) => candidate.id === parentId)?.roomId;
      }
      return false;
    };
    const places = resources.filter((item) => isWorkplace(item) && hasAncestor(item, room.id));
    const conflicts = getBookingConflicts(floor, room.id, date, start, end, bookings);
    const exclusive = conflicts.some(
      (booking) => booking.resourceId === room.id || hasAncestor(room, booking.resourceId),
    );
    return {
      total: places.length,
      occupied: exclusive
        ? places.length
        : places.filter(
            (place) => getBookingConflicts(floor, place.id, date, start, end, bookings).length > 0,
          ).length,
      exclusive,
    };
  };
  const selected = floor.elements.find((item) => item.id === selectedId);
  const availabilityTime =
    viewMode === 'moment'
      ? 'в ' + minutesToTime(start)
      : minutesToTime(start) + '–' + minutesToTime(end);
  const roomDisplays = floor.elements
    .filter((item) => item.kind === 'room')
    .map((room) => {
      const interactive = resourceIds.has(room.id),
        visible = visibleIds.has(room.id),
        free = available(room.id);
      const occupancy = roomOccupancy(room);
      const partial =
        occupancy.total > 0 &&
        !occupancy.exclusive &&
        occupancy.occupied > 0 &&
        occupancy.occupied < occupancy.total;
      const fullyOccupied =
        occupancy.exclusive || (occupancy.total > 0 && occupancy.occupied === occupancy.total);
      const state = disabled
        ? 'unavailable'
        : partial
          ? 'partial'
          : fullyOccupied || (occupancy.total === 0 && !free)
            ? 'busy'
            : 'free';
      return {
        room,
        interactive,
        visible,
        occupancy,
        partial,
        state,
        stateColor: disabled
          ? '#acb9cd'
          : state === 'partial'
            ? PARTIAL
            : state === 'busy'
              ? BUSY
              : FREE,
        showState: (interactive && visible) || occupancy.total > 0,
        showCount: !disabled && partial && room.width * camera.zoom > 90,
        status: disabled
          ? 'Выберите время'
          : partial
            ? 'Занято ' + occupancy.occupied + ' из ' + occupancy.total
            : state === 'busy'
              ? 'Занята'
              : 'Свободна',
        roomFill: state === 'partial' ? '#ffe8c2' : state === 'busy' ? '#f9e6e9' : '#e1f3eb',
      };
    });

  return (
    <div
      ref={viewportRef}
      className={'bk-plan' + (panning ? ' is-panning' : '')}
      data-view-mode={viewMode}
    >
      <div className="bk-plan-caption">
        <span className="bk-plan-caption-dot" />
        Выберите место на плане{' '}
        <span className="bk-plan-caption-hint">
          <Hand size={12} />
          план можно двигать
        </span>
      </div>
      <svg
        ref={svgRef}
        className="bk-plan-svg"
        aria-label="План этажа"
        viewBox={[camera.x, camera.y, size.width / camera.zoom, size.height / camera.zoom].join(
          ' ',
        )}
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={(event) => endPointer(event)}
        onPointerCancel={(event) => endPointer(event, true)}
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          <filter id="bk-plan-shadow" x="-12%" y="-12%" width="125%" height="140%">
            <feDropShadow
              dx="0"
              dy="16"
              stdDeviation="27"
              floodColor="#657389"
              floodOpacity=".11"
            />
          </filter>
        </defs>
        <rect
          x="0"
          y="0"
          width={floor.width}
          height={floor.height}
          rx="5"
          fill="white"
          filter="url(#bk-plan-shadow)"
        />
        {floor.background?.visible && (
          <image
            href={floor.background.src}
            x={underlay.x}
            y={underlay.y}
            width={underlay.width}
            height={underlay.height}
            opacity={floor.background.opacity}
            preserveAspectRatio="xMidYMid meet"
            pointerEvents="none"
          />
        )}
        {roomDisplays.map(
          ({
            room,
            interactive,
            visible,
            occupancy,
            partial,
            state,
            stateColor,
            showState,
            roomFill,
          }) => {
            return (
              <g
                key={room.id}
                transform={rotation(room)}
                className={'bk-plan-room' + (interactive && visible ? ' is-interactive' : '')}
                data-room-id={room.id}
                data-state={state}
                {...(interactive && visible
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': 'Помещение ' + room.name,
                      'data-resource-id': room.id,
                      onKeyDown: (event: KeyboardEvent<SVGGElement>) =>
                        selectByKeyboard(event, room.id),
                    }
                  : {})}
              >
                <rect
                  x={room.x}
                  y={room.y}
                  width={room.width}
                  height={room.height}
                  fill={showState && !disabled ? roomFill : room.color}
                  fillOpacity={floor.background?.visible ? 0.55 : 0.85}
                  stroke={showState && !disabled ? stateColor : 'none'}
                  strokeWidth={1.2 / camera.zoom}
                />
                {interactive && visible && (
                  <title>
                    {disabled
                      ? room.name
                      : room.name +
                        ': ' +
                        (partial
                          ? 'частично занята, ' +
                            occupancy.occupied +
                            ' из ' +
                            occupancy.total +
                            ' мест'
                          : state === 'busy'
                            ? 'занята'
                            : 'свободна') +
                        ' ' +
                        availabilityTime}
                  </title>
                )}
              </g>
            );
          },
        )}
        <g
          fill="none"
          stroke="#657581"
          strokeWidth={WALL_THICKNESS}
          strokeLinecap="butt"
          strokeLinejoin="round"
          pointerEvents="none"
        >
          {walls.map((wall, index) => (
            <path key={index} d={`M${wall.x1} ${wall.y1}L${wall.x2} ${wall.y2}`} />
          ))}
        </g>
        {floor.elements
          .filter((item) => item.kind === 'desk' || item.kind === 'furniture')
          .map((item) => {
            const asset = getCatalogItem(item.type),
              interactive = resourceIds.has(item.id),
              visible = visibleIds.has(item.id),
              free = available(item.id);
            const name = workplaceName(item);
            return (
              <g
                key={item.id}
                transform={rotation(item)}
                opacity={interactive && !visible ? 0.36 : 1}
                className={interactive && visible ? 'bk-plan-resource is-interactive' : ''}
                {...(interactive && visible
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': 'Рабочее место ' + name,
                      'data-resource-id': item.id,
                      'data-state': disabled ? 'unavailable' : free ? 'free' : 'busy',
                      onKeyDown: (event: KeyboardEvent<SVGGElement>) =>
                        selectByKeyboard(event, item.id),
                    }
                  : {})}
              >
                {interactive && visible && (
                  <rect
                    x={item.x - 4 / camera.zoom}
                    y={item.y - 4 / camera.zoom}
                    width={item.width + 8 / camera.zoom}
                    height={item.height + 8 / camera.zoom}
                    rx={5 / camera.zoom}
                    fill={disabled ? '#edf1f7' : free ? '#e6f6ee' : '#fbe9ec'}
                    stroke={disabled ? '#acb9cd' : free ? FREE : BUSY}
                    strokeWidth={1.2 / camera.zoom}
                  />
                )}
                {asset ? (
                  <image
                    href={asset.asset}
                    x={item.x}
                    y={item.y}
                    width={item.width}
                    height={item.height}
                    preserveAspectRatio="none"
                    pointerEvents="none"
                  />
                ) : (
                  <rect
                    x={item.x}
                    y={item.y}
                    width={item.width}
                    height={item.height}
                    fill="#d4deea"
                    rx="8"
                  />
                )}
                {interactive && visible && (
                  <>
                    <rect
                      x={item.x - 4 / camera.zoom}
                      y={item.y - 4 / camera.zoom}
                      width={item.width + 8 / camera.zoom}
                      height={item.height + 8 / camera.zoom}
                      rx={5 / camera.zoom}
                      fill="transparent"
                    />
                    <circle
                      cx={item.x + item.width}
                      cy={item.y}
                      r={3 / camera.zoom}
                      fill={disabled ? '#acb9cd' : free ? FREE : BUSY}
                      stroke="white"
                      strokeWidth={1 / camera.zoom}
                    />
                    <title>
                      {disabled
                        ? name
                        : name + ': ' + (free ? 'свободно' : 'занято') + ' ' + availabilityTime}
                    </title>
                  </>
                )}
              </g>
            );
          })}
        {selected && resourceIds.has(selected.id) && (
          <g transform={rotation(selected)} pointerEvents="none" className="bk-plan-selection">
            <rect
              x={selected.x - 7 / camera.zoom}
              y={selected.y - 7 / camera.zoom}
              width={selected.width + 14 / camera.zoom}
              height={selected.height + 14 / camera.zoom}
              rx={6 / camera.zoom}
              fill="none"
              stroke="white"
              strokeWidth={5 / camera.zoom}
            />
            <rect
              x={selected.x - 7 / camera.zoom}
              y={selected.y - 7 / camera.zoom}
              width={selected.width + 14 / camera.zoom}
              height={selected.height + 14 / camera.zoom}
              rx={6 / camera.zoom}
              fill="none"
              stroke={SELECTED}
              strokeWidth={2 / camera.zoom}
            />
          </g>
        )}
        {roomDisplays.map(
          ({ room, showState, stateColor, showCount, status, state, occupancy }) => (
            <RoomLabel
              key={room.id}
              room={room}
              zoom={camera.zoom}
              subtitle={showState ? status : 'Общая зона'}
              subtitleColor={state === 'partial' && !disabled ? '#b27e32' : '#8898aa'}
              markerColor={showState ? stateColor : undefined}
              count={showCount ? occupancy.occupied + '/' + occupancy.total : undefined}
            />
          ),
        )}
      </svg>
      {resources.length > 0 && !visibleResources.length && (
        <div className="bk-plan-empty">
          <MapPinned size={25} />
          <b>
            {resources.length
              ? 'Нет ресурсов этого типа'
              : 'На этаже пока нет мест для бронирования'}
          </b>
          <span>
            {resources.length ? 'Измените фильтр или выберите другой этаж' : 'Выберите другой этаж'}
          </span>
        </div>
      )}
      <div className="bk-plan-legend">
        {disabled ? (
          <span>
            <i className="is-neutral" />
            Выберите рабочее время
          </span>
        ) : (
          <>
            <span>
              <i className="is-free" />
              Свободно
            </span>
            <span>
              <i className="is-busy" />
              Занято
            </span>
            <span>
              <i className="is-partial" />
              Частично
            </span>
          </>
        )}
        <span>
          <i className="is-selected" />
          Выбрано
        </span>
      </div>
      <div className="bk-plan-zoom">
        <button type="button" aria-label="Уменьшить масштаб плана" onClick={() => zoomAt(0.8)}>
          <Minus size={15} />
        </button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button type="button" aria-label="Увеличить масштаб плана" onClick={() => zoomAt(1.25)}>
          <Plus size={15} />
        </button>
        <i />
        <button type="button" aria-label="Вписать план этажа" onClick={fit}>
          <Maximize size={15} />
        </button>
      </div>
    </div>
  );
}
