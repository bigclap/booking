import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Grid2X2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from 'lucide-react';
import { useAuth } from './AuthProvider';
import './auth.css';

export default function LoginPage() {
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

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Планировка офиса">
        <a className="auth-brand" href="/login">
          <span>
            <Grid2X2 size={24} />
          </span>
          планировка<i>•</i>
        </a>
        <div className="auth-story-copy">
          <span className="auth-kicker">РАБОЧЕЕ ПРОСТРАНСТВО</span>
          <h1>
            Место для вас.
            <br />И вашей команды.
          </h1>
          <p>
            Рабочие места и переговорные
            <br />
            на одном плане офиса.
          </p>
        </div>
        <div className="auth-office-art" aria-hidden="true">
          <div className="auth-art-label">
            <Building2 size={15} />
            <span>Ваш офис</span>
            <b>1 этаж</b>
          </div>
          <div className="auth-mini-plan">
            <div className="auth-mini-room">
              <small>Переговорная</small>
              <img
                className="auth-meeting-table"
                src="/assets/furniture/meeting-table.svg"
                alt=""
              />
              {[0, 1, 2, 3].map((i) => (
                <img
                  key={i}
                  className={'auth-art-chair chair-' + i}
                  src="/assets/furniture/chair.svg"
                  alt=""
                />
              ))}
              <span className="auth-art-available">
                <i />
                Свободно
              </span>
            </div>
            <div className="auth-mini-desks">
              {[0, 1, 2, 3].map((i) => (
                <div className={'auth-art-desk desk-' + i} key={i}>
                  <img src="/assets/furniture/desk.svg" alt="" />
                  <img src="/assets/furniture/monitor.svg" alt="" />
                  <img src="/assets/furniture/chair.svg" alt="" />
                </div>
              ))}
            </div>
            <div className="auth-mini-lounge">
              <img src="/assets/furniture/sofa-3.svg" alt="" />
              <img src="/assets/furniture/plant.svg" alt="" />
            </div>
          </div>
          <div className="auth-art-booking">
            <span>
              <Grid2X2 size={18} />
            </span>
            <div>
              <b>Ваше место найдено</b>
              <small>Выберите время — и можно работать</small>
            </div>
            <div className="auth-art-check">✓</div>
          </div>
        </div>
        <span className="auth-story-note">
          <span />
          Всё начинается с удобного места
        </span>
      </section>
      <section className="auth-entry">
        <div className="auth-mobile-brand auth-brand">
          <span>
            <Grid2X2 size={22} />
          </span>
          планировка<i>•</i>
        </div>
        <div className="auth-login-card">
          <span className="auth-page-tag">
            <LockKeyhole size={13} />
            Внутренний сервис
          </span>
          <h2>Вход в Планировку</h2>
          <p className="auth-intro">Введите данные, которые выдал администратор.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending) return;
              setError('');
              setPending(true);
              try {
                await signIn(login, password);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : 'Не удалось войти. Попробуйте ещё раз.',
                );
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="auth-field">
              Логин
              <div>
                <UserRound size={17} />
                <input
                  autoFocus
                  autoComplete="username"
                  name="username"
                  value={login}
                  onChange={(event) => {
                    setLogin(event.target.value);
                    setError('');
                  }}
                  placeholder="Введите логин"
                  required
                  maxLength={40}
                  spellCheck={false}
                  autoCapitalize="none"
                  disabled={pending}
                />
              </div>
            </label>
            <label className="auth-field">
              Пароль
              <div>
                <KeyRound size={17} />
                <input
                  autoComplete="current-password"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError('');
                  }}
                  placeholder="Введите пароль"
                  required
                  disabled={pending}
                />
                <button
                  type="button"
                  aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            <div className="auth-login-meta">
              <span>Вход сохраняется</span>
              <button type="button" onClick={() => setHelp(!help)} aria-expanded={help}>
                Забыли пароль?
              </button>
            </div>
            {help && (
              <p className="auth-help" role="status">
                Обратитесь к администратору офиса: он сбросит пароль и выдаст новый.
              </p>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="auth-primary" disabled={pending} type="submit">
              {pending ? (
                <>
                  <LoaderCircle size={18} className="auth-spinner" />
                  Входим…
                </>
              ) : (
                <>
                  Войти
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <p className="auth-account-note">
            Учётные записи создаёт администратор.
            <br />
            Самостоятельная регистрация не требуется.
          </p>
        </div>
      </section>
    </main>
  );
}
