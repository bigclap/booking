import { Styles } from '../../shared/atoms';
import { IconButton, Button } from '../../shared/atoms';
import { Check, Copy, ImagePlus, Settings2, Trash2, Upload, X, RotateCw } from 'lucide-react';
import UnderlayPanel from '../molecules/UnderlayPanel';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
import PlanScene from './PlanScene';
import PlanFloorSwitcher from '../molecules/PlanFloorSwitcher';
import PlanToolbar from '../molecules/PlanToolbar';
import PlanFooter from '../molecules/PlanFooter';
export default function PlanCanvas({ editor }: { editor: OfficePlanEditor }) {
  const {
    floor,
    setSelectedId,
    selected,
    underlayEditing,
    setUnderlayEditing,
    tool,
    setTool,
    setGrid,
    preview,
    setPreview,
    setSettings,
    underlayOpen,
    setUnderlayOpen,
    spacePressed,
    viewportRef,
    uploadRef,
    roomCount,
    deskCount,
    changeFloor,
    removeSelected,
    duplicateSelected,
    updateSelected,
    actionTitle,
  } = editor;
  return (
    <>
      <main className="canvas-area">
        <div className="canvas-heading">
          <div>
            <h2>
              {floor.name}
              <span>{preview ? 'Предпросмотр' : 'Редактирование плана'}</span>
            </h2>
            <p>
              {roomCount} помещения <i>·</i> {deskCount} рабочих мест <i>·</i>{' '}
              {floor.elements.length} объектов
            </p>
          </div>
          <div className="canvas-heading-actions">
            <IconButton
              title="Настройки этажа"
              onClick={() => setSettings(true)}
              variant="ghost"
              aria-label="Настройки этажа"
              size="sm"
            >
              <Settings2 size={16} />
            </IconButton>
            <Button
              className={'' + (underlayOpen ? ' active' : '')}
              aria-expanded={underlayOpen}
              onClick={() => setUnderlayOpen(!underlayOpen)}
              variant="secondary"
              size="sm"
            >
              <ImagePlus size={15} />
              Подложка
            </Button>
          </div>
        </div>
        {underlayOpen && (
          <UnderlayPanel
            key={floor.id}
            floor={floor}
            onChange={(patch) => {
              if (patch.visible === false) setUnderlayEditing(false);
              changeFloor((current) =>
                current.background
                  ? { ...current, background: { ...current.background, ...patch } }
                  : current,
              );
            }}
            onUpload={() => uploadRef.current?.click()}
            onRemove={() => {
              setUnderlayEditing(false);
              changeFloor((current) => ({ ...current, background: undefined }));
            }}
            onClose={() => setUnderlayOpen(false)}
            onEdit={() => {
              setTool('select');
              setSelectedId(null);
              setPreview(false);
              setUnderlayEditing(true);
              setGrid(true);
              setUnderlayOpen(false);
            }}
          />
        )}
        <div
          className={
            'editor-viewport ' +
            (tool === 'pan' || spacePressed
              ? 'cursor-pan'
              : tool === 'select'
                ? ''
                : 'cursor-place')
          }
          ref={viewportRef}
        >
          <PlanFloorSwitcher editor={editor} />
          <PlanScene editor={editor} />
          {!floor.elements.length && !floor.background && (
            <div className="empty-floor">
              <div>
                <ImagePlus size={28} />
              </div>
              <h3>Здесь будет ваш офис</h3>
              <p>
                Загрузите план этажа или начните с помещения.
                <br />
                Объекты можно добавлять из каталога слева.
              </p>
              <Button onClick={() => uploadRef.current?.click()} variant="primary" size="sm">
                <Upload size={16} />
                Загрузить план
              </Button>
            </div>
          )}
          {underlayEditing ? (
            <div className="underlay-edit-toolbar">
              <div>
                <ImagePlus size={15} />
                <span>
                  <b>Редактирование подложки</b>
                  <small>Сравните масштаб со стулом · Тяните за углы</small>
                </span>
              </div>
              <Button onClick={() => setUnderlayEditing(false)} variant="ghost" size="sm">
                <Check size={15} />
                Готово
              </Button>
            </div>
          ) : (
            <div className="canvas-mode-badge">
              <span />
              {preview ? 'Предпросмотр пространства' : actionTitle}
              {tool.startsWith('asset:') && (
                <Button onClick={() => setTool('select')} variant="ghost" size="sm">
                  Esc <X size={12} />
                </Button>
              )}
            </div>
          )}
          {!preview && selected && (
            <div className="selection-actions">
              <IconButton
                title="Дублировать · Ctrl D"
                onClick={duplicateSelected}
                variant="ghost"
                aria-label="Дублировать · Ctrl D"
                size="sm"
              >
                <Copy size={15} />
              </IconButton>
              <IconButton
                title="Повернуть · R"
                disabled={selected.locked}
                onClick={() => updateSelected({ rotation: (selected.rotation + 90) % 360 })}
                variant="ghost"
                aria-label="Повернуть · R"
                size="sm"
              >
                <RotateCw size={15} />
              </IconButton>
              <IconButton
                title="Удалить · Delete"
                disabled={selected.locked}
                onClick={removeSelected}
                variant="ghost"
                aria-label="Удалить · Delete"
                size="sm"
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          )}
        </div>
        <PlanToolbar editor={editor} />
        <PlanFooter editor={editor} />
      </main>
      <Styles id="office-canvas">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor .canvas-area {
  flex: 1;
  min-width: 0;
  position: relative;
  background: #f4f6fb;
  display: flex;
  flex-direction: column;
}
.office-plan-editor .canvas-heading {
  height: 91px;
  padding: 21px 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 1;
}
.office-plan-editor .canvas-heading h2 {
  font-size: 16px;
  letter-spacing: -0.4px;
  margin: 0;
  display: flex;
  gap: 12px;
  align-items: center;
}
.office-plan-editor .canvas-heading h2 span {
  font-size: 9px;
  letter-spacing: 0;
  background: #e9edf8;
  color: #8490a8;
  border-radius: 5px;
  padding: 4px 7px;
  font-weight: 600;
}
.office-plan-editor .canvas-heading p {
  font-size: 10px;
  color: #9ca6b8;
  margin-top: 6px;
}
@media (max-width: 850px) {
  .office-plan-editor .canvas-heading {
    padding: 20px;
  }
}
.office-plan-editor .canvas-area {
  overflow: hidden;
}
.office-plan-editor .canvas-heading {
  height: 83px;
  flex-shrink: 0;
  padding: 19px 25px;
  border-bottom: 1px solid #e8ecf4;
  background: #f7f9fc;
}
.office-plan-editor .canvas-heading h2 {
  font-size: 15px;
}
.office-plan-editor .canvas-heading h2 > span {
  font-size: 8px;
  font-weight: 600;
  background: #edf0f8;
}
.office-plan-editor .canvas-heading p {
  font-size: 9px;
  margin: 7px 0 0;
  color: #9da9bc;
}
.office-plan-editor .canvas-heading p i {
  font-style: normal;
  padding: 0 6px;
  color: #c0cad9;
}
.office-plan-editor .canvas-heading-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.office-plan-editor .editor-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
}
.office-plan-editor .editor-svg {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
}
.office-plan-editor .plan-object {
  cursor: move;
}
.office-plan-editor .room-object {
  cursor: pointer;
}
.office-plan-editor .object-locked {
  cursor: not-allowed;
}
.office-plan-editor .wall-hit {
  cursor: move;
}
.office-plan-editor .cursor-pan,
.office-plan-editor .cursor-pan * {
  cursor: grab !important;
}
.office-plan-editor .cursor-pan:active,
.office-plan-editor .cursor-pan:active * {
  cursor: grabbing !important;
}
.office-plan-editor .cursor-place,
.office-plan-editor .cursor-place .editor-svg,
.office-plan-editor .cursor-place .plan-object {
  cursor: crosshair !important;
}
.office-plan-editor .selection-bounds {
  pointer-events: none;
}
.office-plan-editor .selection-bounds [data-handle] {
  pointer-events: all;
}
.office-plan-editor .resize-handle {
  cursor: nwse-resize;
}
.office-plan-editor .rotate-handle {
  cursor: grab;
}
.office-plan-editor .canvas-mode-badge {
  position: absolute;
  top: 15px;
  left: 19px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #e4e9f2;
  background: #ffffffeb;
  backdrop-filter: blur(12px);
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 9px;
  color: #8c9ab1;
  pointer-events: none;
  box-shadow: 0 3px 7px #61789b04;
}
.office-plan-editor .canvas-mode-badge > span {
  width: 5px;
  height: 5px;
  background: #8ea6df;
  border-radius: 50%;
}
.office-plan-editor .canvas-mode-badge button {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 8px;
  color: #9aa7ba;
  padding: 0 0 0 6px;
  border-left: 1px solid #e1e6f0;
}
.office-plan-editor .selection-actions {
  position: absolute;
  bottom: 89px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 3px;
  background: #fff;
  border: 1px solid #e4e9f3;
  border-radius: 9px;
  padding: 3px;
  box-shadow: 0 5px 15px #3c52720d;
}
.office-plan-editor .selection-actions button {
  width: 29px;
  height: 29px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: #8593aa;
}
.office-plan-editor .selection-actions button:hover {
  background: #eff3fb;
  color: #5e73ce;
}
.office-plan-editor.is-preview .plan-object {
  cursor: default;
}
.office-plan-editor .empty-floor {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}
.office-plan-editor .empty-floor > div {
  background: #edf1fc;
  border: 1px solid #e0e7f7;
  color: #8b9bd1;
  width: 68px;
  height: 68px;
  border-radius: 19px;
  display: grid;
  place-items: center;
  margin: auto;
}
.office-plan-editor .empty-floor h3 {
  font-size: 18px;
  letter-spacing: -0.5px;
  margin: 20px 0 12px;
  color: #687c9b;
}
.office-plan-editor .empty-floor p {
  font-size: 10px;
  line-height: 1.9;
  color: #a0aec2;
}
.office-plan-editor .empty-floor button {
  pointer-events: auto;
  margin: 22px auto;
}
.office-plan-editor .editor-svg:focus {
  outline: 0;
}
@media (max-width: 1200px) {
  .office-plan-editor .canvas-heading {
    padding: 19px;
  }
  .office-plan-editor .canvas-heading h2 span {
    display: none;
  }
}
@media (max-width: 950px) {
  .office-plan-editor .canvas-heading {
    padding: 16px;
  }
  .office-plan-editor .canvas-heading p {
    font-size: 8px;
  }
}
@media (max-width: 760px) {
  .office-plan-editor .canvas-heading {
    height: 72px;
    padding: 14px;
  }
  .office-plan-editor .canvas-heading h2 {
    font-size: 13px;
  }
  .office-plan-editor .canvas-heading p {
    font-size: 7px;
  }
  .office-plan-editor .canvas-mode-badge {
    font-size: 7px;
    top: 11px;
    left: 11px;
    padding: 6px;
  }
  .office-plan-editor .canvas-heading p i {
    padding: 0 2px;
  }
  .office-plan-editor .empty-floor {
    width: 90%;
  }
  .office-plan-editor .empty-floor h3 {
    font-size: 15px;
  }
  .office-plan-editor .empty-floor p {
    font-size: 9px;
  }
}
.office-plan-editor .canvas-heading p {
  color: #899db8;
}
.office-plan-editor .canvas-area {
  position: relative;
}
.office-plan-editor .underlay-move-target {
  cursor: move;
}
.office-plan-editor .underlay-edit-toolbar {
  position: absolute;
  top: 14px;
  left: 16px;
  right: 80px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid #dce2f5;
  border-radius: 9px;
  background: #ffffffed;
  box-shadow: 0 3px 16px #3045660b;
  z-index: 4;
}
.office-plan-editor .underlay-edit-toolbar > div {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #7d8bcf;
}
.office-plan-editor .underlay-edit-toolbar b {
  display: block;
  font-size: 11px;
  color: #586b8c;
}
.office-plan-editor .underlay-edit-toolbar small {
  display: block;
  font-size: 9px;
  color: #98a4b7;
  margin-top: 4px;
}
.office-plan-editor .underlay-edit-toolbar button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #7c8bdd;
  color: white;
  font-size: 11px;
}

.office-plan-editor .wall-endpoint-handle {
  cursor: crosshair;
}
.office-plan-editor .wall-hit {
  cursor: move;
}

.office-plan-editor .scale-chair {
  cursor: grab;
  touch-action: none;
}
.office-plan-editor .scale-chair:active {
  cursor: grabbing;
}
`;
