import { useEffect, useState } from 'react';
import type { ChangeEventHandler } from 'react';

export interface PlanNumberOptions {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  integer?: boolean;
}
export interface PlanNumberState {
  draft: string;
  change: ChangeEventHandler<HTMLInputElement>;
  blur: () => void;
}

export function usePlanNumberField({
  value,
  onChange,
  min,
  integer = false,
}: PlanNumberOptions): PlanNumberState {
  const display = String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  return {
    draft,
    change: (event) => {
      const next = event.target.value;
      setDraft(next);
      const parsed = Number(next);
      if (next.trim() && Number.isFinite(parsed) && (min === undefined || parsed >= min)) {
        const normalized = integer ? Math.round(parsed) : parsed;
        if (integer) setDraft(String(normalized));
        onChange(normalized);
      }
    },
    blur: () => {
      const parsed = Number(draft);
      if (!draft.trim() || !Number.isFinite(parsed)) setDraft(display);
      else {
        const clamped = min === undefined ? parsed : Math.max(min, parsed);
        const next = integer ? Math.round(clamped) : clamped;
        setDraft(String(next));
        if (next !== value) onChange(next);
      }
    },
  };
}
