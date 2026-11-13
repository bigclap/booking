import type { ReactElement } from 'react';
import { Button } from '../../shared/atoms';
import { RotateCw } from 'lucide-react';
import type { PlanElement } from '../lib/officeModel';
import { getWallEndpoints, wallFromEndpoints } from '../lib/wallEditorGeometry';
import { WALL_THICKNESS } from '../lib/wallGeometry';
import NumberField from './PlanNumberField';

export default function PlanGeometryFields({
  element,
  onChange,
}: {
  element: PlanElement;
  onChange: (patch: Partial<PlanElement>) => void;
}): ReactElement {
  const wallEndpoints = element.kind === 'wall' ? getWallEndpoints(element) : null;
  return (
    <section className="property-section">
      <div className="section-label">{wallEndpoints ? 'КОНЦЫ СТЕНЫ' : 'ПОЛОЖЕНИЕ И РАЗМЕР'}</div>
      {wallEndpoints ? (
        <>
          <div className="ui-field-grid">
            <NumberField
              label="Начало X"
              value={wallEndpoints[0].x}
              disabled={element.locked}
              onChange={(x) =>
                onChange(wallFromEndpoints(element, { ...wallEndpoints[0], x }, wallEndpoints[1]))
              }
            />
            <NumberField
              label="Начало Y"
              value={wallEndpoints[0].y}
              disabled={element.locked}
              onChange={(y) =>
                onChange(wallFromEndpoints(element, { ...wallEndpoints[0], y }, wallEndpoints[1]))
              }
            />
            <NumberField
              label="Конец X"
              value={wallEndpoints[1].x}
              disabled={element.locked}
              onChange={(x) =>
                onChange(wallFromEndpoints(element, wallEndpoints[0], { ...wallEndpoints[1], x }))
              }
            />
            <NumberField
              label="Конец Y"
              value={wallEndpoints[1].y}
              disabled={element.locked}
              onChange={(y) =>
                onChange(wallFromEndpoints(element, wallEndpoints[0], { ...wallEndpoints[1], y }))
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
        <div className="ui-field-grid">
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
        <Button
          type="button"
          title="Повернуть на 90°"
          aria-label="Повернуть на 90 градусов"
          disabled={element.locked}
          onClick={() => onChange({ rotation: (((element.rotation + 90) % 360) + 360) % 360 })}
          style={{ marginBottom: 1, height: 35 }}
          variant="secondary"
          size="sm"
        >
          <RotateCw size={15} />
          90°
        </Button>
      </div>
    </section>
  );
}
