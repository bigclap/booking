import { Spinner } from '../../shared/atoms';
import { Eye, EyeOff, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { Button, IconButton, Styles } from '../../shared/atoms';
import { Dialog, Notice } from '../../shared/molecules';
import { CredentialField } from '../molecules/CredentialField';
import type { UserMenuState } from '../hooks/useUserMenu';
export function ProfileDialog({ state }: { state: UserMenuState }) {
  const {
    user,
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
    closeProfile,
    submitPassword,
  } = state;
  if (!user) return null;
  return (
    <>
      <Styles id="account-profile">{styles}</Styles>
      <Dialog
        open={profile}
        onClose={closeProfile}
        busy={pending}
        className="account-profile"
        bodyClassName="account-profile-scroll"
        labelledBy="profile-title"
        closeLabel="Закрыть профиль"
      >
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
        <form onSubmit={submitPassword}>
          <h3>
            <KeyRound size={17} />
            Смена пароля
          </h3>
          <CredentialField
            label="Текущий пароль"
            required
            autoComplete="current-password"
            type={visible ? 'text' : 'password'}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            disabled={pending}
          />
          <CredentialField
            label="Новый пароль"
            required
            minLength={8}
            autoComplete="new-password"
            type={visible ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Не менее 8 символов"
            disabled={pending}
            action={
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={visible ? 'Скрыть пароли' : 'Показать пароли'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </IconButton>
            }
          />
          <CredentialField
            label="Повторите новый пароль"
            required
            minLength={8}
            autoComplete="new-password"
            type={visible ? 'text' : 'password'}
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            disabled={pending}
          />
          <p className="account-password-note">
            После смены пароля нужно войти заново на всех устройствах.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            type="submit"
            variant="primary"
            disabled={pending}
            className="account-password-submit"
          >
            {pending ? <Spinner size={17} /> : null}Изменить пароль
          </Button>
        </form>
      </Dialog>
    </>
  );
}
const styles = String.raw`
.account-profile.ui-dialog-panel {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.account-profile-scroll {
  padding: 28px;
}
.account-profile-scroll > h2 {
  padding-right: 34px;
}
.account-profile-scroll > p {
  font-size: 12px;
  color: #8794ac;
}
.account-profile-icon {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  border-radius: 13px;
  background: #f0f2fb;
  color: #8b95cd;
  margin-bottom: 18px;
}
.account-profile h2 {
  font-size: 24px;
  color: #51627e;
  letter-spacing: -0.7px;
  margin: 0 0 10px;
}
.account-details {
  display: flex;
  flex-direction: column;
  gap: 13px;
  margin: 23px 0;
  border-bottom: 1px solid #ebeff5;
  padding-bottom: 24px;
}
.account-details > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
}
.account-details span {
  color: #a0acc0;
}
.account-details b {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #8190aa;
  font-weight: 600;
}
.account-profile h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #8391ad;
  margin: 0 0 18px;
}
.account-password-note {
  font-size: 10px;
  line-height: 1.7;
  color: #a4aec0;
  margin: 17px 0 24px;
}
.account-password-submit.ui-button {
  width: 100%;
  min-height: 43px;
  margin-top: 14px;
}
@media (max-width: 760px) {
  .account-profile-scroll {
    padding: 24px;
  }
}
`;
