import { Styles } from '../../shared/atoms';
import { Button, Badge } from '../../shared/atoms';
import { Check, Eye } from 'lucide-react';
import type { OfficePlanEditor } from '../hooks/useOfficePlanEditor';
export default function PlanHeaderActions({ editor }: { editor: OfficePlanEditor }) {
  const { saveError, setSelectedId, setTool, preview, setPreview, saveState } = editor;
  return (
    <>
      <>
        <Badge
          tone={saveError ? 'danger' : 'neutral'}
          role="status"
          className={'save-state' + (saveError ? ' save-error' : '')}
        >
          <Check size={14} />
          {saveState}
        </Badge>
        <Button
          className={'preview-button' + (preview ? ' active' : '')}
          aria-label={preview ? 'К редактированию' : 'Предпросмотр'}
          onClick={() => {
            setPreview(!preview);
            setSelectedId(null);
            setTool('select');
          }}
          variant="secondary"
          size="sm"
        >
          <Eye size={15} />
          {preview ? 'К редактированию' : 'Предпросмотр'}
        </Button>
      </>
      <Styles id="office-actions">{styles}</Styles>
    </>
  );
}

const styles = String.raw`
.office-workspace-actions .save-state {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #8a93a5;
  font-size: 11px;
  background: transparent;
  padding: 0;
}
@media (max-width: 850px) {
  .office-workspace-actions .save-state {
    display: none;
  }
}
.office-workspace-actions .save-state {
  white-space: nowrap;
}
.office-workspace-actions .save-error {
  color: #c46566;
}
.office-workspace-actions .preview-button.active {
  background: #edf0ff;
  color: #5367dc;
  border-color: #d6defe;
}
@media (max-width: 1200px) {
  .office-workspace-actions .save-state {
    font-size: 9px;
  }
}
@media (max-width: 950px) {
  .office-workspace-actions .save-state {
    display: none;
  }
}
@media (max-width: 760px) {
  .office-workspace-actions .preview-button {
    font-size: 8px;
  }
}
`;
