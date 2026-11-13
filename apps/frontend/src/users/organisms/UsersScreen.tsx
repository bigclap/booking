import { PageHeading } from '../../shared/molecules';
import { Badge } from '../../shared/atoms';
import { ArrowUpRight, Plus, ShieldCheck, UserCheck, UserRoundX, UsersRound } from 'lucide-react';
import { Button, Styles, Spinner } from '../../shared/atoms';
import { AdminShell } from '../../office/organisms';
import type { UsersPageState } from '../hooks/useUsersPage';
import { fullName } from '../lib/presentation';
import { AccessOperationReceipt } from '../molecules/AccessOperationReceipt';
import { UserEditor } from './UserEditor';
import { UsersTable } from './UsersTable';
export function UsersScreen({ state }: { state: UsersPageState }) {
  const { auth, access, officeError, panel, users, displayedOperations, activeCount, openPanel } =
    state;
  const overlays = <UserEditor state={state} />;
  return (
    <>
      <Styles id="usersscreen">{styles}</Styles>
      <div className="users-slice-root" style={{ display: 'contents' }}>
        <AdminShell section="users" overlays={overlays}>
          {auth.ready && auth.user?.role !== 'admin' ? (
            <section className="adm-access-empty">
              <ShieldCheck size={34} />
              <h1>Доступ ограничен</h1>
              <p>Управление пользователями доступно администратору.</p>
              <a href="/booking">
                Перейти к бронированию <ArrowUpRight size={15} />
              </a>
            </section>
          ) : (
            <>
              <PageHeading
                eyebrow="ДОСТУП К ПРОСТРАНСТВУ"
                title={
                  <>
                    Пользователи <Badge tone="accent">{users.length}</Badge>
                  </>
                }
                description="Сотрудники, роли и доступ к офисам."
                actions={
                  <Button
                    variant="primary"
                    onClick={() => openPanel({ mode: 'create' })}
                    disabled={!auth.ready}
                  >
                    <Plus size={17} />
                    Добавить пользователя
                  </Button>
                }
              />

              <div className="adm-overview">
                <div>
                  <span className="adm-overview-icon">
                    <UsersRound size={19} />
                  </span>
                  <div>
                    <b>{users.length}</b>
                    <span>Всего пользователей</span>
                  </div>
                </div>
                <div>
                  <span className="adm-overview-icon is-green">
                    <UserCheck size={19} />
                  </span>
                  <div>
                    <b>{activeCount}</b>
                    <span>Активных</span>
                  </div>
                </div>
                <div>
                  <span className="adm-overview-icon is-neutral">
                    <UserRoundX size={19} />
                  </span>
                  <div>
                    <b>{users.length - activeCount}</b>
                    <span>Доступ отключён</span>
                  </div>
                </div>
              </div>

              {auth.error && !panel && (
                <div className="adm-error" role="alert">
                  {auth.error}
                </div>
              )}
              {officeError && officeError !== auth.error && !panel && (
                <div className="adm-error" role="alert">
                  {officeError}
                </div>
              )}

              {(access.loading || access.error || displayedOperations.length > 0) && (
                <section
                  className="adm-access-operations"
                  aria-label="Отзыв доступа и обработка броней"
                >
                  <div className="adm-access-operations-heading">
                    <div>
                      <h2>Отзыв доступа</h2>
                      <p>После изменения прав сервер отдельно освобождает брони.</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="adm-secondary"
                      onClick={() => void access.refresh()}
                    >
                      Проверить состояние
                    </Button>
                  </div>
                  {access.error && (
                    <div className="adm-access-check-error" role="alert">
                      <span>Не удалось обновить состояние отзыва доступа.</span>
                      <Button variant="ghost" size="sm" onClick={() => void access.refresh()}>
                        Повторить проверку
                      </Button>
                    </div>
                  )}
                  {access.loading && displayedOperations.length === 0 && (
                    <p className="adm-access-loading" role="status">
                      <Spinner size={15} />
                      Проверяем состояние отзыва доступа…
                    </p>
                  )}
                  <div className="adm-access-receipts" aria-live="polite">
                    {displayedOperations.map((operation) => {
                      const person = users.find((user) => user.id === operation.user_id);
                      return (
                        <AccessOperationReceipt
                          key={operation.id}
                          operation={operation}
                          name={person ? fullName(person) : 'Сотрудник'}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              <UsersTable state={state} />
            </>
          )}
        </AdminShell>
      </div>
    </>
  );
}

const styles = String.raw`
.users-slice-root .adm-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 25px;
}
.users-slice-root .adm-overview > div {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 19px 22px;
  border: 1px solid #e5eaf3;
  background: #fff;
  border-radius: 11px;
  box-shadow: 0 2px 7px #4e627e03;
}
.users-slice-root .adm-overview-icon {
  width: 41px;
  height: 41px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: #f0f2fd;
  color: #8d98dc;
  border-radius: 11px;
}
.users-slice-root .adm-overview-icon.is-green {
  background: #eff7f2;
  color: #91b29e;
}
.users-slice-root .adm-overview-icon.is-neutral {
  background: #f5f6f9;
  color: #a1aabd;
}
.users-slice-root .adm-overview b {
  display: block;
  font-size: 23px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.6px;
  color: #53627d;
}
.users-slice-root .adm-overview > div > div > span {
  display: block;
  font-size: 10px;
  line-height: 1.5;
  color: #96a3b7;
  margin-top: 5px;
}
.users-slice-root .adm-local-note {
  font-size: 9px;
  line-height: 1.7;
  color: #a7b1c2;
  margin-top: 16px;
}
.users-slice-root .adm-access-empty {
  text-align: center;
  padding: 90px 20px;
  color: #9aa9c9;
}
.users-slice-root .adm-access-empty h1 {
  font-size: 23px;
  color: #6e7e99;
  margin: 20px 0 12px;
}
.users-slice-root .adm-access-empty p {
  font-size: 12px;
  color: #929fb4;
}
.users-slice-root .adm-access-empty a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #8391cd;
  font-size: 11px;
  margin-top: 10px;
}

@keyframes adm-panel-enter {
  from {
    transform: translateX(24px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
@media (max-width: 1200px) {
  .users-slice-root .adm-overview > div {
    padding: 17px;
  }
}
@media (max-width: 1020px) {
  .users-slice-root .adm-overview {
    gap: 10px;
  }
  .users-slice-root .adm-overview > div {
    padding: 14px 12px;
    gap: 10px;
  }
  .users-slice-root .adm-overview-icon {
    height: 34px;
    width: 34px;
    border-radius: 10px;
  }
  .users-slice-root .adm-overview b {
    font-size: 21px;
  }
  .users-slice-root .adm-overview > div > div > span {
    font-size: 8px;
  }
}
@media (max-width: 760px) {
  .users-slice-root .adm-overview {
    margin-bottom: 20px;
  }
  .users-slice-root .adm-overview > div {
    gap: 8px;
    padding: 13px 10px;
  }
  .users-slice-root .adm-overview-icon {
    width: 29px;
    height: 29px;
    border-radius: 8px;
  }
  .users-slice-root .adm-overview-icon > svg {
    height: 16px;
    width: 16px;
  }
  .users-slice-root .adm-overview b {
    font-size: 19px;
  }
  .users-slice-root .adm-overview > div > div > span {
    font-size: 7px;
  }
  .users-slice-root .adm-local-note {
    font-size: 8px;
  }
}
@media (max-width: 570px) {
  .users-slice-root .adm-overview {
    gap: 7px;
  }
  .users-slice-root .adm-overview > div {
    padding: 12px 9px;
    align-items: flex-start;
    gap: 8px;
    flex-direction: column;
  }
  .users-slice-root .adm-overview-icon {
    height: 27px;
    width: 27px;
  }
  .users-slice-root .adm-overview b {
    font-size: 21px;
  }
  .users-slice-root .adm-overview > div > div > span {
    font-size: 8px;
  }
  .users-slice-root .adm-access-empty {
    padding: 65px 15px;
  }
  .users-slice-root .adm-access-empty h1 {
    font-size: 21px;
  }
}
.users-slice-root .adm-access-operations {
  margin-bottom: 22px;
  padding: 18px 20px;
  border: 1px solid #e3e8f2;
  border-radius: 12px;
  background: #fff;
  min-width: 0;
}
.users-slice-root .adm-access-operations-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 13px;
}
.users-slice-root .adm-access-operations-heading > div {
  min-width: 0;
}
.users-slice-root .adm-access-operations-heading h2 {
  font-size: 13px;
  font-weight: 700;
  color: #677893;
  margin: 0 0 5px;
}
.users-slice-root .adm-access-operations-heading p {
  font-size: 10px;
  line-height: 1.7;
  color: #95a2b8;
  margin: 0;
}
.users-slice-root .adm-access-operations-heading > button {
  font-size: 10px;
  min-height: 34px;
  padding: 8px 11px;
  flex-shrink: 0;
}
.users-slice-root .adm-access-receipts {
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-height: 295px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #dce3f0 transparent;
}
.users-slice-root .adm-access-check-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #efdfe2;
  background: #fff9fa;
  color: #b08590;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 11px;
  font-size: 10px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.users-slice-root .adm-access-check-error > button {
  font-size: 10px;
  color: #a06d7c;
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 3px 0;
  flex-shrink: 0;
}
.users-slice-root .adm-access-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  line-height: 1.7;
  color: #9aa5ba;
  margin: 8px 0;
}
.users-slice-root .adm-access-panel-status > .adm-access-check-error {
  margin: 10px 0 0;
  display: block;
}
.users-slice-root .adm-access-panel-status > .adm-access-check-error > button {
  display: block;
  margin-top: 5px;
}
@media (max-width: 570px) {
  .users-slice-root .adm-access-operations {
    padding: 15px 13px;
    margin-bottom: 18px;
  }
  .users-slice-root .adm-access-operations-heading {
    display: block;
  }
  .users-slice-root .adm-access-operations-heading > button {
    margin-top: 10px;
  }
  .users-slice-root .adm-access-check-error {
    display: block;
  }
  .users-slice-root .adm-access-check-error > button {
    display: block;
    margin-top: 5px;
  }
}
`;
