import { Spinner } from '../../shared/atoms';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, UserRound } from 'lucide-react';
import { Styles, Button, IconButton } from '../../shared/atoms';
import { Notice } from '../../shared/molecules';
import { useLogin } from '../hooks/useLogin';
import { LoginIllustration } from '../molecules/LoginIllustration';
import { CredentialField } from '../molecules/CredentialField';
import { AuthBrand } from '../atoms/AuthBrand';
export function LoginScreen() {
  const {
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
  } = useLogin();
  return (
    <>
      <Styles id="login-screen">{styles}</Styles>
      <main className="auth-page">
        <LoginIllustration />
        <section className="auth-entry">
          <AuthBrand className="auth-mobile-brand" />
          <div className="auth-login-card">
            <span className="auth-page-tag">
              <LockKeyhole size={13} />
              Внутренний сервис
            </span>
            <h2>Вход в Планировку</h2>
            <p className="auth-intro">Введите данные, которые выдал администратор.</p>
            <form onSubmit={submit}>
              <CredentialField
                label="Логин"
                leading={<UserRound size={17} />}
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
              <CredentialField
                label="Пароль"
                leading={<KeyRound size={17} />}
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
                action={
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </IconButton>
                }
              />
              <div className="auth-login-meta">
                <span>Вход сохраняется</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHelp(!help)}
                  aria-expanded={help}
                >
                  Забыли пароль?
                </Button>
              </div>
              {help && (
                <Notice className="auth-login-notice">
                  Обратитесь к администратору офиса: он сбросит пароль и выдаст новый.
                </Notice>
              )}
              {error && (
                <Notice tone="error" className="auth-login-notice">
                  {error}
                </Notice>
              )}
              <Button
                variant="primary"
                className="auth-login-submit"
                disabled={pending}
                type="submit"
              >
                {pending ? (
                  <>
                    <Spinner size={18} />
                    Входим…
                  </>
                ) : (
                  <>
                    Войти
                    <ArrowRight size={18} />
                  </>
                )}
              </Button>
            </form>
            <p className="auth-account-note">
              Учётные записи создаёт администратор.
              <br />
              Самостоятельная регистрация не требуется.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
const styles = String.raw`
.auth-page {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(420px, 1fr) minmax(440px, 1fr);
  background: #fff;
}

.auth-kicker {
  color: #8189b3;
  letter-spacing: 2px;
  font-size: 10px;
  font-weight: 750;
}

.chair-0 {
  left: 29%;
  top: 41px;
}

.chair-1 {
  right: 29%;
  top: 41px;
}

.chair-2 {
  left: 29%;
  top: 140px;
  transform: rotate(180deg);
}

.chair-3 {
  right: 29%;
  top: 140px;
  transform: rotate(180deg);
}

.auth-entry {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 45px 35px;
  min-height: 790px;
}

.auth-login-card {
  width: 100%;
  max-width: 370px;
}

.auth-page-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #8d97af;
  background: #f6f7fb;
  border: 1px solid #edf0f5;
  border-radius: 7px;
  padding: 7px 9px;
}

.auth-login-card h2 {
  font-size: 27px;
  letter-spacing: -1px;
  margin: 22px 0 10px;
  color: #34415b;
}

.auth-intro {
  font-size: 12px;
  color: #97a1b4;
  line-height: 1.7;
  margin: 0 0 31px;
}

.auth-login-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin: 16px 0 25px;
  font-size: 10px;
  color: #a2abba;
}

.auth-login-meta button {
  padding: 0;
  color: #7f88cb;
  font-size: 10px;
}

.auth-account-note {
  font-size: 10px;
  color: #a6aebf;
  line-height: 1.9;
  text-align: center;
  margin: 21px 0 0;
}

.auth-mobile-brand {
  display: none;
}
@media (max-width: 1000px) {
  .auth-page {
    grid-template-columns: 1fr 1fr;
  }

  .auth-entry {
    padding: 35px;
    min-height: 750px;
  }
}
@media (max-width: 760px) {
  .auth-page {
    display: block;
  }

  .auth-entry {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 25px 35px;
  }

  .auth-mobile-brand {
    display: flex;
    align-self: flex-start;
    font-size: 22px;
    margin-bottom: 48px;
  }

  .auth-login-card {
    margin: auto;
    max-width: 390px;
  }

  .auth-login-card h2 {
    font-size: 27px;
  }
}

.auth-login-submit.ui-button {
  width: 100%;
  min-height: 46px;
  font-size: 12px;
}
.auth-login-meta .ui-button {
  font-size: 10px;
  padding: 0;
  min-height: 0;
  color: #7f88cb;
}
.auth-login-notice {
  margin: 16px 0;
}
`;
