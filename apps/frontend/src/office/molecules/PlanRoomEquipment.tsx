import type { ReactElement } from 'react';
import { Button } from '../../shared/atoms';
import { Armchair, Square } from 'lucide-react';
import { getCatalogItem } from '../lib/catalog';

export default function PlanRoomEquipment({
  capacity,
  roomDesks,
  equipment,
  onSelect,
}: {
  capacity: number;
  roomDesks: number;
  equipment: Map<string, { quantity: number; id: string }>;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
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
              <Button
                type="button"
                key={type}
                className="equipment-row"
                onClick={() => onSelect(item.id)}
                title="Выбрать предмет на плане"
                variant="ghost"
                size="sm"
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
              </Button>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          Добавьте мебель внутрь помещения. Вместимость посчитается по сиденьям.
        </p>
      )}
    </section>
  );
}
