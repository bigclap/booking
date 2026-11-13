import type { ReactElement } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { Styles } from '../atoms';
const styles = String.raw`
.ui-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e1e7f1;
  border-radius: 8px;
  background: #f5f7fb;
  color: #8897b0;
  font-size: 11px;
  line-height: 1.7;
}
.ui-notice > svg {
  flex: 0 0 16px;
  margin-top: 2px;
}
.ui-notice-content {
  min-width: 0;
  flex: 1;
}
.ui-notice-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}
.ui-notice[data-tone='error'] {
  color: #b47e86;
  background: #fff4f5;
  border-color: #f0d8dc;
}
.ui-notice[data-tone='warning'] {
  color: #b28e55;
  background: #fff7e9;
  border-color: #f1e6cf;
}
.ui-notice[data-tone='success'] {
  color: #739c88;
  background: #f0f8f2;
  border-color: #dcece2;
}
`;
export function Notice({
  tone = 'info',
  actions,
  children,
  className = '',
  role,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: 'info' | 'warning' | 'error' | 'success';
  actions?: ReactNode;
}): ReactElement {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <>
      <Styles id="notice">{styles}</Styles>
      <div
        {...props}
        role={role || (tone === 'error' ? 'alert' : 'status')}
        data-tone={tone}
        className={`ui-notice ${className}`.trim()}
      >
        <Icon size={16} />
        <div className="ui-notice-content">{children}</div>
        {actions && <div className="ui-notice-actions">{actions}</div>}
      </div>
    </>
  );
}
