import type { ReactElement } from 'react';
import type { HTMLAttributes } from 'react';
import { Styles } from './Styles';
const styles = String.raw`
.ui-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 3px 6px;
  min-width: 18px;
  border-radius: 5px;
  font-size: 9px;
  line-height: 1.5;
  color: #8493b1;
  background: #eff2f8;
  white-space: nowrap;
}
.ui-badge[data-tone='success'] {
  color: #65a289;
  background: #edf7f0;
}
.ui-badge[data-tone='warning'] {
  color: #bb914e;
  background: #fff2df;
}
.ui-badge[data-tone='danger'] {
  color: #b97f88;
  background: #fbebee;
}
.ui-badge[data-tone='accent'] {
  color: #7b88ca;
  background: #eef0fb;
}
`;
export function Badge({
  tone = 'neutral',
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}): ReactElement {
  return (
    <>
      <Styles id="badge">{styles}</Styles>
      <span {...props} data-tone={tone} className={`ui-badge ${className}`.trim()}>
        {children}
      </span>
    </>
  );
}
