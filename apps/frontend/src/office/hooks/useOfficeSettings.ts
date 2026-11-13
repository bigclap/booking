import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { OfficeConfig } from '../lib/officeModel';
import { useOffices } from '../hooks/OfficeProvider';
import { useAuth } from '../../auth/hooks';
import { ApiError } from '../../shared/api';
import { DAYS, readDraft, draftKey, validate, normalizedHours } from '../lib/officeSettingsModel';
import type { OfficeHours, DayKey, OfficeDraft, FormErrors } from '../lib/officeSettingsModel';
export function useOfficeSettings(office: OfficeConfig) {
  const { updateOfficeSettings } = useOffices();
  const { user } = useAuth();
  const owner = `${user?.id || ''}:${office.id}`;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const active = useRef(true);
  const requestId = useRef(0);
  const [draft, setDraft] = useState(() => readDraft(office));
  const [baseline, setBaseline] = useState(() => draftKey(readDraft(office)));
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const officeId = useRef(office.id);
  const baselineRevision = useRef(office.revision);
  const dirty = draftKey(draft) !== baseline;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      requestId.current++;
    };
  }, [owner]);
  useEffect(() => {
    if (!dirty) return;
    const beforeunload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeunload);
    return () => window.removeEventListener('beforeunload', beforeunload);
  }, [dirty]);

  useEffect(() => {
    const changedOffice = officeId.current !== office.id;
    if (changedOffice || !dirty) {
      const next = readDraft(office);
      setDraft((previous) => (draftKey(previous) === draftKey(next) ? previous : next));
      setBaseline(draftKey(next));
      baselineRevision.current = office.revision;
      if (changedOffice) {
        setErrors({});
        setError('');
        setSaved(false);
        setConflict(false);
      }
      officeId.current = office.id;
    }
  }, [office, dirty]);

  useEffect(() => {
    document.title = `${office.name} — Настройки офиса`;
  }, [office.name]);

  function edit(update: Partial<OfficeDraft>) {
    setDraft((previous) => ({ ...previous, ...update }));
    setSaved(false);
    setError('');
  }

  function editDay(key: DayKey, update: Partial<OfficeHours[string]>) {
    setDraft((previous) => ({
      ...previous,
      hours: { ...previous.hours, [key]: { ...previous.hours[key], ...update } },
    }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setSaved(false);
    setError('');
  }

  function resetDraft() {
    if (saving) return;
    const next = readDraft(office);
    setDraft(next);
    setBaseline(draftKey(next));
    baselineRevision.current = office.revision;
    setErrors({});
    setError('');
    setSaved(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || conflict) return;
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    setSaved(false);
    setError('');
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    const request = ++requestId.current;
    try {
      // The settings endpoint preserves the server's current floors atomically.
      const next = await updateOfficeSettings(
        office.id,
        {
          name: draft.name.trim(),
          address: draft.address.trim() || undefined,
          hours: normalizedHours(draft.hours),
        },
        baselineRevision.current,
      );
      if (!active.current || ownerRef.current !== owner || request !== requestId.current) return;
      const clean = readDraft(next);
      baselineRevision.current = next.revision;
      setDraft(clean);
      setBaseline(draftKey(clean));
      setSaved(true);
    } catch (cause) {
      if (active.current && ownerRef.current === owner && request === requestId.current) {
        if (cause instanceof ApiError && cause.status === 409) {
          setConflict(true);
          setError(
            'Офис изменён в другом окне. Ваши настройки не сохранены. Откройте актуальную версию и внесите правки снова.',
          );
        } else
          setError(
            cause instanceof Error ? cause.message : 'Не удалось сохранить настройки офиса.',
          );
      }
    } finally {
      if (active.current && ownerRef.current === owner && request === requestId.current)
        setSaving(false);
    }
  }

  const enabledDays = DAYS.filter(([day]) => draft.hours[day].enabled).length;

  return {
    office,
    updateOfficeSettings,
    user,
    owner,
    ownerRef,
    active,
    requestId,
    draft,
    setDraft,
    baseline,
    setBaseline,
    errors,
    setErrors,
    error,
    setError,
    saved,
    setSaved,
    saving,
    setSaving,
    conflict,
    setConflict,
    officeId,
    baselineRevision,
    dirty,
    edit,
    editDay,
    resetDraft,
    handleSave,
    enabledDays,
  };
}
export type OfficeSettingsController = ReturnType<typeof useOfficeSettings>;
