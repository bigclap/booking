import { Styles } from '../../shared/atoms';
import { IconButton } from '../../shared/atoms';
import {
  Grid2X2,
  Hand,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
export default function PlanToolbar({ editor }: { editor: OfficePlanEditor }) {
  const {
    tool,
    setTool,
    snapEnabled,
    setSnapEnabled,
    grid,
    setGrid,
    camera,
    undoRef,
    redoRef,
    undo,
    redo,
    fit,
    zoomAt,
  } = editor;
  return (
    <>
      <div className="floating-toolbar">
        <IconButton
          title="Выбрать · V"
          aria-label="Инструмент выбора"
          className={tool === 'select' ? 'tool-active' : ''}
          onClick={() => setTool('select')}
          variant="ghost"
          size="sm"
        >
          <MousePointer2 size={18} />
        </IconButton>
        <IconButton
          title="Переместить холст · H / Пробел"
          className={tool === 'pan' ? 'tool-active' : ''}
          onClick={() => setTool('pan')}
          variant="ghost"
          aria-label="Переместить холст · H / Пробел"
          size="sm"
        >
          <Hand size={18} />
        </IconButton>
        <span />
        <IconButton
          title="Отменить · Ctrl Z"
          aria-label="Отменить"
          disabled={!undoRef.current.length}
          onClick={undo}
          variant="ghost"
          size="sm"
        >
          <Undo2 size={17} />
        </IconButton>
        <IconButton
          title="Повторить · Ctrl Shift Z"
          aria-label="Повторить"
          disabled={!redoRef.current.length}
          onClick={redo}
          variant="ghost"
          size="sm"
        >
          <Redo2 size={17} />
        </IconButton>
        <span />
        <IconButton
          title="Привязка к сетке"
          className={snapEnabled ? 'tool-active subtle' : ''}
          onClick={() => setSnapEnabled(!snapEnabled)}
          variant="ghost"
          aria-label="Привязка к сетке"
          size="sm"
        >
          <Magnet size={17} />
        </IconButton>
        <IconButton
          title="Показать сетку"
          className={grid ? 'tool-active subtle' : ''}
          onClick={() => setGrid(!grid)}
          variant="ghost"
          aria-label="Показать сетку"
          size="sm"
        >
          <Grid2X2 size={17} />
        </IconButton>
        <span />
        <IconButton
          title="Уменьшить масштаб"
          aria-label="Уменьшить масштаб"
          onClick={() => zoomAt(0.8)}
          variant="ghost"
          size="sm"
        >
          <Minus size={16} />
        </IconButton>
        <b>{Math.round(camera.zoom * 100)}%</b>
        <IconButton
          title="Увеличить масштаб"
          aria-label="Увеличить масштаб"
          onClick={() => zoomAt(1.25)}
          variant="ghost"
          size="sm"
        >
          <Plus size={16} />
        </IconButton>
        <IconButton
          title="Вписать план"
          aria-label="Вписать план"
          onClick={fit}
          variant="ghost"
          size="sm"
        >
          <Maximize size={17} />
        </IconButton>
      </div>
      <Styles id="office-toolbar">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor .floating-toolbar {
  position: absolute;
  bottom: 55px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  box-shadow: 0 6px 22px #2d3d6512;
  border: 1px solid #e1e6f0;
  border-radius: 12px;
  display: flex;
  align-items: center;
  padding: 5px;
  gap: 4px;
  z-index: 3;
}
.office-plan-editor .floating-toolbar button {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 20px;
}
.office-plan-editor .floating-toolbar .tool-active {
  background: #edf0ff;
  color: #5264de;
}
.office-plan-editor .floating-toolbar span {
  height: 22px;
  width: 1px;
  background: #e8ebf3;
  margin: 0 5px;
}
.office-plan-editor .floating-toolbar b {
  font-size: 10px;
  width: 42px;
  text-align: center;
  font-weight: 600;
}
.office-plan-editor .floating-toolbar {
  bottom: 51px;
  padding: 5px;
  gap: 2px;
  border-radius: 11px;
  box-shadow: 0 6px 18px #364e7010;
}
.office-plan-editor .floating-toolbar button {
  width: 30px;
  height: 31px;
  font-size: 15px;
  color: #92a0b6;
}
.office-plan-editor .floating-toolbar .tool-active {
  color: #6579d6;
  background: #eef2ff;
}
.office-plan-editor .floating-toolbar .tool-active.subtle {
  background: #f4f6fc;
  color: #8597c7;
}
.office-plan-editor .floating-toolbar button:hover:not(:disabled) {
  background: #f1f4fb;
  color: #6078d6;
}
.office-plan-editor .floating-toolbar span {
  margin: 0 4px;
  background: #e9edf5;
  width: 1px;
}
.office-plan-editor .floating-toolbar b {
  width: 38px;
  color: #8e9cb1;
  font-size: 9px;
}
@media (max-width: 1200px) {
  .office-plan-editor .floating-toolbar button {
    width: 26px;
  }
  .office-plan-editor .floating-toolbar span {
    margin: 0 2px;
  }
}
@media (max-width: 760px) {
  .office-plan-editor .floating-toolbar {
    left: 50%;
    gap: 0;
    bottom: 44px;
  }
  .office-plan-editor .floating-toolbar button {
    width: 25px;
    height: 29px;
  }
  .office-plan-editor .floating-toolbar svg {
    width: 14px;
  }
  .office-plan-editor .floating-toolbar b {
    font-size: 8px;
    width: 30px;
  }
  .office-plan-editor .floating-toolbar button[title='Привязка к сетке'],
  .office-plan-editor .floating-toolbar button[title='Показать сетку'] {
    display: none;
  }
}
.office-plan-editor .floating-toolbar .ui-icon-button {
  width: 30px;
  min-width: 30px;
  max-width: 30px;
  flex-basis: 30px;
  height: 30px;
  min-height: 30px;
  max-height: 30px;
}
`;
