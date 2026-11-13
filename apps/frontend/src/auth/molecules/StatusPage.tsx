import type { HTMLAttributes } from 'react';
import { Styles } from '../../shared/atoms';
export function StatusPage({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <>
      <Styles id="auth-status">{styles}</Styles>
      <div {...props} className={`auth-status-page ${className}`}>
        {children}
      </div>
    </>
  );
}
export function StatusCard({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <>
      <Styles id="auth-status">{styles}</Styles>
      <section {...props} className={`auth-status-card ${className}`}>
        {children}
      </section>
    </>
  );
}
const styles = String.raw`
.auth-status-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #f6f7fc;
}

.auth-status-card {
  max-width: 440px;
  text-align: center;
  padding: 32px;
  background: white;
  border: 1px solid #e3e8f1;
  border-radius: 16px;
}

.auth-status-card > svg {
  color: #8d97d6;
}

.auth-status-card h1 {
  font-size: 22px;
  color: #56637d;
  letter-spacing: -0.5px;
}

.auth-status-card p {
  color: #95a0b6;
  font-size: 12px;
  line-height: 1.8;
}

.auth-status-card button {
  font-size: 12px;
  color: #7e86c9;
  padding: 10px;
}
`;
