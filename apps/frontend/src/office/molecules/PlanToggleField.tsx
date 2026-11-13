import type { ReactElement } from 'react';
import { Switch } from '../../shared/atoms';

export interface PlanToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}
export default function PlanToggleField({
  label,
  checked,
  onChange,
  description,
}: PlanToggleProps): ReactElement {
  return (
    <label className="toggle-row">
      <div>
        <span>{label}</span>
        {description && (
          <small className="muted" style={{ display: 'block', marginTop: 4, lineHeight: 1.5 }}>
            {description}
          </small>
        )}
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
