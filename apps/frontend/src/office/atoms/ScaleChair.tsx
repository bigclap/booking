import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getCatalogItem } from '../lib/catalog';
import type { UnderlayBounds } from '../lib/underlayGeometry';

type Point = { x: number; y: number };
interface Props {
  source: string;
  underlay: UnderlayBounds;
  viewport: UnderlayBounds;
  zoom: number;
  panEnabled: boolean;
  toWorld: (clientX: number, clientY: number) => Point;
}

const CHAIR = getCatalogItem('chair')!;

function startingPosition(underlay: UnderlayBounds, viewport: UnderlayBounds): Point {
  const left = Math.max(underlay.x, viewport.x);
  const top = Math.max(underlay.y, viewport.y);
  const right = Math.min(underlay.x + underlay.width, viewport.x + viewport.width);
  const bottom = Math.min(underlay.y + underlay.height, viewport.y + viewport.height);
  const centerX = right > left ? (left + right) / 2 : underlay.x + underlay.width / 2;
  const centerY = bottom > top ? (top + bottom) / 2 : underlay.y + underlay.height / 2;
  return { x: centerX - CHAIR.width / 2, y: centerY - CHAIR.height / 2 };
}

/** A temporary ruler made from the same chair asset and world size as the catalog. */
export default function ScaleChair({
  source,
  underlay,
  viewport,
  zoom,
  panEnabled,
  toWorld,
}: Props) {
  const [position, setPosition] = useState(() => startingPosition(underlay, viewport));
  const drag = useRef<{ pointerId: number; start: Point; position: Point } | null>(null);
  const previousSource = useRef(source);
  useEffect(() => {
    if (previousSource.current !== source) {
      previousSource.current = source;
      setPosition(startingPosition(underlay, viewport));
    }
  }, [source, underlay, viewport]);
  const start = (event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0 || panEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      start: toWorld(event.clientX, event.clientY),
      position: { ...position },
    };
  };
  const move = (event: ReactPointerEvent<SVGGElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = toWorld(event.clientX, event.clientY);
    setPosition({
      x: current.position.x + point.x - current.start.x,
      y: current.position.y + point.y - current.start.y,
    });
  };
  const finish = (event: ReactPointerEvent<SVGGElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const screen = 1 / zoom;
  const centerX = position.x + CHAIR.width / 2;
  const captionY = position.y + CHAIR.height + 12 * screen;
  return (
    <g
      className="scale-chair"
      data-scale-reference
      role="button"
      aria-label="Стул для масштаба, перетащите"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <title>
        Стул стандартного размера из каталога. Перетащите его для сравнения с подложкой.
      </title>
      <rect
        x={position.x - 6 * screen}
        y={position.y - 6 * screen}
        width={CHAIR.width + 12 * screen}
        height={CHAIR.height + 12 * screen}
        rx={5 * screen}
        fill="white"
        fillOpacity=".82"
        stroke="#98a9e2"
        strokeWidth={screen}
        strokeDasharray={3 * screen + ' ' + 3 * screen}
      />
      <image
        className="scale-chair-image"
        href={CHAIR.asset}
        x={position.x}
        y={position.y}
        width={CHAIR.width}
        height={CHAIR.height}
        pointerEvents="none"
      />
      <rect
        x={centerX - 82 * screen}
        y={captionY}
        width={164 * screen}
        height={37 * screen}
        rx={6 * screen}
        fill="white"
        fillOpacity=".96"
        stroke="#e0e6f3"
        strokeWidth={screen}
      />
      <text
        x={centerX}
        y={captionY + 14 * screen}
        textAnchor="middle"
        fontSize={10 * screen}
        fontWeight="650"
        fill="#6277b8"
        pointerEvents="none"
      >
        Стул для масштаба
      </text>
      <text
        x={centerX}
        y={captionY + 27 * screen}
        textAnchor="middle"
        fontSize={9 * screen}
        fill="#95a1b5"
        pointerEvents="none"
      >
        Как в каталоге · перетащите
      </text>
    </g>
  );
}
