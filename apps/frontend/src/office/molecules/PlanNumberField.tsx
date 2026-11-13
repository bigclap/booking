import type { ReactElement } from 'react';
import { Input } from '../../shared/atoms';
import { Field } from '../../shared/molecules';
import { usePlanNumberField } from '../hooks/usePlanNumberField';
import type { PlanNumberOptions } from '../hooks/usePlanNumberField';

export default function PlanNumberField({
  label,
  disabled = false,
  ...options
}: PlanNumberOptions & { label: string; disabled?: boolean }): ReactElement {
  const field = usePlanNumberField(options);
  return (
    <Field className="plan-property-field" label={label}>
      <Input
        type="number"
        aria-label={label}
        value={field.draft}
        min={options.min}
        step="1"
        disabled={disabled}
        onChange={field.change}
        onBlur={field.blur}
      />
    </Field>
  );
}
