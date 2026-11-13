import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from './AuthProvider';
import './auth.css';

export default function UserMenu({ area = 'client' }: { area?: 'client' | 'admin' }) {
  const { user, signOut, changePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
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
  useEffect(() => {
    if (!profile) return;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        setProfile(false);
        trigger.current?.focus();
      }
      if (event.key === 'Tab') {
        const targets = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),a[href]',
        );
        if (!targets?.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [profile, pending]);
  if (!user) return null;
  const initials = (user.firstName[0] + user.lastName[0]).toLocaleUpperCase('ru');
  const closeProfile = () => {
    if (!pending) {
      setProfile(false);
      trigger.current?.focus();
    }
  };
  return (
    <>
      <div className="account-menu-wrap" ref={wrap}>
        <button
          ref={trigger}
          className="account-avatar"
          aria-label="Открыть профиль"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen(!open)}
        >
          {initials}
        </button>
        {open && (
          <div className="account-menu">
            <div className="account-menu-identity">
              <b>
                {user.firstName} {user.lastName}
              </b>
              <small>@{user.login}</small>
              <span>{user.role === 'admin' ? 'Администратор' : 'Сотрудник'}</span>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                setProfile(true);
                setError('');
                setCurrent('');
                setPassword('');
                setRepeat('');
              }}
              disabled={logoutPending}
            >
              <UserRound size={16} />
              Мой профиль
            </button>
            {user.role === 'admin' &&
              (area === 'admin' ? (
                <a href="/booking">
                  <CalendarDays size={16} />К бронированию
                </a>
              ) : (
                <a href="/admin/offices">
                  <ShieldCheck size={16} />
                  Администрирование
                </a>
              ))}
            <button
              className="account-logout"
              disabled={logoutPending}
              aria-busy={logoutPending}
              onClick={async () => {
                if (logoutPending) return;
                setLogoutError('');
                setLogoutPending(true);
                try {
                  await signOut();
                  setOpen(false);
                } catch (cause) {
                  setLogoutError(
                    cause instanceof Error
                      ? cause.message
                      : 'Не удалось выйти. Попробуйте ещё раз.',
                  );
                } finally {
                  setLogoutPending(false);
                }
              }}
            >
              {logoutPending ? (
                <LoaderCircle size={16} className="auth-spinner" />
              ) : (
                <LogOut size={16} />
              )}{' '}
              {logoutPending ? 'Выходим…' : 'Выйти'}
            </button>
            {logoutError && (
              <p className="account-menu-error" role="alert">
                {logoutError}
              </p>
            )}
          </div>
        )}
      </div>
      {profile && (
        <div
          className="account-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProfile();
          }}
        >
          <section
            ref={dialog}
            tabIndex={-1}
            className="account-profile"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-title"
          >
            <button
              className="account-close"
              aria-label="Закрыть профиль"
              onClick={closeProfile}
              disabled={pending}
            >
              <X size={20} />
            </button>
            <div className="account-profile-scroll">
              <span className="account-profile-icon">
                <UserRound size={24} />
              </span>
              <h2 id="profile-title">Мой профиль</h2>
              <p>
                {user.firstName} {user.lastName}
              </p>
              <div className="account-details">
                <div>
                  <span>Логин</span>
                  <b>{user.login}</b>
                </div>
                <div>
                  <span>Роль</span>
                  <b>
                    <ShieldCheck size={14} />
                    {user.role === 'admin' ? 'Администратор' : 'Сотрудник'}
                  </b>
                </div>
              </div>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (pending) return;
                  if (password !== repeat) {
                    setError('Новые пароли не совпадают.');
                    return;
                  }
                  setError('');
                  setPending(true);
                  try {
                    await changePassword(current, password);
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : 'Не удалось изменить пароль.',
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <h3>
                  <KeyRound size={17} />
                  Смена пароля
                </h3>
                <label className="auth-field">
                  Текущий пароль
                  <div>
                    <input
                      required
                      autoComplete="current-password"
                      type={visible ? 'text' : 'password'}
                      value={current}
                      onChange={(event) => setCurrent(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                </label>
                <label className="auth-field">
                  Новый пароль
                  <div>
                    <input
                      required
                      minLength={8}
                      autoComplete="new-password"
                      type={visible ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Не менее 8 символов"
                      disabled={pending}
                    />
                    <button
                      type="button"
                      aria-label={visible ? 'Скрыть пароли' : 'Показать пароли'}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
                <label className="auth-field">
                  Повторите новый пароль
                  <div>
                    <input
                      required
                      minLength={8}
                      autoComplete="new-password"
                      type={visible ? 'text' : 'password'}
                      value={repeat}
                      onChange={(event) => setRepeat(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                </label>
                <p className="account-password-note">
                  После смены пароля нужно войти заново на всех устройствах.
                </p>
                {error && (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" className="auth-primary" disabled={pending}>
                  {pending ? <LoaderCircle size={17} className="auth-spinner" /> : null}Изменить
                  пароль
                </button>
              </form>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
