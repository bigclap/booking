import type { FormEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { OfficeConfig } from '../lib/officeModel';
import { useOffices } from '../hooks/OfficeProvider';
export interface CreateOfficeOptions {
  onClose(): void;
  onCreated?(office: OfficeConfig): void | Promise<void>;
  beforeCreate?(): void | Promise<void>;
}
export function useCreateOffice({ onClose, onCreated, beforeCreate }: CreateOfficeOptions) {
  const { createOffice } = useOffices();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<OfficeConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const createdRef = useRef<OfficeConfig | null>(null);
  const mounted = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      let result = createdRef.current;
      if (!result) {
        await beforeCreate?.();
        result = await createOffice({ name, ...(address.trim() ? { address } : {}) });
        createdRef.current = result;
        if (mounted.current) setCreated(result);
      }
      if (!mounted.current) return;
      await onCreated?.(result);
      if (mounted.current) closeRef.current();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Не удалось создать офис.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const formId = useId();
  return { name, setName, address, setAddress, error, created, busy, submit, onClose, formId };
}
