import { forwardRef } from 'react';
import type { ReactElement } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Search } from 'lucide-react';
import { IconButton, Styles } from '../atoms';
const styles = String.raw`
.ui-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 36px;
  border: 1px solid #e4e9f2;
  border-radius: 8px;
  background: #fff;
  padding: 0 10px;
  color: #a3acbc;
}
.ui-search:focus-within {
  border-color: #a0ade5;
  box-shadow: 0 0 0 2px #eff2fd;
}
.ui-search > svg {
  flex: 0 0 15px;
}
.ui-search > input {
  width: 100%;
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #7c8da7;
  font:
    500 11px/1.4 Manrope,
    system-ui,
    sans-serif;
  height: 100%;
  padding: 0;
}
.ui-search > input::placeholder {
  color: #a8b3c4;
}
.ui-search > .ui-icon-button {
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  max-width: 24px;
  max-height: 24px;
  flex-basis: 24px;
  border: 0;
  background: transparent;
}
.ui-search > .ui-icon-button > svg {
  width: 13px;
  height: 13px;
}
`;
export const SearchField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void; trailing?: ReactNode }
>(function SearchField({ className = '', onClear, trailing, ...props }, ref): ReactElement {
  return (
    <>
      <Styles id="search-field">{styles}</Styles>
      <div className={`ui-search ${className}`.trim()}>
        <Search size={15} />
        <input {...props} ref={ref} type={props.type || 'search'} />
        {onClear && props.value ? (
          <IconButton aria-label="Очистить поиск" onClick={onClear}>
            <span aria-hidden="true">×</span>
          </IconButton>
        ) : (
          trailing
        )}
      </div>
    </>
  );
});
