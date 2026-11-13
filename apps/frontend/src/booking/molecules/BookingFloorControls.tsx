import type { ReactElement } from 'react';
import type { Floor } from '../../office';
import { Button, Styles } from '../../shared/atoms';
export default function BookingFloorControls({
  floors,
  selectedId,
  onSelect,
  disabled = false,
  variant = 'map',
  className = '',
  label = 'Выбор этажа',
}: {
  floors: Floor[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  variant?: 'map' | 'form';
  className?: string;
  label?: string;
}): ReactElement {
  return (
    <>
      <Styles id="booking-floor-controls">{styles}</Styles>
      <div
        className={`${variant === 'map' ? 'bk-floor-switcher' : 'booking-form-floors'} ${className}`}
        role="group"
        aria-label={label}
      >
        {variant === 'map' && <small>ЭТАЖ</small>}
        {floors.map((floor, index) => (
          <Button
            variant="ghost"
            key={floor.id}
            aria-label={variant === 'map' ? 'Показать ' + floor.name : floor.name}
            title={floor.name}
            aria-pressed={selectedId === floor.id}
            className={selectedId === floor.id ? 'is-active' : ''}
            disabled={disabled}
            onClick={() => onSelect(floor.id)}
          >
            {variant === 'map' ? floor.name.match(/^-?\d+/)?.[0] || index + 1 : floor.name}
          </Button>
        ))}
      </div>
    </>
  );
}
const styles = String.raw`
.bk-floor-switcher {
  position: absolute;
  top: 18px;
  right: 19px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 7px;
  background: #ffffffed;
  border: 1px solid #e2e7f1;
  border-radius: 12px;
  box-shadow: 0 5px 20px #43547508;
  max-height: calc(100% - 110px);
  overflow: auto;
  scrollbar-width: thin;
}
.bk-floor-switcher small {
  font-size: 7px;
  text-align: center;
  color: #a5b0c4;
  font-weight: 700;
  letter-spacing: 0.9px;
  margin: 2px 0 3px;
}
.bk-floor-switcher > .ui-button {
  width: 31px;
  height: 31px;
  min-height: 31px;
  min-width: 31px;
  padding: 0;
  border-radius: 7px;
  color: #a1acc0;
  font-size: 11px;
}
.bk-floor-switcher > .ui-button.is-active {
  background: #7a86dc;
  color: #fff;
  border-color: #7a86dc;
  box-shadow: 0 3px 8px #8995df30;
}
.booking-form-floors {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.booking-form-floors > .ui-button {
  font-size: 9px;
  min-height: 32px;
  padding: 6px 9px;
}
.booking-form-floors > .ui-button.is-active {
  border-color: #9aa8e0;
  background: #f0f2fe;
  color: #7d8bcd;
}
@media (max-width: 720px) {
  .bk-floor-switcher {
    top: 12px;
    right: 10px;
    padding: 6px 5px;
    gap: 4px;
  }
  .bk-floor-switcher > .ui-button {
    width: 27px;
    height: 27px;
    min-width: 27px;
    min-height: 27px;
    font-size: 10px;
  }
}
`;
