import { getCatalogItem } from '../lib/catalog';
import { getRoomCapacity } from '../lib/officeModel';
import ScaleChair from '../atoms/ScaleChair';
import CanvasGrid from '../atoms/CanvasGrid';
import RoomLabel from '../atoms/RoomLabel';
import { getWallEndpoints } from '../lib/wallEditorGeometry';
import { WALL_THICKNESS } from '../lib/wallGeometry';
import type { UnderlayCorner } from '../lib/underlayGeometry';
import { round } from '../lib/planEditing';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
export default function PlanScene({ editor }: { editor: OfficePlanEditor }) {
  const {
    setConfig,
    floor,
    selected,
    underlayEditing,
    tool,
    grid,
    preview,
    camera,
    size,
    ghost,
    setGhost,
    cursor,
    setCursor,
    spacePressed,
    svgRef,
    dragRef,
    underlay,
    gridStep,
    walls,
    pointFrom,
    insertAsset,
    startPointer,
    movePointer,
    finishPointer,
    itemTool,
    wallSnapMatch,
    selectedTransform,
  } = editor;
  return (
    <svg
      ref={svgRef}
      className="editor-svg"
      aria-label="План офиса"
      viewBox={[camera.x, camera.y, size.width / camera.zoom, size.height / camera.zoom].join(' ')}
      onPointerDown={startPointer}
      onPointerMove={movePointer}
      onPointerUp={finishPointer}
      onPointerCancel={() => {
        if (dragRef.current) setConfig(dragRef.current.before);
        dragRef.current = null;
        setGhost(null);
      }}
      onPointerLeave={() => setCursor(null)}
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const type = event.dataTransfer.getData('application/x-office-asset');
        if (type) insertAsset(type, pointFrom(event.clientX, event.clientY));
      }}
    >
      <defs>
        <filter id="floor-shadow" x="-15%" y="-15%" width="130%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="24" floodColor="#6c80a0" floodOpacity=".13" />
        </filter>
      </defs>
      <rect
        x={camera.x}
        y={camera.y}
        width={size.width / camera.zoom}
        height={size.height / camera.zoom}
        fill="#f4f6fb"
      />
      <rect
        x="0"
        y="0"
        width={floor.width}
        height={floor.height}
        rx="3"
        fill="#fff"
        filter="url(#floor-shadow)"
      />
      {floor.background?.visible && (
        <image
          className="plan-underlay"
          href={floor.background.src}
          x={underlay.x}
          y={underlay.y}
          width={underlay.width}
          height={underlay.height}
          preserveAspectRatio="xMidYMid meet"
          opacity={floor.background.opacity}
          pointerEvents="none"
        />
      )}
      {floor.elements
        .filter((item) => item.kind === 'room')
        .map((room) => (
          <g
            key={room.id}
            data-element-id={room.id}
            role="button"
            aria-label={room.name}
            transform={
              'rotate(' +
              room.rotation +
              ' ' +
              (room.x + room.width / 2) +
              ' ' +
              (room.y + room.height / 2) +
              ')'
            }
            className="plan-object room-object"
          >
            <title>{room.name}</title>
            <rect
              x={room.x}
              y={room.y}
              width={room.width}
              height={room.height}
              fill={room.color}
              fillOpacity={floor.background?.visible ? 0.45 : 0.8}
            />
          </g>
        ))}
      <g
        fill="none"
        stroke="#536174"
        strokeWidth={WALL_THICKNESS}
        strokeLinecap="butt"
        strokeLinejoin="round"
        pointerEvents="none"
      >
        {walls.map((wall, index) => (
          <path key={index} d={'M' + wall.x1 + ' ' + wall.y1 + 'L' + wall.x2 + ' ' + wall.y2} />
        ))}
      </g>
      {floor.elements
        .filter((item) => item.kind === 'wall')
        .map((item) => {
          const [start, end] = getWallEndpoints(item);
          return (
            <g
              key={item.id}
              data-element-id={item.id}
              role="button"
              aria-label={item.name}
              className="wall-hit"
            >
              <path
                d={'M' + start.x + ' ' + start.y + 'L' + end.x + ' ' + end.y}
                stroke="transparent"
                strokeWidth={Math.max(WALL_THICKNESS, 14 / camera.zoom)}
                fill="none"
                pointerEvents="stroke"
              />
            </g>
          );
        })}
      {floor.elements
        .filter((item) => item.kind === 'desk' || item.kind === 'furniture')
        .map((item) => {
          const asset = getCatalogItem(item.type);
          return (
            <g
              key={item.id}
              data-element-id={item.id}
              role="button"
              aria-label={item.name}
              transform={
                'rotate(' +
                item.rotation +
                ' ' +
                (item.x + item.width / 2) +
                ' ' +
                (item.y + item.height / 2) +
                ')'
              }
              className={'plan-object ' + (item.locked ? 'object-locked' : '')}
            >
              <title>{item.name}</title>
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
                  fill="#d5ddeb"
                  rx="8"
                />
              )}
              <rect
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                fill="transparent"
              />
              {item.kind === 'desk' && item.bookable && (
                <circle
                  cx={item.x + item.width - 5}
                  cy={item.y + 4}
                  r="6"
                  fill="#7398e7"
                  stroke="white"
                  strokeWidth="2"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      {grid && !preview && (
        <CanvasGrid
          x={camera.x}
          y={camera.y}
          width={size.width / camera.zoom}
          height={size.height / camera.zoom}
          zoom={camera.zoom}
          step={gridStep}
          editing={underlayEditing}
        />
      )}
      <g data-room-label-layer="constructor" pointerEvents="none">
        {floor.elements
          .filter((item) => item.kind === 'room')
          .map((room) => (
            <RoomLabel
              key={room.id}
              room={room}
              zoom={camera.zoom}
              subtitle={
                room.bookable
                  ? (room.shared ? 'Совместное · ' : 'Переговорная · ') +
                    getRoomCapacity(room) +
                    ' мест'
                  : 'Общая зона'
              }
            />
          ))}
      </g>
      {!preview && selected?.kind === 'wall' && (
        <g className="wall-selection" data-element-id={selected.id}>
          {(() => {
            const [start, end] = getWallEndpoints(selected);
            return (
              <>
                <path
                  d={'M' + start.x + ' ' + start.y + 'L' + end.x + ' ' + end.y}
                  fill="none"
                  stroke="#7586e5"
                  strokeWidth={2 / camera.zoom}
                  pointerEvents="none"
                />
                {!selected.locked &&
                  [start, end].map((point, index) => (
                    <g
                      key={index}
                      data-handle={index === 0 ? 'wall-start' : 'wall-end'}
                      role="button"
                      aria-label={index === 0 ? 'Начало стены' : 'Конец стены'}
                      className="wall-endpoint-handle"
                    >
                      <circle cx={point.x} cy={point.y} r={12 / camera.zoom} fill="transparent" />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={5 / camera.zoom}
                        fill="white"
                        stroke="#697cdb"
                        strokeWidth={1.5 / camera.zoom}
                        pointerEvents="none"
                      />
                    </g>
                  ))}
                <text
                  x={(start.x + end.x) / 2}
                  y={(start.y + end.y) / 2 - 12 / camera.zoom}
                  textAnchor="middle"
                  fontSize={11 / camera.zoom}
                  fill="#677bc7"
                  stroke="white"
                  strokeWidth={3 / camera.zoom}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {round(Math.hypot(end.x - start.x, end.y - start.y))} ед.
                </text>
              </>
            );
          })()}
        </g>
      )}
      {!preview && selected && selected.kind !== 'wall' && (
        <g data-element-id={selected.id} transform={selectedTransform} className="selection-bounds">
          <rect
            x={selected.x - 4}
            y={selected.y - 4}
            width={selected.width + 8}
            height={selected.height + 8}
            rx="3"
            fill="none"
            stroke="#5a6de3"
            strokeWidth={1.5 / camera.zoom}
            pointerEvents="none"
          />
          {!selected.locked && (
            <>
              <line
                x1={selected.x + selected.width / 2}
                y1={selected.y - 4}
                x2={selected.x + selected.width / 2}
                y2={selected.y - 29 / camera.zoom}
                stroke="#7f8fe6"
                strokeWidth={1 / camera.zoom}
              />
              <circle
                data-handle="rotate"
                cx={selected.x + selected.width / 2}
                cy={selected.y - 29 / camera.zoom}
                r={5 / camera.zoom}
                fill="white"
                stroke="#5a6de3"
                strokeWidth={1.5 / camera.zoom}
                className="rotate-handle"
              />
              <rect
                data-handle="resize"
                x={selected.x + selected.width - 4 / camera.zoom}
                y={selected.y + selected.height - 4 / camera.zoom}
                width={8 / camera.zoom}
                height={8 / camera.zoom}
                rx={2 / camera.zoom}
                fill="white"
                stroke="#5a6de3"
                strokeWidth={1.5 / camera.zoom}
                className="resize-handle"
              />
            </>
          )}
        </g>
      )}
      {wallSnapMatch?.matched && !preview && (
        <g pointerEvents="none" className="wall-snap-marker">
          <circle
            cx={wallSnapMatch.point.x}
            cy={wallSnapMatch.point.y}
            r={7 / camera.zoom}
            fill="white"
            fillOpacity=".85"
            stroke="#3baf91"
            strokeWidth={1.5 / camera.zoom}
          />
          <circle
            cx={wallSnapMatch.point.x}
            cy={wallSnapMatch.point.y}
            r={2 / camera.zoom}
            fill="#3baf91"
          />
        </g>
      )}
      {underlayEditing && floor.background?.visible && !preview && (
        <g className="underlay-edit-bounds" aria-label="Редактирование подложки">
          <rect
            data-underlay-action="move"
            x={underlay.x}
            y={underlay.y}
            width={underlay.width}
            height={underlay.height}
            fill="transparent"
            stroke="#697cdb"
            strokeWidth={1.5 / camera.zoom}
            strokeDasharray={5 / camera.zoom + ' ' + 4 / camera.zoom}
            className="underlay-move-target"
          />
          {(['nw', 'ne', 'se', 'sw'] as UnderlayCorner[]).map((corner) => {
            const x = underlay.x + (corner.includes('e') ? underlay.width : 0),
              y = underlay.y + (corner.includes('s') ? underlay.height : 0);
            return (
              <g
                key={corner}
                data-underlay-action={corner}
                role="button"
                aria-label={'Изменить размер подложки ' + corner}
                style={{
                  cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                }}
              >
                <rect
                  x={x - 12 / camera.zoom}
                  y={y - 12 / camera.zoom}
                  width={24 / camera.zoom}
                  height={24 / camera.zoom}
                  fill="transparent"
                />
                <rect
                  x={x - 5 / camera.zoom}
                  y={y - 5 / camera.zoom}
                  width={10 / camera.zoom}
                  height={10 / camera.zoom}
                  rx={2 / camera.zoom}
                  fill="white"
                  stroke="#697cdb"
                  strokeWidth={1.5 / camera.zoom}
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </g>
      )}
      {underlayEditing && floor.background?.visible && !preview && (
        <ScaleChair
          key={floor.id}
          source={floor.background.src}
          underlay={underlay}
          viewport={{
            x: camera.x,
            y: camera.y,
            width: size.width / camera.zoom,
            height: size.height / camera.zoom,
          }}
          zoom={camera.zoom}
          panEnabled={spacePressed || tool === 'pan'}
          toWorld={pointFrom}
        />
      )}
      {ghost && (
        <g pointerEvents="none">
          <rect
            transform={
              'rotate(' +
              ghost.rotation +
              ' ' +
              (ghost.x + ghost.width / 2) +
              ' ' +
              (ghost.y + ghost.height / 2) +
              ')'
            }
            x={ghost.x}
            y={ghost.y}
            width={ghost.width}
            height={ghost.height}
            fill={ghost.kind === 'wall' ? '#657697' : '#8396ec'}
            fillOpacity=".23"
            stroke="#657bea"
            strokeWidth={1.5 / camera.zoom}
            strokeDasharray={6 / camera.zoom + ' ' + 4 / camera.zoom}
          />
          <text
            x={ghost.x}
            y={ghost.y - 10 / camera.zoom}
            fill="#6375c0"
            fontSize={11 / camera.zoom}
          >
            {ghost.kind === 'wall'
              ? Math.round(ghost.width) + ' ед.'
              : Math.round(ghost.width) + ' × ' + Math.round(ghost.height)}
          </text>
        </g>
      )}
      {itemTool && cursor && !dragRef.current && !preview && (
        <image
          href={itemTool.asset}
          x={cursor.x - itemTool.width / 2}
          y={cursor.y - itemTool.height / 2}
          width={itemTool.width}
          height={itemTool.height}
          opacity=".55"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
