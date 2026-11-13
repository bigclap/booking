import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from './AuthProvider';
export function useLogin() {
  const { signIn } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  useEffect(() => {
    document.title = 'Вход — Планировка';
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    setPending(true);
    try {
      await signIn(login, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти. Попробуйте ещё раз.');
    } finally {
      setPending(false);
    }
  }

  return {
    login,
    setLogin,
    password,
    setPassword,
    visible,
    setVisible,
    pending,
    error,
    setError,
    help,
    setHelp,
    submit,
  };
}
export type LoginState = ReturnType<typeof useLogin>;
