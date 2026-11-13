import type { ReactElement } from 'react';
import type { LabelHTMLAttributes, ReactNode } from 'react';
import { Styles } from '../atoms';
const styles = String.raw`
.ui-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  font-size: 10px;
  font-weight: 600;
  color: #8d9cb4;
}
.ui-field-label {
  display: block;
}
.ui-field-hint {
  font-size: 9px;
  line-height: 1.7;
  font-weight: 500;
  color: #a0adc1;
}
.ui-field-error {
  font-size: 10px;
  line-height: 1.6;
  font-weight: 500;
  color: #b77e87;
}
.ui-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}
`;
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}): ReactElement {
  return (
    <>
      <Styles id="field">{styles}</Styles>
      <label {...props} className={`ui-field ${className}`.trim()}>
        <span className="ui-field-label">{label}</span>
        {children}
        {hint && <small className="ui-field-hint">{hint}</small>}
        {error && (
          <span role="alert" className="ui-field-error">
            {error}
          </span>
        )}
      </label>
    </>
  );
}
