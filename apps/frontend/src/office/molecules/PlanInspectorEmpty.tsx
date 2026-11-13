import type { ReactElement } from 'react';
import { Button } from '../../shared/atoms';
import { Armchair, Building2, DoorOpen, MousePointer2, Settings2 } from 'lucide-react';
import type { PlanElement } from '../lib/officeModel';

export default function PlanInspectorEmpty({
  rooms,
  desks,
  onSelect,
}: {
  rooms: PlanElement[];
  desks: PlanElement[];
  onSelect: (id: string) => void;
}): ReactElement {
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
                <Button
                  key={room.id}
                  type="button"
                  className="equipment-row"
                  onClick={() => onSelect(room.id)}
                  variant="ghost"
                  size="sm"
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
                </Button>
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
}
