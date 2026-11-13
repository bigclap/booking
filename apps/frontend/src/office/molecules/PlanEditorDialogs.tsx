import { Styles } from '../../shared/atoms';
import { Check, Trash2 } from 'lucide-react';
import { Button, Input } from '../../shared/atoms';
import { Dialog, Field } from '../../shared/molecules';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
const SHORTCUTS = [
  ['V', 'Выбрать объект'],
  ['H / Пробел', 'Перемещение холста'],
  ['W', 'Нарисовать стену'],
  ['R', 'Помещение / поворот объекта'],
  ['Delete', 'Удалить выбранное'],
  ['Ctrl D', 'Дублировать'],
  ['Ctrl Z', 'Отменить'],
  ['Ctrl Shift Z', 'Повторить'],
  ['Esc', 'Завершить действие'],
] as const;
export default function PlanEditorDialogs({ editor }: { editor: OfficePlanEditor }) {
  const {
    settings,
    help,
    setSettings,
    setHelp,
    setUnderlayOpen,
    floor,
    config,
    changeFloor,
    removeFloor,
  } = editor;
  const close = () => {
    setSettings(false);
    setHelp(false);
    setUnderlayOpen(false);
  };
  return (
    <>
      <Dialog
        open={settings || help}
        onClose={close}
        title={help ? 'Каждому действию — свой жест' : 'Настройки этажа'}
        eyebrow={help ? 'БЫСТРЕЕ С КЛАВИАТУРОЙ' : 'ПЛАН ОФИСА'}
        className="office-plan-dialog"
        bodyClassName="office-plan-dialog-body"
        footer={
          !help && (
            <>
              <Button variant="danger" disabled={config.floors.length < 2} onClick={removeFloor}>
                <Trash2 size={14} />
                Удалить этот этаж
              </Button>
              <Button variant="primary" onClick={() => setSettings(false)}>
                <Check size={16} />
                Готово
              </Button>
            </>
          )
        }
      >
        {help ? (
          <div className="shortcut-list">
            {SHORTCUTS.map(([key, label]) => (
              <div key={key}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        ) : (
          <div className="ui-field-grid">
            <Field label="Название этажа">
              <Input
                value={floor.name}
                onChange={(event) =>
                  changeFloor((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>
            <Field label="Размер плана">
              <span className="office-plan-dimensions">
                {floor.width} × {floor.height}
              </span>
            </Field>
          </div>
        )}
      </Dialog>
      <Styles id="office-dialogs">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor .shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 28px;
}
.office-plan-editor .shortcut-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #8c9bb2;
  font-size: 11px;
}
.office-plan-editor .shortcut-list kbd {
  font-size: 9px;
  color: #91a1bc;
  border: 1px solid #e1e7f1;
  background: #f7f9fd;
  padding: 5px 8px;
  border-radius: 5px;
}
`;
