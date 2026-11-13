import { Styles } from '../../shared/atoms';
import { CheckCheck } from 'lucide-react';
import Inspector from '../organisms/PlanInspector';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
import PlanLibrary from './PlanLibrary';
import PlanCanvas from './PlanCanvas';
import PlanRecoveryNotice from '../molecules/PlanRecoveryNotice';
import PlanEditorDialogs from '../molecules/PlanEditorDialogs';
export default function OfficePlanEditor({ editor }: { editor: OfficePlanEditor }) {
  const {
    recovery,
    floor,
    setSelectedId,
    selected,
    preview,
    toast,
    uploadRef,
    changeFloor,
    removeSelected,
    duplicateSelected,
    updateSelected,
    loadBackground,
  } = editor;
  return (
    <>
      <div
        className={'office-plan-editor app-shell admin-plan-shell' + (preview ? ' is-preview' : '')}
      >
        <PlanRecoveryNotice editor={editor} />
        <div className="workspace" inert={!!recovery}>
          <PlanLibrary editor={editor} />
          <PlanCanvas editor={editor} />
          {!preview && (
            <Inspector
              element={selected}
              floor={floor}
              onChange={updateSelected}
              onDelete={removeSelected}
              onDuplicate={duplicateSelected}
              onSelect={setSelectedId}
              onReorder={(direction) => {
                if (!selected) return;
                changeFloor((current) => ({
                  ...current,
                  elements:
                    direction === 'front'
                      ? [...current.elements.filter((item) => item.id !== selected.id), selected]
                      : [selected, ...current.elements.filter((item) => item.id !== selected.id)],
                }));
              }}
            />
          )}
        </div>
        <input
          ref={uploadRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => void loadBackground(event.target.files?.[0])}
        />
        {toast && (
          <div className="toast" role="status">
            <CheckCheck size={17} />
            {toast}
          </div>
        )}
        <PlanEditorDialogs editor={editor} />
      </div>
      <Styles id="office-editor">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-plan-editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.office-plan-editor .workspace {
  display: flex;
  height: 100%;
}
.office-plan-editor .muted {
  color: #a2adc0;
  font-size: 9px;
  line-height: 1.7;
}
.office-plan-editor .toast {
  position: fixed;
  bottom: 23px;
  left: 50%;
  transform: translateX(-50%);
  background: #35445c;
  color: #f0f3fb;
  border-radius: 10px;
  padding: 13px 18px;
  box-shadow: 0 8px 30px #172b492a;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 40;
  max-width: calc(100vw - 40px);
  animation: office-plan-toast-in 0.2s ease-out;
}
.office-plan-editor .toast svg {
  color: #a6bedf;
  flex-shrink: 0;
}
@keyframes office-plan-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
@media (max-width: 760px) {
  .office-plan-editor .workspace {
    height: 100%;
  }
}
.office-plan-editor .muted {
  color: #8598b2;
}
.office-plan-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.office-plan-editor > .workspace {
  flex: 1;
  min-height: 0;
}
.office-plan-editor .recovery-banner {
  position: absolute;
  left: 14px;
  right: 14px;
  top: 9px;
  z-index: 95;
  flex-wrap: wrap;
}
.office-plan-editor .recovery-banner .ui-notice-content {
  display: grid;
  gap: 5px;
}
.office-plan-editor .recovery-banner .ui-notice-actions {
  flex-wrap: wrap;
}
.office-plan-editor .ui-field-grid {
  margin-bottom: 12px;
}
.office-plan-editor .plan-property-field {
  margin-bottom: 12px;
}
.office-plan-editor .plan-color-swatch {
  min-width: 25px;
  min-height: 25px;
  padding: 0;
}
.office-plan-dialog .office-plan-dimensions {
  display: flex;
  align-items: center;
  min-height: 39px;
  color: #94a1b7;
  font-size: 11px;
}
`;
