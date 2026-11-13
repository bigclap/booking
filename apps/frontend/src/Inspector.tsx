import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Armchair,
  Building2,
  Copy,
  DoorOpen,
  LockKeyhole,
  MousePointer2,
  RotateCw,
  Settings2,
  Square,
  Trash2,
  UnlockKeyhole,
} from 'lucide-react';
import type { Floor, PlanElement } from './model';
import { getCatalogItem } from './catalog';
import { getWallEndpoints, wallFromEndpoints } from './wallEditorGeometry';
import { WALL_THICKNESS } from './wallGeometry';

export interface InspectorProps {
  element: PlanElement | null;
  floor: Floor;
  onChange: (patch: Partial<PlanElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSelect: (id: string) => void;
  onReorder: (direction: 'front' | 'back') => void;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  disabled = false,
  integer = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
  integer?: boolean;
}) {
  const display = String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type="number"
        aria-label={label}
        value={draft}
        min={min}
        step="1"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = Number(next);
          if (next.trim() && Number.isFinite(parsed) && (min === undefined || parsed >= min)) {
            const normalized = integer ? Math.round(parsed) : parsed;
            if (integer) setDraft(String(normalized));
            onChange(normalized);
          }
        }}
        onBlur={() => {
          const parsed = Number(draft);
          if (!draft.trim() || !Number.isFinite(parsed)) setDraft(display);
          else {
            const clamped = min === undefined ? parsed : Math.max(min, parsed);
            const next = integer ? Math.round(clamped) : clamped;
            setDraft(String(next));
            if (next !== value) onChange(next);
          }
        }}
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <div className="toggle-row">
      <div>
        <span>{label}</span>
        {description && (
          <small className="muted" style={{ display: 'block', marginTop: 4, lineHeight: 1.5 }}>
            {description}
          </small>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`toggle-switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

const KIND_LABELS = {
  room: 'Помещение',
  wall: 'Стена',
  desk: 'Рабочее место',
  furniture: 'Оснащение',
};

export default function Inspector({
  element,
  floor,
  onChange,
  onDelete,
  onDuplicate,
  onSelect,
  onReorder,
}: InspectorProps) {
  const rooms = floor.elements.filter((item) => item.kind === 'room');
  const desks = floor.elements.filter((item) => item.kind === 'desk');

  if (!element)
    return (
      <aside className="inspector">
        <div className="inspector-title">
          Свойства объекта <Settings2 size={17} />
        </div>
        <div className="inspector-content">
          <div className="inspector-empty" style={{ marginTop: 45 }}>
            <div>
              <MousePointer2 size={24} />
            </div>
            <h3>Выберите объект</h3>
            <p>Положение, размеры и оснащение — всё можно настроить здесь.</p>
          </div>
          <section className="property-section">
            <div className="section-label">НА ЭТАЖЕ</div>
            <div className="stat-grid">
              <div className="stat-item">
                <Building2 size={17} />
                <b>{rooms.length}</b>
                <span>помещений</span>
              </div>
              <div className="stat-item">
                <Armchair size={17} />
                <b>{desks.length}</b>
                <span>рабочих мест</span>
              </div>
            </div>
          </section>
          {rooms.length > 0 && (
            <section className="property-section">
              <div className="section-label">ПОМЕЩЕНИЯ</div>
              <div className="equipment-list">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    className="equipment-row"
                    onClick={() => onSelect(room.id)}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: room.color,
                        flexShrink: 0,
                      }}
                    />
                    <span>{room.name}</span>
                    <DoorOpen size={14} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="inspector-note">
          <span>01</span>
          <div>
            <b>План как основа</b>
            <p>Загрузите подложку и расставьте объекты поверх неё.</p>
          </div>
        </div>
      </aside>
    );

  const catalogItem = getCatalogItem(element.type);
  const children =
    element.kind === 'room' ? floor.elements.filter((item) => item.roomId === element.id) : [];
  const equipment = new Map<string, { quantity: number; id: string }>();
  for (const item of children.filter((item) => item.kind === 'furniture')) {
    const group = equipment.get(item.type);
    equipment.set(item.type, { quantity: (group?.quantity ?? 0) + 1, id: group?.id ?? item.id });
  }
  const capacity = [...equipment].reduce(
    (total, [type, item]) => total + (getCatalogItem(type)?.seats ?? 0) * item.quantity,
    0,
  );
  const roomDesks = children.filter((item) => item.kind === 'desk').length;
  const palette = ['#e9eef9', '#e4efe6', '#ede8f5', '#f5eadb', '#e3eff1', '#f3e5e7'];
  const wallEndpoints = element.kind === 'wall' ? getWallEndpoints(element) : null;

  return (
    <aside className="inspector">
      <div className="inspector-title">
        Свойства объекта <Settings2 size={17} />
      </div>
      <div className="inspector-content">
        <div
          className="property-hero"
          style={{ background: element.kind === 'room' ? element.color : undefined }}
        >
          {catalogItem ? (
            <img
              src={catalogItem.asset}
              alt={catalogItem.name}
              draggable={false}
              style={{ width: '65%', height: 92, objectFit: 'contain' }}
            />
          ) : element.kind === 'room' ? (
            <Building2 size={42} strokeWidth={1.2} />
          ) : (
            <div style={{ width: '65%', height: 13, borderRadius: 2, background: '#536677' }} />
          )}
        </div>
        <div className="property-type">
          {KIND_LABELS[element.kind]}
          {element.locked ? ' · Закреплён' : ''}
        </div>
        <label className="field">
          <span className="field-label">Название</span>
          <input
            className="input"
            aria-label="Название объекта"
            value={element.name}
            maxLength={100}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>

        {element.kind === 'room' && (
          <section className="property-section">
            <div className="section-label">ЦВЕТ ОБЛАСТИ</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {palette.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Цвет области ${color}`}
                  aria-pressed={element.color.toLowerCase() === color}
                  onClick={() => onChange({ color })}
                  style={{
                    width: 25,
                    height: 25,
                    borderRadius: 8,
                    background: color,
                    border:
                      element.color.toLowerCase() === color
                        ? '2px solid #6979ce'
                        : '1px solid #dfe4ec',
                  }}
                />
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <Toggle
                label="Стены по контуру"
                checked={element.walls !== false}
                description="Отключите, если стены уже есть на подложке или нарисованы отдельно"
                onChange={(walls) => onChange({ walls })}
              />
            </div>
          </section>
        )}

        <section className="property-section">
          <div className="section-label">
            {wallEndpoints ? 'КОНЦЫ СТЕНЫ' : 'ПОЛОЖЕНИЕ И РАЗМЕР'}
          </div>
          {wallEndpoints ? (
            <>
              <div className="field-grid">
                <NumberField
                  label="Начало X"
                  value={wallEndpoints[0].x}
                  disabled={element.locked}
                  onChange={(x) =>
                    onChange(
                      wallFromEndpoints(element, { ...wallEndpoints[0], x }, wallEndpoints[1]),
                    )
                  }
                />
                <NumberField
                  label="Начало Y"
                  value={wallEndpoints[0].y}
                  disabled={element.locked}
                  onChange={(y) =>
                    onChange(
                      wallFromEndpoints(element, { ...wallEndpoints[0], y }, wallEndpoints[1]),
                    )
                  }
                />
                <NumberField
                  label="Конец X"
                  value={wallEndpoints[1].x}
                  disabled={element.locked}
                  onChange={(x) =>
                    onChange(
                      wallFromEndpoints(element, wallEndpoints[0], { ...wallEndpoints[1], x }),
                    )
                  }
                />
                <NumberField
                  label="Конец Y"
                  value={wallEndpoints[1].y}
                  disabled={element.locked}
                  onChange={(y) =>
                    onChange(
                      wallFromEndpoints(element, wallEndpoints[0], { ...wallEndpoints[1], y }),
                    )
                  }
                />
              </div>
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.6 }}>
                Длина{' '}
                {Math.round(
                  Math.hypot(
                    wallEndpoints[1].x - wallEndpoints[0].x,
                    wallEndpoints[1].y - wallEndpoints[0].y,
                  ) * 100,
                ) / 100}{' '}
                ед. · Толщина {WALL_THICKNESS} ед.
              </p>
            </>
          ) : (
            <div className="field-grid">
              <NumberField
                label="X"
                value={element.x}
                disabled={element.locked}
                onChange={(x) => onChange({ x })}
              />
              <NumberField
                label="Y"
                value={element.y}
                disabled={element.locked}
                onChange={(y) => onChange({ y })}
              />
              <NumberField
                label="Ширина"
                value={element.width}
                min={1}
                disabled={element.locked}
                onChange={(width) => onChange({ width })}
              />
              <NumberField
                label="Высота"
                value={element.height}
                min={1}
                disabled={element.locked}
                onChange={(height) => onChange({ height })}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
            <NumberField
              label="Поворот, °"
              integer
              value={element.rotation}
              disabled={element.locked}
              onChange={(rotation) => onChange({ rotation: Math.round(rotation) })}
            />
            <button
              className="secondary-button"
              type="button"
              title="Повернуть на 90°"
              aria-label="Повернуть на 90 градусов"
              disabled={element.locked}
              onClick={() => onChange({ rotation: (((element.rotation + 90) % 360) + 360) % 360 })}
              style={{ marginBottom: 1, height: 35 }}
            >
              <RotateCw size={15} />
              90°
            </button>
          </div>
        </section>

        {element.kind !== 'wall' && element.kind !== 'room' && (
          <section className="property-section">
            <label className="field">
              <span className="field-label">Помещение</span>
              <select
                className="input"
                aria-label="Помещение объекта"
                value={element.roomId ?? ''}
                onChange={(event) => onChange({ roomId: event.target.value || undefined })}
              >
                <option value="">Вне помещения</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        {(element.kind === 'room' || element.kind === 'desk') && (
          <section className="property-section">
            <div className="section-label">БРОНИРОВАНИЕ</div>
            <Toggle
              label="Можно забронировать"
              checked={element.bookable ?? true}
              onChange={(bookable) => onChange({ bookable })}
            />
            {element.kind === 'room' && (
              <Toggle
                label="Отдельные рабочие места"
                checked={element.shared ?? false}
                description="Помещение допускает совместное использование"
                onChange={(shared) => onChange({ shared })}
              />
            )}
          </section>
        )}

        {element.kind === 'room' && (
          <section className="property-section">
            <div className="section-label">ОСНАЩЕНИЕ</div>
            <div className="stat-grid">
              <div className="stat-item">
                <Armchair size={16} />
                <b>{capacity}</b>
                <span>посадочных мест</span>
              </div>
              <div className="stat-item">
                <Square size={16} />
                <b>{roomDesks}</b>
                <span>рабочих мест</span>
              </div>
            </div>
            {equipment.size > 0 ? (
              <div className="equipment-list">
                {[...equipment].map(([type, item]) => {
                  const entry = getCatalogItem(type);
                  return (
                    <button
                      type="button"
                      key={type}
                      className="equipment-row"
                      onClick={() => onSelect(item.id)}
                      title="Выбрать предмет на плане"
                    >
                      {entry && (
                        <img
                          src={entry.asset}
                          alt=""
                          style={{ width: 26, height: 24, objectFit: 'contain' }}
                        />
                      )}
                      <span>{entry?.name ?? type}</span>
                      <b>×{item.quantity}</b>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted">
                Добавьте мебель внутрь помещения. Вместимость посчитается по сиденьям.
              </p>
            )}
          </section>
        )}

        {element.kind === 'furniture' && catalogItem?.isSeating && (
          <div className="property-section">
            <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Armchair size={15} />
              Посадочных мест: <b>{catalogItem.seats}</b>
            </p>
          </div>
        )}

        <section className="property-section">
          <Toggle
            label="Закрепить объект"
            checked={element.locked}
            onChange={(locked) => onChange({ locked })}
            description="Защищает положение и размеры от случайного изменения"
          />
          <div className="inspector-actions" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="secondary-button"
              aria-label="На передний план"
              title="На передний план"
              onClick={() => onReorder('front')}
            >
              <ArrowUpToLine size={15} />
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-label="На задний план"
              title="На задний план"
              onClick={() => onReorder('back')}
            >
              <ArrowDownToLine size={15} />
            </button>
            <span
              style={{
                marginLeft: 'auto',
                color: '#96a3b8',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {element.locked ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}
            </span>
          </div>
        </section>
      </div>
      <div
        className="inspector-actions"
        style={{ paddingTop: 16, borderTop: '1px solid #e9edf4', flexShrink: 0 }}
      >
        <button type="button" className="secondary-button" onClick={onDuplicate}>
          <Copy size={15} />
          Дублировать
        </button>
        <button
          type="button"
          className="danger-button"
          aria-label="Удалить объект"
          title="Удалить объект"
          onClick={onDelete}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  );
}
