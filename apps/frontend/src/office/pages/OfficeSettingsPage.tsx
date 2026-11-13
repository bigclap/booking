import type { OfficeConfig } from '../lib/officeModel';
import { useOfficeSettings } from '../hooks/useOfficeSettings';
import AdminShell from '../organisms/AdminShell';
import OfficeSettingsView from '../organisms/OfficeSettingsView';
export default function OfficeSettingsPage({ office }: { office: OfficeConfig }) {
  const controller = useOfficeSettings(office);
  return (
    <AdminShell section="offices" office={office} view="settings">
      <OfficeSettingsView controller={controller} />
    </AdminShell>
  );
}
