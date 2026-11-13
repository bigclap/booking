import { Spinner } from '../../shared/atoms';
import { CalendarDays, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Button, IconButton, Styles } from '../../shared/atoms';
import { useUserMenu } from '../hooks/useUserMenu';
import { ProfileDialog } from './ProfileDialog';
export default function UserMenu({ area = 'client' }: { area?: 'client' | 'admin' }) {
  const state = useUserMenu();
  const { user, open, setOpen, logoutPending, logoutError, wrap, trigger, openProfile, logout } =
    state;
  if (!user) return null;
  const initials = (user.firstName[0] + user.lastName[0]).toLocaleUpperCase('ru');
  return (
    <>
      <Styles id="account-menu">{styles}</Styles>
      <div className="account-menu-wrap" ref={wrap}>
        <IconButton
          ref={trigger}
          className="account-avatar"
          aria-label="Открыть профиль"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen(!open)}
          style={{
            borderRadius: '50%',
            background: '#eef0fb',
            color: '#8993bc',
            border: 0,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {initials}
        </IconButton>
        {open && (
          <div className="account-menu">
            <div className="account-menu-identity">
              <b>
                {user.firstName} {user.lastName}
              </b>
              <small>@{user.login}</small>
              <span>{user.role === 'admin' ? 'Администратор' : 'Сотрудник'}</span>
            </div>
            <Button variant="ghost" onClick={openProfile} disabled={logoutPending}>
              <UserRound size={16} />
              Мой профиль
            </Button>
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
            <Button
              variant="ghost"
              className="account-logout"
              disabled={logoutPending}
              aria-busy={logoutPending}
              onClick={() => void logout()}
            >
              {logoutPending ? <Spinner size={16} /> : <LogOut size={16} />}{' '}
              {logoutPending ? 'Выходим…' : 'Выйти'}
            </Button>
            {logoutError && (
              <p className="account-menu-error" role="alert">
                {logoutError}
              </p>
            )}
          </div>
        )}
      </div>
      <ProfileDialog state={state} />
    </>
  );
}
const styles = String.raw`
.account-menu-wrap {
  position: relative;
  flex-shrink: 0;
}
.account-avatar[aria-expanded='true'] {
  box-shadow: 0 0 0 3px #edf0fb;
}
.account-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 12px);
  z-index: 160;
  width: 245px;
  padding: 9px;
  border: 1px solid #e1e7f1;
  border-radius: 11px;
  box-shadow: 0 12px 35px #3f567721;
  background: #fff;
  color: #7e8ea8;
}
.account-menu-identity {
  padding: 12px 11px 14px;
  border-bottom: 1px solid #edf0f5;
  margin-bottom: 5px;
}
.account-menu-identity b {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #6a7b97;
}
.account-menu-identity small {
  display: block;
  font-size: 10px;
  margin-top: 5px;
  color: #a0adc0;
}
.account-menu-identity > span {
  display: inline-block;
  background: #f2f4fb;
  color: #94a0bc;
  padding: 4px 6px;
  border-radius: 5px;
  font-size: 8px;
  margin-top: 10px;
}
.account-menu > .ui-button,
.account-menu > a {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  text-decoration: none;
  text-align: left;
  padding: 10px 11px;
  font-size: 11px;
  font-weight: 500;
  border: 0;
  border-radius: 6px;
  color: #8594ae;
}
.account-menu > .ui-button:hover,
.account-menu > a:hover {
  background: #f5f7fc;
}
.account-menu .account-logout {
  color: #b2858c;
}
.account-menu-error {
  font-size: 10px;
  color: #b2838b;
  line-height: 1.7;
  margin: 7px 10px;
}
.account-menu button:disabled {
  opacity: 0.5;
  cursor: default;
}
`;
