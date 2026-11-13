import { SearchField } from '../../shared/molecules';
import { Button, IconButton } from '../../shared/atoms';
import { Spinner } from '../../shared/atoms';
import { Building2, Pencil, Search, ShieldCheck } from 'lucide-react';
import type { UsersPageState } from '../hooks/useUsersPage';

import { Select, Styles } from '../../shared/atoms';
import { fullName, initials } from '../lib/presentation';

export function UsersTable({ state }: { state: UsersPageState }) {
  const {
    auth,
    search,
    setSearch,
    status,
    setStatus,
    users,
    operationByUser,
    query,
    filteredUsers,
    openPanel,
    officeAccessLabel,
  } = state;
  return (
    <>
      <Styles id="userstable">{styles}</Styles>{' '}
      <section className="adm-user-list" aria-label="Список пользователей">
        <div className="adm-list-toolbar">
          <SearchField
            className="adm-search"
            aria-label="Поиск пользователей"
            placeholder="Найти по имени или логину"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
          />

          <label className="adm-status-filter">
            <span>Статус</span>
            <Select
              aria-label="Фильтр по статусу"
              value={status}
              onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'inactive')}
            >
              <option value="all">Все пользователи</option>
              <option value="active">Активные</option>
              <option value="inactive">Доступ отключён</option>
            </Select>
          </label>
        </div>
        <div className="adm-table-head" aria-hidden="true">
          <span>Пользователь</span>
          <span>Логин</span>
          <span>Роль</span>
          <span>Доступ</span>
          <span>Статус</span>
          <span />
        </div>
        {!auth.ready ? (
          <div className="adm-list-empty">
            <Spinner size={25} />
            <h2>Загружаем пользователей</h2>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="adm-list-empty">
            <Search size={27} />
            <h2>{query || status !== 'all' ? 'Никого не нашли' : 'Пользователей пока нет'}</h2>
            <p>
              {query || status !== 'all'
                ? 'Попробуйте другой запрос или измените статус.'
                : 'Добавьте первого сотрудника, чтобы выдать ему доступ.'}
            </p>
            {(query || status !== 'all') && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                }}
              >
                Сбросить фильтры
              </Button>
            )}
          </div>
        ) : (
          <div className="adm-table-body">
            {filteredUsers.map((person) => (
              <div
                key={person.id}
                className={`adm-user-row${!person.active ? ' is-inactive' : ''}`}
              >
                <div className="adm-person-cell">
                  <span className={`adm-user-avatar${person.role === 'admin' ? ' is-admin' : ''}`}>
                    {initials(person)}
                  </span>
                  <div>
                    <b>
                      {fullName(person)}
                      {person.id === auth.user?.id && <small>Вы</small>}
                    </b>
                    <span>{person.role === 'admin' ? 'Администратор сервиса' : 'Сотрудник'}</span>
                  </div>
                </div>
                <div className="adm-login-cell" data-label="Логин">
                  <span>@{person.login}</span>
                </div>
                <div data-label="Роль">
                  <span className={`adm-role-badge${person.role === 'admin' ? ' is-admin' : ''}`}>
                    {person.role === 'admin' && <ShieldCheck size={12} />}
                    {person.role === 'admin' ? 'Администратор' : 'Сотрудник'}
                  </span>
                </div>
                <div
                  className="adm-building-cell"
                  data-label="Доступ"
                  title={officeAccessLabel(person).title}
                >
                  <Building2 size={14} />
                  <span>
                    {officeAccessLabel(person).label}
                    {officeAccessLabel(person).more > 0 && (
                      <small>и ещё {officeAccessLabel(person).more}</small>
                    )}
                  </span>
                </div>
                <div data-label="Статус">
                  <span className={`adm-status-badge${person.active ? ' is-active' : ''}`}>
                    <i />
                    {person.active ? 'Активен' : 'Отключён'}
                  </span>
                  {operationByUser.has(person.id) && (
                    <small
                      className={`adm-user-revocation${operationByUser.get(person.id)!.status === 'completed' ? ' is-completed' : ''}`}
                    >
                      {operationByUser.get(person.id)!.status === 'completed'
                        ? 'Отзыв завершён'
                        : 'Отзыв выполняется'}
                    </small>
                  )}
                </div>
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="adm-edit-button"
                  aria-label={`Редактировать пользователя ${fullName(person)}`}
                  title="Редактировать пользователя"
                  onClick={() => openPanel({ mode: 'edit', id: person.id }, person)}
                >
                  <Pencil size={16} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <div className="adm-list-footer">
          <span>
            Показано {filteredUsers.length} из {users.length}
          </span>
          <span>Учётные записи создаются только через админку</span>
        </div>
      </section>
    </>
  );
}

const styles = String.raw`
.users-slice-root .adm-user-list {
  border: 1px solid #e3e9f2;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 16px #4f668405;
}
.users-slice-root .adm-list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px;
}
.users-slice-root .adm-status-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  color: #a0aabd;
  font-size: 10px;
}
.users-slice-root .adm-status-filter select {
  border: 1px solid #e2e8f2;
  background: #fff;
  border-radius: 7px;
  padding: 10px 25px 10px 10px;
  color: #8291ab;
  font-size: 10px;
  max-width: 180px;
}
.users-slice-root .adm-table-head,
.users-slice-root .adm-user-row {
  display: grid;
  grid-template-columns:
    minmax(200px, 1.7fr) minmax(110px, 1fr) minmax(115px, 0.9fr) minmax(130px, 1.1fr)
    102px 32px;
  gap: 14px;
  align-items: center;
  padding: 0 22px;
}
.users-slice-root .adm-table-head {
  height: 40px;
  background: #fafbfe;
  border-top: 1px solid #edf0f5;
  border-bottom: 1px solid #edf0f5;
  color: #9aa7bc;
  font-size: 9px;
  font-weight: 650;
}
.users-slice-root .adm-user-row {
  min-height: 78px;
  border-bottom: 1px solid #edf0f5;
  position: relative;
  font-size: 11px;
  color: #8391a9;
  transition: background 0.15s;
}
.users-slice-root .adm-user-row:hover {
  background: #fcfdff;
}
.users-slice-root .adm-user-row:last-child {
  border-bottom: 0;
}
.users-slice-root .adm-user-row > div {
  min-width: 0;
}
.users-slice-root .adm-person-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}
.users-slice-root .adm-user-avatar {
  height: 36px;
  width: 36px;
  flex-shrink: 0;
  border-radius: 11px;
  background: #f0f3f8;
  color: #8b9ab3;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
}
.users-slice-root .adm-user-avatar.is-admin {
  color: #8c94d0;
  background: #f0f0fc;
}
.users-slice-root .adm-person-cell > div {
  min-width: 0;
}
.users-slice-root .adm-person-cell b {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #5c6c87;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.users-slice-root .adm-person-cell b > small {
  font-size: 8px;
  font-weight: 500;
  background: #f2f4f9;
  color: #9aa6bc;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}
.users-slice-root .adm-person-cell > div > span {
  font-size: 9px;
  color: #a1adbf;
  display: block;
  margin-top: 3px;
}
.users-slice-root .adm-login-cell {
  font-size: 10px;
  color: #8e9bb1;
  overflow-wrap: anywhere;
}
.users-slice-root .adm-role-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #f5f7fb;
  color: #8b99b1;
  padding: 5px 7px;
  border: 1px solid #edf0f5;
  border-radius: 5px;
  font-size: 8px;
  white-space: nowrap;
}
.users-slice-root .adm-role-badge.is-admin {
  background: #f4f3fd;
  border-color: #eceafa;
  color: #9396c7;
}
.users-slice-root .adm-building-cell {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 9px;
  color: #8d9bb1;
  line-height: 1.6;
}
.users-slice-root .adm-building-cell > svg {
  flex-shrink: 0;
  margin-top: 1px;
  color: #a2aec2;
}
.users-slice-root .adm-building-cell > span {
  overflow-wrap: anywhere;
}
.users-slice-root .adm-building-cell small {
  display: block;
  font-size: 8px;
  color: #a5afbf;
}
.users-slice-root .adm-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  color: #a3aabb;
  white-space: nowrap;
}
.users-slice-root .adm-status-badge > i {
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
}
.users-slice-root .adm-status-badge.is-active {
  color: #91ac9b;
}
.users-slice-root .adm-edit-button {
  height: 31px;
  width: 31px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: #a3adc1;
  border: 1px solid transparent;
  background: transparent;
}
.users-slice-root .adm-edit-button:hover {
  background: #f0f2fd;
  color: #8491d0;
  border-color: #e5e9f9;
}
.users-slice-root .adm-user-row.is-inactive .adm-user-avatar {
  background: #f5f6f9;
  color: #aab1c0;
}
.users-slice-root .adm-user-row.is-inactive .adm-person-cell b {
  color: #929eb2;
}
.users-slice-root .adm-list-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  border-top: 1px solid #edf0f5;
  padding: 13px 22px;
  color: #a5afc0;
  font-size: 9px;
}
.users-slice-root .adm-list-empty {
  min-height: 230px;
  padding: 40px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  color: #acb7cd;
}
.users-slice-root .adm-list-empty h2 {
  font-size: 15px;
  font-weight: 650;
  color: #7d8da8;
  margin: 15px 0 6px;
}
.users-slice-root .adm-list-empty p {
  font-size: 11px;
  line-height: 1.7;
  color: #a1adc0;
  margin: 0;
  max-width: 330px;
}
.users-slice-root .adm-list-empty > button {
  font-size: 10px;
  color: #8c99d0;
  padding: 12px 0 0;
}
@media (max-width: 1200px) {
  .users-slice-root .adm-table-head,
  .users-slice-root .adm-user-row {
    grid-template-columns:
      minmax(170px, 1.5fr) minmax(90px, 0.8fr) 110px minmax(105px, 1fr)
      87px 30px;
    gap: 10px;
    padding-left: 17px;
    padding-right: 17px;
  }
  .users-slice-root .adm-role-badge {
    font-size: 7px;
  }
  .users-slice-root .adm-person-cell {
    gap: 9px;
  }
  .users-slice-root .adm-user-avatar {
    width: 32px;
    height: 32px;
    font-size: 10px;
  }
  .users-slice-root .adm-person-cell b {
    font-size: 10px;
  }
}
@media (max-width: 1020px) {
  .users-slice-root .adm-table-head {
    display: none;
  }
  .users-slice-root .adm-table-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 16px;
  }
  .users-slice-root .adm-user-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 12px;
    border: 1px solid #e7ebf3 !important;
    border-radius: 9px;
    padding: 16px;
    align-items: start;
    min-height: 170px;
  }
  .users-slice-root .adm-person-cell {
    grid-column: 1/-1;
    padding-right: 25px;
  }
  .users-slice-root .adm-person-cell b {
    font-size: 11px;
  }
  .users-slice-root .adm-user-avatar {
    width: 35px;
    height: 35px;
  }
  .users-slice-root .adm-user-row > div[data-label]:before {
    content: attr(data-label);
    display: block;
    font-size: 8px;
    color: #a9b3c4;
    margin-bottom: 6px;
  }
  .users-slice-root .adm-user-row .adm-building-cell {
    display: block;
  }
  .users-slice-root .adm-building-cell > svg {
    display: none;
  }
  .users-slice-root .adm-edit-button {
    position: absolute;
    right: 10px;
    top: 17px;
  }
  .users-slice-root .adm-login-cell {
    grid-column: 1/2;
  }
  .users-slice-root .adm-role-badge {
    font-size: 8px;
  }
  .users-slice-root .adm-list-toolbar {
    padding: 16px;
    gap: 12px;
  }
  .users-slice-root .adm-status-filter > span {
    display: none;
  }
  .users-slice-root .adm-status-filter select {
    max-width: 155px;
    font-size: 9px;
  }
  .users-slice-root .adm-list-footer {
    font-size: 8px;
    padding: 13px 17px;
  }
  .users-slice-root .adm-list-footer > span:last-child {
    max-width: 190px;
    text-align: right;
    line-height: 1.6;
  }
}
@media (max-width: 760px) {
  .users-slice-root .adm-table-body {
    padding: 13px;
    gap: 10px;
  }
  .users-slice-root .adm-user-row {
    padding: 14px 12px;
  }
  .users-slice-root .adm-list-toolbar {
    padding: 13px;
    gap: 9px;
  }
  .users-slice-root .adm-status-filter select {
    font-size: 8px;
    padding: 10px 20px 10px 8px;
    max-width: 130px;
  }
  .users-slice-root .adm-list-footer > span:last-child {
    max-width: 160px;
    font-size: 7px;
  }
}
@media (max-width: 570px) {
  .users-slice-root .adm-list-toolbar {
    flex-wrap: wrap;
  }
  .users-slice-root .adm-status-filter {
    width: 100%;
  }
  .users-slice-root .adm-status-filter > span {
    display: block;
    font-size: 9px;
  }
  .users-slice-root .adm-status-filter select {
    margin-left: auto;
    max-width: none;
    min-width: 155px;
    font-size: 9px;
  }
  .users-slice-root .adm-table-body {
    grid-template-columns: 1fr;
    padding: 11px;
  }
  .users-slice-root .adm-user-row {
    min-height: 160px;
    padding: 16px;
  }
  .users-slice-root .adm-person-cell b {
    font-size: 12px;
  }
  .users-slice-root .adm-person-cell > div > span {
    font-size: 9px;
  }
  .users-slice-root .adm-list-footer {
    align-items: flex-start;
    gap: 10px;
    font-size: 8px;
    padding: 12px 14px;
  }
  .users-slice-root .adm-list-footer > span:last-child {
    max-width: 150px;
  }
}
.users-slice-root .adm-user-revocation {
  display: block;
  font-size: 8px;
  line-height: 1.6;
  white-space: normal;
  color: #9b8fbd;
  margin-top: 5px;
}
.users-slice-root .adm-user-revocation.is-completed {
  color: #92a99c;
}
.users-slice-root .adm-search {
  flex: 1;
  min-width: 180px;
  max-width: 380px;
}
`;
