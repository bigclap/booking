import PlanGeometryFields from '../molecules/PlanGeometryFields';
import PlanRoomEquipment from '../molecules/PlanRoomEquipment';
import PlanInspectorEmpty from '../molecules/PlanInspectorEmpty';
import Toggle from '../molecules/PlanToggleField';
import { Styles, Input, Button, Select, IconButton } from '../../shared/atoms';
import { Field } from '../../shared/molecules';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Armchair,
  Building2,
  Copy,
  LockKeyhole,
  Settings2,
  Trash2,
  UnlockKeyhole,
} from 'lucide-react';
import type { Floor, PlanElement } from '../lib/officeModel';
import { getCatalogItem } from '../lib/catalog';

export interface InspectorProps {
  element: PlanElement | null;
  floor: Floor;
  onChange: (patch: Partial<PlanElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSelect: (id: string) => void;
  onReorder: (direction: 'front' | 'back') => void;
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
      <>
        <PlanInspectorEmpty rooms={rooms} desks={desks} onSelect={onSelect} />
        <Styles id="office-inspector">{styles}</Styles>
      </>
    );
  const catalogItem = getCatalogItem(element.type);
  const children =
    element.kind === 'room' ? floor.elements.filter((item) => item.roomId === element.id) : [];
  const equipment = new Map<
    string,
    {
      quantity: number;
      id: string;
    }
  >();
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
  return (
    <>
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
          <Field className="plan-property-field" label={<>Название</>}>
            <Input
              aria-label="Название объекта"
              value={element.name}
              maxLength={100}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>

          {element.kind === 'room' && (
            <section className="property-section">
              <div className="section-label">ЦВЕТ ОБЛАСТИ</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {palette.map((color) => (
                  <Button
                    className="plan-color-swatch"
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
                    variant="ghost"
                    size="sm"
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

          <PlanGeometryFields element={element} onChange={onChange} />

          {element.kind !== 'wall' && element.kind !== 'room' && (
            <section className="property-section">
              <Field className="plan-property-field" label={<>Помещение</>}>
                <Select
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
                </Select>
              </Field>
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
            <PlanRoomEquipment
              capacity={capacity}
              roomDesks={roomDesks}
              equipment={equipment}
              onSelect={onSelect}
            />
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
              <IconButton
                type="button"
                aria-label="На передний план"
                title="На передний план"
                onClick={() => onReorder('front')}
                variant="secondary"
                size="sm"
              >
                <ArrowUpToLine size={15} />
              </IconButton>
              <IconButton
                type="button"
                aria-label="На задний план"
                title="На задний план"
                onClick={() => onReorder('back')}
                variant="secondary"
                size="sm"
              >
                <ArrowDownToLine size={15} />
              </IconButton>
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
          <Button type="button" onClick={onDuplicate} variant="secondary" size="sm">
            <Copy size={15} />
            Дублировать
          </Button>
          <IconButton
            type="button"
            aria-label="Удалить объект"
            title="Удалить объект"
            onClick={onDelete}
            variant="danger"
            size="sm"
          >
            <Trash2 size={16} />
          </IconButton>
        </div>
      </aside>
      <Styles id="office-inspector">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor .inspector {
  width: 274px;
  flex-shrink: 0;
  background: #fff;
  border-left: 1px solid #e7eaf1;
  padding: 25px 20px;
  display: flex;
  flex-direction: column;
}
.office-plan-editor .inspector-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 750;
}
.office-plan-editor .inspector-title svg {
  color: #97a3b9;
}
.office-plan-editor .inspector-empty {
  text-align: center;
  margin-top: 80px;
}
.office-plan-editor .inspector-empty > div {
  width: 50px;
  height: 50px;
  border-radius: 16px;
  background: #f4f6fc;
  color: #9daac3;
  display: grid;
  place-items: center;
  margin: auto;
}
.office-plan-editor .inspector-empty h3 {
  font-size: 12px;
  margin-top: 18px;
}
.office-plan-editor .inspector-empty p {
  font-size: 10px;
  line-height: 1.9;
  color: #9ca6b8;
}
.office-plan-editor .inspector-note {
  margin-top: auto;
  display: flex;
  gap: 12px;
  border-radius: 12px;
  background: #f6f8fc;
  padding: 14px;
}
.office-plan-editor .inspector-note > span {
  font-size: 11px;
  color: #7c8ca6;
  font-weight: 800;
}
.office-plan-editor .inspector-note b {
  font-size: 10px;
}
.office-plan-editor .inspector-note p {
  font-size: 9px;
  line-height: 1.8;
  color: #97a4b9;
  margin-bottom: 0;
}
@media (max-width: 1100px) {
  .office-plan-editor .inspector {
    width: 240px;
  }
}
@media (max-width: 850px) {
  .office-plan-editor .inspector {
    display: none;
  }
}
.office-plan-editor .inspector {
  padding: 23px 19px 18px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #dfe5f1 transparent;
}
.office-plan-editor .inspector-title {
  font-size: 11px;
  letter-spacing: -0.1px;
  flex-shrink: 0;
  padding-bottom: 19px;
  border-bottom: 1px solid #edf0f6;
}
.office-plan-editor .inspector-content {
  min-height: 0;
  flex: 1;
}
.office-plan-editor .property-hero {
  height: 114px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f9faff, #f0f3fa);
  border: 1px solid #e7ecf5;
  border-radius: 11px;
  margin: 18px 0 10px;
  position: relative;
  overflow: hidden;
}
.office-plan-editor .property-hero img {
  width: 130px;
  height: 85px;
  object-fit: contain;
  filter: drop-shadow(0 6px 5px #60759f15);
}
.office-plan-editor .property-hero > svg {
  color: #93a4c4;
}
.office-plan-editor .property-type {
  text-transform: uppercase;
  font-size: 8px;
  color: #9aa8bf;
  letter-spacing: 1px;
  margin: 11px 0 16px;
  display: block;
  font-weight: 700;
}
.office-plan-editor .property-section {
  padding-top: 17px;
  margin-top: 13px;
  border-top: 1px solid #eaf0f7;
}
.office-plan-editor .section-label {
  font-size: 8px;
  color: #97a5bb;
  font-weight: 800;
  letter-spacing: 1.1px;
  margin-bottom: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.office-plan-editor .section-label button {
  font-size: 8px;
  color: #8b9dcc;
  letter-spacing: 0;
}
.office-plan-editor .toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 13px 0;
  color: #8493ac;
  font-size: 10px;
  line-height: 1.5;
}
.office-plan-editor .inspector-actions {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 17px;
}
.office-plan-editor .inspector-actions button {
  font-size: 9px;
  padding: 8px 10px;
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  flex: 1;
  border-radius: 7px;
  white-space: nowrap;
}
.office-plan-editor .equipment-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.office-plan-editor .equipment-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 9px;
  color: #8a9bb3;
  min-height: 26px;
}
.office-plan-editor .equipment-row img {
  width: 25px;
  height: 24px;
  object-fit: contain;
}
.office-plan-editor .equipment-row span:last-child {
  margin-left: auto;
  color: #9dacbf;
}
.office-plan-editor .equipment-row button {
  padding: 0;
  color: #8397c0;
}
.office-plan-editor .stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 18px 0;
}
.office-plan-editor .stat-item {
  padding: 13px 10px;
  border-radius: 8px;
  background: #f5f7fc;
  color: #95a4bb;
  font-size: 9px;
  text-align: center;
}
.office-plan-editor .stat-item b {
  display: block;
  font-size: 20px;
  color: #7e91af;
  margin-bottom: 6px;
}
.office-plan-editor .inspector .color-palette {
  display: flex;
  gap: 7px;
  margin: 8px 0;
}
@media (min-width: 1500px) {
  .office-plan-editor .inspector {
    width: 290px;
  }
}
@media (max-width: 1200px) {
  .office-plan-editor .inspector {
    width: 240px;
    padding-left: 14px;
    padding-right: 14px;
  }
}
@media (max-width: 950px) {
  .office-plan-editor .inspector {
    width: 210px;
    padding-left: 12px;
    padding-right: 12px;
  }
}
@media (max-width: 760px) {
  .office-plan-editor .inspector {
    position: absolute;
    right: 0;
    top: 145px;
    bottom: 50px;
    z-index: 8;
    width: 210px;
    border: 1px solid #e3e9f5;
    border-radius: 12px 0 0 12px;
    box-shadow: -6px 3px 20px #4a668910;
  }
  .office-plan-editor .inspector:has(.inspector-empty) {
    display: none;
  }
}
.office-plan-editor .toggle-row {
  font-size: 11px;
  color: #7388a5;
}
.office-plan-editor .equipment-row {
  font-size: 10px;
  color: #7c91ae;
}
.office-plan-editor .stat-item {
  color: #8297b3;
}
.office-plan-editor .inspector {
  overflow: hidden;
}
.office-plan-editor .inspector-content {
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #dfe5f1 transparent;
  padding-right: 2px;
}
.office-plan-editor .inspector > .inspector-actions {
  background: #fff;
  margin-top: 0;
}
`;
