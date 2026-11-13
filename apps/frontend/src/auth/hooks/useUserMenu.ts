import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from './AuthProvider';
export function useUserMenu() {
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
  const closeProfile = () => {
    if (!pending) {
      setProfile(false);
      trigger.current?.focus();
    }
  };

  async function logout() {
    if (logoutPending) return;
    setLogoutError('');
    setLogoutPending(true);
    try {
      await signOut();
      setOpen(false);
    } catch (cause) {
      setLogoutError(
        cause instanceof Error ? cause.message : 'Не удалось выйти. Попробуйте ещё раз.',
      );
    } finally {
      setLogoutPending(false);
    }
  }
  async function submitPassword(event: FormEvent<HTMLFormElement>) {
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
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить пароль.');
    } finally {
      setPending(false);
    }
  }
  function openProfile() {
    setOpen(false);
    setProfile(true);
    setError('');
    setCurrent('');
    setPassword('');
    setRepeat('');
  }
  return {
    user,
    open,
    setOpen,
    profile,
    current,
    setCurrent,
    password,
    setPassword,
    repeat,
    setRepeat,
    visible,
    setVisible,
    pending,
    error,
    logoutPending,
    logoutError,
    wrap,
    trigger,
    closeProfile,
    openProfile,
    logout,
    submitPassword,
  };
}
export type UserMenuState = ReturnType<typeof useUserMenu>;
