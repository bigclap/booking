import { Styles } from '../../shared/atoms';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Field } from '../../shared/molecules';
import { Input, IconButton } from '../../shared/atoms';
export function PasswordInput({
  id,
  label,
  value,
  onChange,
  required = false,
  autoComplete = 'new-password',
  minLength = 8,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Styles id="user-password-input">{styles}</Styles>
      <Field className="adm-field" htmlFor={id} label={label}>
        <div className="adm-password-input">
          <Input
            id={id}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            required={required}
            minLength={minLength}
            autoComplete={autoComplete}
            maxLength={200}
          />
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label={
              visible ? `Скрыть ${label.toLowerCase()}` : `Показать ${label.toLowerCase()}`
            }
            title={visible ? 'Скрыть пароль' : 'Показать пароль'}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </IconButton>
        </div>
      </Field>
    </>
  );
}

const styles = String.raw`
.adm-password-input {
  width: 100%;
  min-width: 0;
  border: 1px solid #dfe6f0;
  border-radius: 7px;
  background: #fff;
  font-size: 12px;
  color: #657794;
  min-height: 40px;
}
.adm-password-input {
  display: flex;
  align-items: center;
  overflow: hidden;
}
.adm-password-input:focus-within {
  border-color: #9fa9e3;
  box-shadow: 0 0 0 3px #f2f3ff;
}
.adm-password-input > input {
  border: 0;
  outline: none !important;
  padding: 10px 11px;
  min-width: 0;
  width: 100%;
  background: transparent;
  color: #657794;
  font-size: 12px;
}
.adm-password-input > button {
  height: 38px;
  width: 38px;
  display: grid;
  place-items: center;
  color: #a4aec2;
  flex-shrink: 0;
}
.adm-password-input > button:hover {
  color: #808ed0;
}
@media (max-width: 570px) {
  .adm-password-input {
    font-size: 13px;
  }
}
`;
