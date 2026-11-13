import { useEffect, useId, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, MapPin, Plus, Search, X } from 'lucide-react';
import type { OfficeConfig } from '../model';
import { useOffices } from './OfficeProvider';
import './offices.css';

export function CreateOfficeDialog({
  onClose,
  onCreated,
  beforeCreate,
}: {
  onClose(): void;
  onCreated?(office: OfficeConfig): void | Promise<void>;
  beforeCreate?(): void | Promise<void>;
}) {
  const { createOffice } = useOffices();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<OfficeConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const createdRef = useRef<OfficeConfig | null>(null);
  const mounted = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const heading = useId();
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    mounted.current = true;
    dialog.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled),button:not(:disabled)',
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', key);
    return () => {
      mounted.current = false;
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
  }, []);
  return (
    <div
      className="office-dialog-backdrop"
      onMouseDown={(event) => {
        if (!busyRef.current && event.target === event.currentTarget) closeRef.current();
      }}
    >
      <section
        ref={dialog}
        className="office-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        aria-busy={busy}
      >
        <button
          type="button"
          className="office-dialog-close"
          aria-label="Закрыть создание офиса"
          disabled={busy}
          onClick={() => closeRef.current()}
        >
          <X size={19} />
        </button>
        <div className="office-create-scroll">
          <span className="office-dialog-icon">
            <Building2 size={24} />
          </span>
          <h2 id={heading}>Новый офис</h2>
          <p>Добавьте здание, затем соберите его план.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              setError('');
              try {
                let result = createdRef.current;
                if (!result) {
                  await beforeCreate?.();
                  result = await createOffice({ name, ...(address.trim() ? { address } : {}) });
                  createdRef.current = result;
                  if (mounted.current) setCreated(result);
                }
                if (!mounted.current) return;
                await onCreated?.(result);
                if (mounted.current) closeRef.current();
              } catch (cause) {
                if (mounted.current)
                  setError(cause instanceof Error ? cause.message : 'Не удалось создать офис.');
              } finally {
                busyRef.current = false;
                if (mounted.current) setBusy(false);
              }
            }}
          >
            <label className="office-form-field">
              Название офиса
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
                placeholder="Например, Офис на Невском"
                disabled={busy || !!created}
              />
            </label>
            <label className="office-form-field">
              Адрес <small>необязательно</small>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                maxLength={160}
                placeholder="Город, улица, дом"
                disabled={busy || !!created}
              />
            </label>
            <div className="office-create-note">
              <Building2 size={16} />
              <span>
                Один пустой этаж для начала.
                <br />
                Рабочие часы задаются в настройках офиса, план — в конструкторе.
              </span>
            </div>
            {created && error && (
              <p className="office-form-info">Офис уже создан. Повторное нажатие откроет его.</p>
            )}
            {error && (
              <p className="office-form-error" role="alert">
                {error}
              </p>
            )}
            <div className="office-dialog-actions">
              <button
                type="button"
                className="office-secondary"
                onClick={() => closeRef.current()}
                disabled={busy}
              >
                Отмена
              </button>
              <button type="submit" className="office-primary" disabled={busy}>
                <Plus size={16} />
                {busy
                  ? created
                    ? 'Открываем…'
                    : 'Создаём…'
                  : created
                    ? 'Открыть офис'
                    : 'Создать офис'}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default function OfficeSwitcher({ beforeChange }: { beforeChange?(): void }) {
  const {
    accessibleOffices,
    office,
    selectOffice,
    ready,
    error: catalogError,
    refresh,
  } = useOffices();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useId();
  useEffect(() => {
    if (!ready) {
      setOpen(false);
      setQuery('');
      setError('');
    }
  }, [ready]);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const filtered = accessibleOffices.filter((item) =>
    `${item.name} ${item.address || ''}`
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  return (
    <>
      <div ref={root} className="office-switcher">
        <button
          ref={trigger}
          className="office-switcher-trigger"
          aria-label={'Выбрать офис: ' + (office?.name || 'Не выбран')}
          aria-expanded={open}
          aria-controls={menu}
          disabled={!ready}
          onClick={() => {
            setOpen(!open);
            setQuery('');
            setError('');
          }}
        >
          <Building2 size={15} />
          <span>{!ready ? 'Загрузка офисов…' : office?.name || 'Выбрать офис'}</span>
          <ChevronDown size={13} />
        </button>
        {open && (
          <div id={menu} className="office-picker" aria-label="Выбор офиса">
            <div className="office-picker-heading">
              ВАШИ ОФИСЫ <span>{accessibleOffices.length}</span>
            </div>
            {accessibleOffices.length > 4 && (
              <label className="office-picker-search">
                <Search size={14} />
                <input
                  aria-label="Поиск офиса"
                  placeholder="Название или адрес"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            )}
            <div className="office-picker-list">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  className={
                    'office-picker-option' + (item.id === office?.id ? ' is-selected' : '')
                  }
                  aria-pressed={item.id === office?.id}
                  onClick={() => {
                    try {
                      if (item.id !== office?.id) {
                        beforeChange?.();
                        selectOffice(item.id);
                      }
                      setOpen(false);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Не удалось выбрать офис.');
                    }
                  }}
                >
                  <span className="office-picker-icon">
                    <Building2 size={18} />
                  </span>
                  <span>
                    <b>{item.name}</b>
                    <small>
                      {item.address ? (
                        <>
                          <MapPin size={10} />
                          {item.address}
                        </>
                      ) : (
                        `${item.floors.length} ${item.floors.length === 1 ? 'этаж' : item.floors.length < 5 ? 'этажа' : 'этажей'}`
                      )}
                    </small>
                  </span>
                  {item.id === office?.id && <Check size={16} />}
                </button>
              ))}
              {!filtered.length && !catalogError && (
                <p className="office-picker-empty">
                  {query.trim() ? 'Офисов не найдено' : 'Нет доступных офисов'}
                </p>
              )}
            </div>
            {catalogError && (
              <div role="alert" className="office-form-error">
                <p>{catalogError}</p>
                <button
                  type="button"
                  className="office-secondary"
                  disabled={retrying}
                  onClick={async () => {
                    setRetrying(true);
                    try {
                      await refresh();
                    } finally {
                      setRetrying(false);
                    }
                  }}
                >
                  {retrying ? 'Загрузка…' : 'Повторить загрузку'}
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="office-form-error">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
