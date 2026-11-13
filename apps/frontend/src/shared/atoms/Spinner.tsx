import type { ComponentProps, ReactElement } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Styles } from './Styles';
const css = String.raw`
@keyframes ui-spin {
  to {
    transform: rotate(360deg);
  }
}
.ui-spinner {
  animation: ui-spin 1s linear infinite;
  flex-shrink: 0;
  display: block;
}
`;
export function Spinner({
  className = '',
  ...props
}: ComponentProps<typeof LoaderCircle>): ReactElement {
  return (
    <>
      <Styles id="spinner">{css}</Styles>
      <LoaderCircle
        {...props}
        aria-hidden={props['aria-label'] ? undefined : true}
        className={`ui-spinner ${className}`.trim()}
      />
    </>
  );
}
