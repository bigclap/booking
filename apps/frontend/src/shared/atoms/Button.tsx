import type { ReactElement } from 'react';
import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { Styles } from './Styles';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}
const styles = String.raw`
:where(.ui-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 36px;
  padding: 9px 13px;
  border: 1px solid #dfe6f1;
  border-radius: 8px;
  background: #fff;
  color: #7d8da7;
  font:
    650 11px/1.3 Manrope,
    system-ui,
    sans-serif;
  white-space: nowrap;
  text-decoration: none;
  touch-action: manipulation;
  cursor: pointer;
  box-sizing: border-box;
}
.ui-button > svg {
  display: block;
  flex-shrink: 0;
  pointer-events: none;
}
.ui-button:where([data-size='sm']) {
  min-height: 32px;
  padding: 7px 10px;
  font-size: 10px;
  gap: 6px;
}
.ui-button:where([data-variant='primary']) {
  color: #fff;
  background: #7d89dc;
  border-color: #7280d3;
  box-shadow: 0 3px 8px #7d89dc17;
}
.ui-button:where([data-variant='ghost']) {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
.ui-button:where([data-variant='danger']) {
  background: #c2838c;
  border-color: #b87680;
  color: #fff;
}
.ui-button:where(:hover:not(:disabled):not([aria-disabled='true'])) {
  background: #f7f9fd;
  border-color: #cfd9eb;
}
.ui-button:where([data-variant='primary']:hover:not(:disabled)) {
  background: #707fd2;
  border-color: #7280d3;
}
.ui-button:where([data-variant='danger']:hover:not(:disabled)) {
  background: #b77782;
  border-color: #b87680;
}
.ui-button:where(:disabled, [aria-disabled='true']) {
  opacity: 0.5;
  cursor: default;
}
.ui-button:where(:focus-visible) {
  outline: 2px solid #8b96e6;
  outline-offset: 3px;
}
.ui-icon-button {
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  max-width: 34px;
  max-height: 34px;
  flex: 0 0 34px;
  padding: 0 !important;
  line-height: 1;
  box-shadow: none;
}
.ui-icon-button[data-size='sm'] {
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  max-width: 30px;
  max-height: 30px;
  flex-basis: 30px;
}
.ui-icon-button > svg {
  width: 18px;
  height: 18px;
}
.ui-close-button {
  background: #fffffff2;
  color: #8795ac;
  border-color: #e3e8f2;
}
.ui-close-button:where(:hover:not(:disabled)) {
  background: #f1f4fc;
  border-color: #cbd5e8;
  color: #6479b8;
}
`;
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', type = 'button', className = '', children, ...props },
  ref,
) {
  return (
    <>
      <Styles id="button">{styles}</Styles>
      <button
        {...props}
        ref={ref}
        type={type}
        data-variant={variant}
        data-size={size}
        className={`ui-button ${className}`.trim()}
      >
        {children}
      </button>
    </>
  );
});
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { 'aria-label': string }>(
  function IconButton({ className = '', ...props }, ref) {
    return <Button {...props} ref={ref} className={`ui-icon-button ${className}`.trim()} />;
  },
);
export const CloseButton = forwardRef<HTMLButtonElement, ButtonProps>(function CloseButton(
  { className = '', children, 'aria-label': label = 'Закрыть', ...props },
  ref,
) {
  return (
    <IconButton
      {...props}
      ref={ref}
      aria-label={label}
      className={`ui-close-button ${className}`.trim()}
    >
      {children || <X size={18} />}
    </IconButton>
  );
});
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & Pick<ButtonProps, 'variant' | 'size'>): ReactElement {
  return (
    <>
      <Styles id="button">{styles}</Styles>
      <a
        {...props}
        data-variant={variant}
        data-size={size}
        className={`ui-button ${className}`.trim()}
      >
        {children}
      </a>
    </>
  );
}
