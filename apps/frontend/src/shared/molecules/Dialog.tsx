import { useEffect, useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CloseButton, Styles } from '../atoms';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  title?: ReactNode;
  eyebrow?: ReactNode;
  ariaLabel?: string;
  labelledBy?: string;
  role?: 'dialog' | 'alertdialog';
  closeLabel?: string;
  footer?: ReactNode;
  placement?: 'center' | 'right';
  className?: string;
  bodyClassName?: string;
  backdropClassName?: string;
  children: ReactNode;
}
const styles = String.raw`
.ui-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 180;
  background: #25385326;
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.ui-dialog-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 440px;
  max-width: 100%;
  max-height: calc(100dvh - 40px);
  background: #fff;
  border: 1px solid #e3e8f2;
  border-radius: 14px;
  box-shadow: 0 16px 55px #3c527828;
  overflow: hidden;
  outline: none;
  color: #71839f;
}
.ui-dialog-backdrop[data-placement='right'] {
  justify-content: flex-end;
  align-items: stretch;
  padding: 0;
}
.ui-dialog-backdrop[data-placement='right'] > .ui-dialog-panel {
  width: 400px;
  height: 100dvh;
  max-height: 100dvh;
  border-radius: 0;
  border: 0;
  box-shadow: -12px 0 45px #3c52781c;
}
.ui-dialog-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 24px 24px 18px;
  border-bottom: 1px solid #edf0f5;
  flex-shrink: 0;
}
.ui-dialog-heading > div {
  min-width: 0;
}
.ui-dialog-heading h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.4;
  letter-spacing: -0.4px;
  color: #5d6d86;
  font-weight: 750;
}
.ui-dialog-eyebrow {
  display: block;
  font-size: 8px;
  font-weight: 750;
  letter-spacing: 1.3px;
  color: #a7b1c4;
  margin-bottom: 8px;
}
.ui-dialog-panel > .ui-dialog-close {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 5;
}
.ui-dialog-body {
  padding: 22px 24px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #d9e1ed transparent;
}
.ui-dialog-footer {
  padding: 17px 24px 21px;
  border-top: 1px solid #edf0f5;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  flex-shrink: 0;
  background: #fff;
}
@media (max-width: 480px) {
  .ui-dialog-backdrop {
    padding: 12px;
  }
  .ui-dialog-panel {
    max-height: calc(100dvh - 24px);
  }
  .ui-dialog-heading {
    padding: 21px 20px 17px;
  }
  .ui-dialog-body {
    padding: 20px;
  }
  .ui-dialog-footer {
    padding: 15px 20px 19px;
  }
}
`;

export function Dialog({
  open,
  onClose,
  busy = false,
  title,
  eyebrow,
  ariaLabel,
  labelledBy,
  role = 'dialog',
  closeLabel = 'Закрыть',
  footer,
  placement = 'center',
  className = '',
  bodyClassName = '',
  backdropClassName = '',
  children,
}: DialogProps): ReactElement | null {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const pending = useRef(busy);
  close.current = onClose;
  pending.current = busy;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]',
        ),
      ];
      if (dialogs.at(-1) !== panel.current) return;
      if (event.key === 'Escape' && !pending.current) {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const targets = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => item.getClientRects().length > 0 && !item.closest('[inert]'));
      const first = targets[0],
        last = targets.at(-1);
      if (!first) {
        event.preventDefault();
        panel.current.focus();
        return;
      }
      if (!panel.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <Styles id="dialog">{styles}</Styles>
      <div
        className={`ui-dialog-backdrop ${backdropClassName}`.trim()}
        data-placement={placement}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) onClose();
        }}
      >
        <section
          ref={panel}
          tabIndex={-1}
          role={role}
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={labelledBy || (!ariaLabel && title ? titleId : undefined)}
          className={`ui-dialog-panel ${className}`.trim()}
        >
          {title ? (
            <header className="ui-dialog-heading">
              <div>
                {eyebrow && <span className="ui-dialog-eyebrow">{eyebrow}</span>}
                <h2 id={titleId}>{title}</h2>
              </div>
              <CloseButton onClick={onClose} disabled={busy} aria-label={closeLabel} />
            </header>
          ) : (
            <CloseButton
              className="ui-dialog-close"
              onClick={onClose}
              disabled={busy}
              aria-label={closeLabel}
            />
          )}
          <div className={`ui-dialog-body ${bodyClassName}`.trim()}>{children}</div>
          {footer && <footer className="ui-dialog-footer">{footer}</footer>}
        </section>
      </div>
    </>
  );
}
