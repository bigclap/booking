import { useMemo, useRef, useState } from 'react';
import { gateway } from '../../shared/api';
import { useAuth } from '../../auth/hooks';
import { useOffices } from './OfficeProvider';
import { loadOffices, OFFICES_STORAGE_KEY } from './officeStore';
import { prepareClientOffice } from '../../booking/archive';
import type { OfficeConfig } from '../lib/officeModel';
function archivedOffices(): {
  offices: OfficeConfig[];
  error: string;
} {
  try {
    // loadOffices has a demo default. Import only data actually saved by this browser.
    if (
      localStorage.getItem(OFFICES_STORAGE_KEY) === null &&
      localStorage.getItem('plan-room.office-builder.v1') === null
    )
      return { offices: [], error: '' };
    return { offices: loadOffices(), error: '' };
  } catch (cause) {
    return {
      offices: [],
      error: cause instanceof Error ? cause.message : 'Не удалось прочитать браузерный архив.',
    };
  }
}
async function importKey(userId: string, document: OfficeConfig): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(document)),
  );
  const fingerprint = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const storageKey = `plan-room.server-office-import.v1.${encodeURIComponent(userId)}.${encodeURIComponent(document.id)}`;
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      const attempt = JSON.parse(raw) as {
        fingerprint?: unknown;
        key?: unknown;
      };
      if (attempt.fingerprint === fingerprint && typeof attempt.key === 'string')
        return attempt.key;
    } catch {
      /* Only this migration receipt is replaced, never the archived source. */
    }
  }
  const key = crypto.randomUUID();
  localStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
  return key;
}

export function useLegacyOfficeImport() {
  const { user } = useAuth();
  const { offices, refresh } = useOffices();
  const archive = useMemo(archivedOffices, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<string[]>([]);
  const remaining = archive.offices.filter(
    (item) => !offices.some((server) => server.id === item.id) && !imported.includes(item.id),
  );

  async function transfer(source: OfficeConfig) {
    if (!user || pending.current) return;
    pending.current = true;
    setBusyId(source.id);
    setError('');
    try {
      // Make the old client view's explicit shared-seat settings part of the imported document.
      const document = prepareClientOffice(source);
      const key = await importKey(user.id, document);
      await gateway.importOffice(document, key);
      setImported((previous) => [...previous, source.id]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось перенести офис.');
    } finally {
      pending.current = false;
      setBusyId(null);
    }
  }

  const visible = user?.role === 'admin' && (!!remaining.length || !!archive.error || !!error);
  return { visible, remaining, busyId, archiveError: archive.error, error, transfer };
}
export type LegacyOfficeImportController = ReturnType<typeof useLegacyOfficeImport>;
