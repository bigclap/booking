import AdminShell from '../organisms/AdminShell';
import { useOfficeDirectory } from '../hooks/useOfficeDirectory';
import OfficeDirectory from '../organisms/OfficeDirectory';
import { CreateOfficeDialog } from '../molecules/OfficeSwitcher';
import { officePath } from '../lib/routes';
export default function OfficesPage() {
  const controller = useOfficeDirectory();
  return (
    <AdminShell
      section="offices"
      overlays={
        controller.create && (
          <CreateOfficeDialog
            onClose={() => controller.setCreate(false)}
            onCreated={(office) => window.location.assign(officePath(office.id))}
          />
        )
      }
    >
      <OfficeDirectory controller={controller} />
    </AdminShell>
  );
}
