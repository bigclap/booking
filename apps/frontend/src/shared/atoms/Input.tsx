import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { Styles } from './Styles';
const styles = String.raw`
:where(.ui-input),
:where(.ui-select) {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 39px;
  border: 1px solid #dfe6f0;
  border-radius: 7px;
  background: #fff;
  color: #7c8da7;
  padding: 0 10px;
  font:
    500 11px/1.4 Manrope,
    system-ui,
    sans-serif;
  outline: none;
}
.ui-input:where(:focus),
.ui-select:where(:focus) {
  border-color: #a0ade5;
  box-shadow: 0 0 0 2px #eff2fd;
}
.ui-input:where(:disabled),
.ui-select:where(:disabled) {
  background: #f7f8fc;
  color: #a5b0c1;
  opacity: 0.7;
  cursor: default;
}
.ui-input:where([aria-invalid='true']),
.ui-select:where([aria-invalid='true']) {
  border-color: #cf9da6;
}
.ui-input::placeholder {
  color: #abb5c6;
}
.ui-switch {
  appearance: none;
  width: 34px;
  height: 20px;
  border: 0;
  border-radius: 12px;
  background: #d8dfed;
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
  vertical-align: middle;
  margin: 0;
  transition: background 0.15s;
}
.ui-switch:before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #54657a20;
  transition: transform 0.15s;
}
.ui-switch:checked {
  background: #8999df;
}
.ui-switch:checked:before {
  transform: translateX(14px);
}
.ui-switch:focus-visible {
  outline: 2px solid #8b96e6;
  outline-offset: 3px;
}
.ui-switch:disabled {
  opacity: 0.5;
  cursor: default;
}
`;
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return (
      <>
        <Styles id="input">{styles}</Styles>
        <input {...props} ref={ref} className={`ui-input ${className}`.trim()} />
      </>
    );
  },
);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', ...props }, ref) {
    return (
      <>
        <Styles id="input">{styles}</Styles>
        <select {...props} ref={ref} className={`ui-select ${className}`.trim()} />
      </>
    );
  },
);
export const Switch = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Switch({ className = '', ...props }, ref) {
    return (
      <>
        <Styles id="input">{styles}</Styles>
        <input
          {...props}
          ref={ref}
          type="checkbox"
          role="switch"
          className={`ui-switch ${className}`.trim()}
        />
      </>
    );
  },
);
