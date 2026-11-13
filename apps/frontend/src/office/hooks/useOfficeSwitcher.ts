import { useEffect, useId, useRef, useState } from 'react';
import { useOffices } from '../hooks/OfficeProvider';
export function useOfficeSwitcher(beforeChange?: () => void) {
  const {
    accessibleOffices,
    office,
    selectOffice,
    ready,
    error: catalogError,
    refresh,
  } = useOffices();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useId();
  useEffect(() => {
    if (!ready) {
      setOpen(false);
      setQuery('');
      setError('');
    }
  }, [ready]);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const filtered = accessibleOffices.filter((item) =>
    `${item.name} ${item.address || ''}`
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  function toggle(): void {
    setOpen(!open);
    setQuery('');
    setError('');
  }
  function choose(id: string): void {
    try {
      if (id !== office?.id) {
        beforeChange?.();
        selectOffice(id);
      }
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выбрать офис.');
    }
  }
  async function retry(): Promise<void> {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }
  return {
    accessibleOffices,
    office,
    ready,
    catalogError,
    open,
    query,
    setQuery,
    error,
    retrying,
    root,
    trigger,
    menu,
    filtered,
    toggle,
    choose,
    retry,
  };
}
export type OfficeSwitcherController = ReturnType<typeof useOfficeSwitcher>;
