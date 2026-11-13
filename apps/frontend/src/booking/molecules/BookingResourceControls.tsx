import type { ReactElement } from 'react';
import { Armchair, DoorOpen, Grid2X2 } from 'lucide-react';
import type { ResourceFilter } from '../types';
import { Button, Styles } from '../../shared/atoms';
export default function BookingResourceControls({
  value,
  onChange,
}: {
  value: ResourceFilter;
  onChange: (value: ResourceFilter) => void;
}): ReactElement {
  return (
    <>
      <Styles id="booking-resource-controls">{styles}</Styles>
      <div className="bk-resource-tabs" role="group" aria-label="Тип ресурса">
        {(
          [
            ['all', 'Все пространства'],
            ['desk', 'Рабочие места'],
            ['room', 'Помещения'],
          ] as const
        ).map(([key, label]) => (
          <Button
            variant="ghost"
            key={key}
            aria-pressed={value === key}
            className={value === key ? 'is-active' : ''}
            onClick={() => onChange(key)}
          >
            {key === 'desk' ? (
              <Armchair size={14} />
            ) : key === 'room' ? (
              <DoorOpen size={14} />
            ) : (
              <Grid2X2 size={14} />
            )}
            <span>{label}</span>
          </Button>
        ))}
      </div>
    </>
  );
}
const styles = String.raw`
.bk-resource-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  background: #f4f6fb;
  padding: 4px;
  border-radius: 8px;
}
.bk-resource-tabs > .ui-button {
  min-height: 30px;
  gap: 7px;
  padding: 6px 10px;
  font-size: 9px;
  color: #8f9cb3;
  border-radius: 5px;
}
.bk-resource-tabs > .ui-button.is-active {
  background: #fff;
  color: #7c88ca;
  box-shadow: 0 2px 6px #7184ab0e;
}
@media (max-width: 720px) {
  .bk-resource-tabs {
    gap: 1px;
    padding: 2px;
    width: 100%;
    justify-content: space-between;
  }
  .bk-resource-tabs > .ui-button {
    flex: 1;
    justify-content: center;
    font-size: 9px;
    gap: 4px;
    padding: 6px 7px;
  }
  .bk-resource-tabs > .ui-button > svg {
    width: 12px;
    height: 12px;
  }
}
`;
