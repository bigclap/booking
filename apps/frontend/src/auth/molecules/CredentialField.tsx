import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Input, Styles } from '../../shared/atoms';
import { Field } from '../../shared/molecules';
export function CredentialField({
  label,
  leading,
  action,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  leading?: ReactNode;
  action?: ReactNode;
}) {
  const generated = useId();
  const fieldId = id || generated;
  return (
    <>
      <Styles id="credential-field">{styles}</Styles>
      <Field label={label} htmlFor={fieldId} className="auth-credential">
        <div className="auth-credential-control">
          {leading}
          <Input {...props} id={fieldId} />
          {action}
        </div>
      </Field>
    </>
  );
}
const styles = String.raw`
.auth-credential {
  font-size: 11px;
  font-weight: 650;
  color: #64728d;
  margin-top: 19px;
  gap: 9px;
}
.auth-credential-control {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #dfe5ee;
  border-radius: 9px;
  height: 47px;
  padding: 0 13px;
  background: #fff;
  color: #a4aec1;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.auth-credential-control:focus-within {
  border-color: #939bde;
  box-shadow: 0 0 0 3px #8d94df12;
}
.auth-credential-control > .ui-input {
  height: 43px;
  border: 0;
  box-shadow: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: #46536d;
}
.auth-credential-control > .ui-input::placeholder {
  color: #b3bbca;
}
.auth-credential-control > .ui-icon-button {
  border: 0;
  background: transparent;
  color: #9aa5b9;
}
`;
