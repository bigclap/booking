import { Styles } from '../../shared/atoms';
import { GRID_STEP } from '../lib/grid';
import { round } from '../lib/planEditing';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
export default function PlanFooter({ editor }: { editor: OfficePlanEditor }) {
  const { grid, preview, camera, cursor, gridStep } = editor;
  return (
    <>
      <div className="canvas-footer">
        <span>
          <i />
          {preview ? 'Предпросмотр' : 'Режим конструктора'}
        </span>
        <span>
          {cursor
            ? Math.round(cursor.x) + ', ' + Math.round(cursor.y)
            : 'Привязка ' + GRID_STEP + ' ед.'}
          <em>·</em>
          {grid ? 'Линии ' + gridStep + ' ед.' : 'Сетка скрыта'}
        </span>
        <span>1:{round(1 / camera.zoom)}</span>
      </div>
      <Styles id="office-footer">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor .canvas-footer {
  height: 35px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  font-size: 9px;
  color: #9aa5b7;
  border-top: 1px solid #e7ebf4;
}
.office-plan-editor .canvas-footer span:first-child {
  display: flex;
  gap: 6px;
  align-items: center;
}
.office-plan-editor .canvas-footer i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #85bda3;
}
.office-plan-editor .canvas-footer {
  flex-shrink: 0;
  font-size: 8px;
  height: 31px;
  background: #f8faff;
  padding: 0 18px;
}
.office-plan-editor .canvas-footer em {
  font-style: normal;
  padding: 0 8px;
  color: #c4cddd;
}
@media (max-width: 760px) {
  .office-plan-editor .canvas-footer {
    font-size: 6px;
    padding: 0 9px;
  }
}
`;
