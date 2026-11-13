import { Styles } from '../../shared/atoms';
import { Button, IconButton } from '../../shared/atoms';
import { Plus } from 'lucide-react';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
export default function PlanFloorSwitcher({ editor }: { editor: OfficePlanEditor }) {
  const { config, floor, selectFloor, addFloor } = editor;
  return (
    <>
      <div className="floor-switcher" role="group" aria-label="Этажи">
        <div className="floor-switcher-label">ЭТАЖ</div>
        <div className="floor-buttons">
          {config.floors.map((item, index) => (
            <Button
              key={item.id}
              type="button"
              className={'floor-button' + (item.id === floor.id ? ' is-active' : '')}
              title={item.name}
              aria-label={'Перейти на ' + item.name}
              aria-pressed={item.id === floor.id}
              onClick={() => selectFloor(item.id)}
              variant="ghost"
              size="sm"
            >
              {item.name.match(/^-?\d+/)?.[0] || index + 1}
            </Button>
          ))}
        </div>
        <IconButton
          type="button"
          className="floor-add"
          title={config.floors.length >= 40 ? 'Добавлено 40 этажей' : 'Добавить этаж'}
          aria-label="Добавить этаж"
          disabled={config.floors.length >= 40}
          onClick={addFloor}
          variant="ghost"
          size="sm"
        >
          <Plus size={17} />
        </IconButton>
      </div>
      <Styles id="office-floors">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor .floor-switcher {
  position: absolute;
  z-index: 5;
  right: 18px;
  top: 16px;
  width: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 9px 5px 5px;
  gap: 6px;
  border: 1px solid #e1e7f2;
  border-radius: 12px;
  background: #fffffff0;
  backdrop-filter: blur(12px);
  box-shadow: 0 5px 20px #455e8310;
  cursor: default;
}
.office-plan-editor .floor-switcher-label {
  font-size: 7px;
  letter-spacing: 1px;
  font-weight: 800;
  color: #98a6bb;
  line-height: 1;
  margin: 1px 0 3px;
}
.office-plan-editor .floor-buttons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: min(40vh, 280px);
  overflow-y: auto;
  scrollbar-width: thin;
  width: 100%;
}
.office-plan-editor .floor-button,
.office-plan-editor .floor-add {
  width: 34px;
  height: 34px;
  min-height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 750;
  color: #8b9bb5;
  transition:
    background 0.15s,
    color 0.15s,
    box-shadow 0.15s;
}
.office-plan-editor .floor-button:hover {
  background: #f0f3fb;
  color: #667cbd;
}
.office-plan-editor .floor-button.is-active {
  background: #6379e1;
  color: #fff;
  box-shadow: 0 3px 8px #6379e12b;
}
.office-plan-editor .floor-add {
  border-top: 1px solid #e9edf5;
  border-radius: 0 0 7px 7px;
  color: #8a9ebf;
  padding-top: 2px;
}
.office-plan-editor .floor-add:hover:not(:disabled) {
  background: #eef2ff;
  color: #6179d7;
}
.office-plan-editor .floor-add:disabled {
  opacity: 0.3;
}
.office-plan-editor .floor-button[aria-pressed='true']:focus-visible {
  outline-color: #8999e4;
}
@media (max-width: 760px) {
  .office-plan-editor .floor-switcher {
    right: 10px;
    top: 10px;
    width: 42px;
    padding: 8px 4px 4px;
    gap: 5px;
  }
  .office-plan-editor .floor-button,
  .office-plan-editor .floor-add {
    width: 32px;
    height: 32px;
    min-height: 32px;
  }
}
`;
