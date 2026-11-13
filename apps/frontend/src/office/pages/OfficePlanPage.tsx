import type { OfficeConfig } from '../lib/officeModel';
import { useOfficePlanEditor } from '../hooks/useOfficePlanEditor';
import OfficeWorkspace from '../organisms/OfficeWorkspace';
import OfficePlanEditor from '../organisms/OfficePlanEditor';
import PlanHeaderActions from '../molecules/PlanHeaderActions';
export default function OfficePlanPage({ office }: { office: OfficeConfig }) {
  const editor = useOfficePlanEditor(office);
  return (
    <OfficeWorkspace office={office} view="plan" actions={<PlanHeaderActions editor={editor} />}>
      <OfficePlanEditor editor={editor} />
    </OfficeWorkspace>
  );
}
