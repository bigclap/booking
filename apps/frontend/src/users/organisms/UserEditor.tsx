import { Spinner } from '../../shared/atoms';
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Plus,
  UserRoundX,
  X,
} from 'lucide-react';
import type { UsersPageState } from '../hooks/useUsersPage';
import type { AppUser } from '../../auth/types';
import { Button, Input, Select, Switch, Styles, IconButton } from '../../shared/atoms';
import { Field, Dialog } from '../../shared/molecules';
import { fullName } from '../lib/presentation';
import { AccessOperationReceipt } from '../molecules/AccessOperationReceipt';
import { PasswordInput } from '../molecules/PasswordInput';

export function UserEditor({ state }: { state: UsersPageState }) {
  const {
    access,
    offices,
    officeError,
    officeById,
    panel,
    draft,
    pending,
    panelError,
    confirmation,
    setConfirmation,
    success,
    setSuccess,
    resetOpen,
    setResetOpen,
    resetPassword,
    setResetPassword,
    resetConfirmation,
    setResetConfirmation,
    resetPending,
    resetError,
    setResetError,
    resetSuccess,
    setResetSuccess,
    operationByUser,
    editingUser,
    editingSelf,
    busy,
    closePanel,
    changeDraft,
    saveUser,
    submitUser,
    submitReset,
    handleResetKeyDown,
  } = state;
  return (
    <>
      <Styles id="usereditor">{styles}</Styles>
      <>
        {success && (
          <div className="adm-toast" role="status">
            <CheckCircle2 size={18} />
            <span>{success}</span>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Закрыть уведомление"
              onClick={() => setSuccess('')}
            >
              <X size={15} />
            </IconButton>
          </div>
        )}

        {panel && draft && (
          <Dialog
            open
            onClose={closePanel}
            busy={busy}
            placement="right"
            className="adm-user-dialog"
            role={confirmation ? 'alertdialog' : 'dialog'}
            title={
              confirmation
                ? 'Отключить пользователя?'
                : panel.mode === 'create'
                  ? 'Добавить пользователя'
                  : 'Редактировать пользователя'
            }
            eyebrow={
              confirmation
                ? 'ПРЕКРАЩЕНИЕ ДОСТУПА'
                : panel.mode === 'create'
                  ? 'НОВАЯ УЧЁТНАЯ ЗАПИСЬ'
                  : 'УЧЁТНАЯ ЗАПИСЬ'
            }
            closeLabel={confirmation ? 'Вернуться к редактированию' : 'Закрыть панель пользователя'}
            footer={
              confirmation ? undefined : (
                <div className="adm-panel-footer">
                  <Button
                    type="button"
                    variant="secondary"
                    className="adm-secondary"
                    onClick={closePanel}
                    disabled={busy}
                  >
                    Отмена
                  </Button>
                  <Button
                    form="user-editor-form"
                    type="submit"
                    variant="primary"
                    className="adm-primary"
                    disabled={busy}
                  >
                    {pending ? (
                      <Spinner size={16} />
                    ) : panel.mode === 'create' ? (
                      <Plus size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    {panel.mode === 'create' ? 'Создать пользователя' : 'Сохранить изменения'}
                  </Button>
                </div>
              )
            }
          >
            {confirmation ? (
              <div className="adm-deactivate-view">
                <span className="adm-deactivate-icon">
                  <UserRoundX size={29} />
                </span>
                <h3>{editingUser ? fullName(editingUser) : draft.login}</h3>
                <p id="adm-deactivate-description">
                  Пользователь потеряет доступ к сервису. Отмена будущих броней и завершение текущих
                  выполнятся в фоне. Результат появится в списке пользователей. Прошедшие брони
                  сохранятся в истории.
                </p>
                <p className="adm-muted">Учётная запись сохранится. Доступ можно включить снова.</p>
                {panelError && (
                  <div className="adm-error" role="alert">
                    {panelError}
                  </div>
                )}
                <div className="adm-deactivate-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    className="adm-secondary"
                    onClick={() => setConfirmation(false)}
                    disabled={pending}
                  >
                    Вернуться
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="adm-danger"
                    data-autofocus
                    onClick={() => void saveUser()}
                    disabled={pending}
                  >
                    {pending ? <Spinner size={16} /> : <UserRoundX size={16} />}
                    Отключить доступ
                  </Button>
                </div>
              </div>
            ) : (
              <form id="user-editor-form" className="adm-user-form" onSubmit={submitUser}>
                <fieldset className="adm-edit-fields" disabled={busy}>
                  <section className="adm-form-section">
                    <h3>Личные данные</h3>
                    <div className="adm-form-grid">
                      <Field className="adm-field" htmlFor="adm-first-name" label={<>Имя</>}>
                        <Input
                          id="adm-first-name"
                          value={draft.firstName}
                          onChange={(event) => changeDraft({ firstName: event.target.value })}
                          autoComplete="given-name"
                          required
                          maxLength={60}
                          data-autofocus
                        />
                      </Field>
                      <Field className="adm-field" htmlFor="adm-last-name" label={<>Фамилия</>}>
                        <Input
                          id="adm-last-name"
                          value={draft.lastName}
                          onChange={(event) => changeDraft({ lastName: event.target.value })}
                          autoComplete="family-name"
                          required
                          maxLength={60}
                        />
                      </Field>
                    </div>
                    <Field className="adm-field" htmlFor="adm-login" label={<>Логин</>}>
                      <div className="adm-login-input">
                        <span>@</span>
                        <Input
                          id="adm-login"
                          value={draft.login}
                          onChange={(event) => changeDraft({ login: event.target.value })}
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          required
                          minLength={3}
                          maxLength={40}
                        />
                      </div>
                      <small>Для входа в сервис. Email не требуется.</small>
                    </Field>
                  </section>

                  {panel.mode === 'create' && (
                    <section className="adm-form-section">
                      <h3>Пароль для первого входа</h3>
                      <PasswordInput
                        id="adm-create-password"
                        label="Пароль"
                        value={draft.password}
                        onChange={(password) => changeDraft({ password })}
                        required
                      />
                      <p className="adm-field-hint">
                        Минимум 8 символов. Передайте пароль сотруднику лично.
                      </p>
                    </section>
                  )}

                  <section className="adm-form-section">
                    <h3>Права доступа</h3>
                    <Field className="adm-field" htmlFor="adm-role" label={<>Роль</>}>
                      <Select
                        id="adm-role"
                        value={draft.role}
                        disabled={editingSelf}
                        onChange={(event) =>
                          changeDraft({ role: event.target.value as AppUser['role'] })
                        }
                      >
                        <option value="employee">Сотрудник</option>
                        <option value="admin">Администратор</option>
                      </Select>
                    </Field>
                    <p className="adm-field-hint">
                      {editingSelf
                        ? 'Свою роль изменить нельзя.'
                        : draft.role === 'admin'
                          ? 'Управление пользователями, конструктором и всеми зданиями.'
                          : 'Бронирование доступных рабочих мест и переговорных.'}
                    </p>
                    <div className="adm-office-access">
                      <div className="adm-office-access-title">
                        <Building2 size={17} />
                        <span>Доступ к офисам</span>
                      </div>
                      {officeError && (
                        <div className="adm-error" role="alert">
                          {officeError}
                        </div>
                      )}
                      {offices.length > 0 ? (
                        <div
                          className="adm-office-options"
                          role="group"
                          aria-label="Доступ пользователя к офисам"
                        >
                          {offices.map((building) => (
                            <label key={building.id}>
                              <input
                                type="checkbox"
                                checked={
                                  draft.role === 'admin' || draft.buildingIds.includes(building.id)
                                }
                                disabled={draft.role === 'admin'}
                                onChange={(event) =>
                                  changeDraft({
                                    buildingIds: event.target.checked
                                      ? [...new Set([...draft.buildingIds, building.id])]
                                      : draft.buildingIds.filter((id) => id !== building.id),
                                  })
                                }
                              />
                              <span>
                                <b>{building.name}</b>
                                {building.address && <small>{building.address}</small>}
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="adm-office-empty">
                          Офисов пока нет. <a href="/admin/offices">Добавить офис</a>
                        </p>
                      )}
                      {draft.role === 'admin' ? (
                        <small>Администратору доступны все офисы независимо от назначений.</small>
                      ) : draft.buildingIds.length === 0 ? (
                        <small>Пользователь сможет войти, но карты офисов будут недоступны.</small>
                      ) : draft.buildingIds.some((id) => !officeById.has(id)) ? (
                        <small>Назначения офисов вне списка сохранятся.</small>
                      ) : null}
                    </div>
                  </section>

                  {panel.mode === 'edit' && (
                    <section className="adm-form-section">
                      <h3>Состояние учётной записи</h3>
                      <label className={`adm-active-control${editingSelf ? ' is-disabled' : ''}`}>
                        <div>
                          <b>{draft.active ? 'Доступ включён' : 'Доступ отключён'}</b>
                          <span>
                            {editingSelf
                              ? 'Собственный доступ отключить нельзя.'
                              : draft.active
                                ? 'Пользователь может входить в сервис.'
                                : editingUser?.active
                                  ? 'При сохранении потребуется подтвердить отключение.'
                                  : 'Пользователь не может входить в сервис.'}
                          </span>
                        </div>
                        <Switch
                          type="checkbox"
                          role="switch"
                          aria-label="Доступ пользователя включён"
                          checked={draft.active}
                          disabled={editingSelf}
                          onChange={(event) => changeDraft({ active: event.target.checked })}
                        />
                      </label>
                    </section>
                  )}

                  {panel.mode === 'edit' && (operationByUser.has(panel.id) || access.error) && (
                    <section
                      className="adm-form-section adm-access-panel-status"
                      aria-label="Результат отзыва доступа"
                    >
                      {operationByUser.has(panel.id) && (
                        <AccessOperationReceipt operation={operationByUser.get(panel.id)!} />
                      )}
                      {access.error && (
                        <div className="adm-access-check-error" role="alert">
                          <span>Не удалось обновить состояние обработки.</span>
                          <Button variant="ghost" size="sm" onClick={() => void access.refresh()}>
                            Повторить проверку
                          </Button>
                        </div>
                      )}
                    </section>
                  )}

                  {panel.mode === 'edit' && (
                    <section className="adm-form-section adm-password-reset">
                      <Button
                        variant="ghost"
                        className="adm-reset-heading"
                        aria-expanded={resetOpen}
                        disabled={editingSelf}
                        onClick={() => {
                          setResetOpen(!resetOpen);
                          setResetError('');
                          setResetSuccess('');
                        }}
                      >
                        <KeyRound size={17} />
                        <span>Установить новый пароль</span>
                        <ChevronRight size={16} className={resetOpen ? 'is-open' : ''} />
                      </Button>
                      {editingSelf && (
                        <p className="adm-field-hint">Свой пароль можно изменить в меню профиля.</p>
                      )}
                      {resetOpen && !editingSelf && (
                        <div className="adm-reset-form" onKeyDown={handleResetKeyDown}>
                          <PasswordInput
                            id="adm-reset-password"
                            label="Новый пароль"
                            value={resetPassword}
                            minLength={0}
                            onChange={(value) => {
                              setResetPassword(value);
                              setResetError('');
                              setResetSuccess('');
                            }}
                          />
                          <PasswordInput
                            id="adm-reset-confirmation"
                            label="Повторите пароль"
                            value={resetConfirmation}
                            minLength={0}
                            onChange={(value) => {
                              setResetConfirmation(value);
                              setResetError('');
                              setResetSuccess('');
                            }}
                          />
                          {resetError && (
                            <div className="adm-error" role="alert">
                              {resetError}
                            </div>
                          )}
                          {resetSuccess && (
                            <div className="adm-inline-success" role="status">
                              <Check size={15} />
                              {resetSuccess}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="secondary"
                            className="adm-secondary"
                            onClick={() => void submitReset()}
                            disabled={busy || !resetPassword || !resetConfirmation}
                          >
                            {resetPending ? <Spinner size={15} /> : <KeyRound size={15} />}
                            Сохранить новый пароль
                          </Button>
                        </div>
                      )}
                    </section>
                  )}

                  {panelError && (
                    <div className="adm-error" role="alert">
                      {panelError}
                    </div>
                  )}
                </fieldset>
              </form>
            )}
          </Dialog>
        )}
      </>
    </>
  );
}

const styles = String.raw`
.users-slice-root .adm-error {
  padding: 11px 13px;
  border: 1px solid #efdadd;
  border-radius: 8px;
  background: #fff8f8;
  color: #b77f8a;
  font-size: 11px;
  line-height: 1.7;
  margin: 0 0 15px;
  overflow-wrap: anywhere;
}
.users-slice-root .adm-toast {
  position: fixed;
  right: 28px;
  top: 82px;
  z-index: 130;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 15px;
  max-width: calc(100vw - 30px);
  border: 1px solid #dce8e1;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 10px 30px #40577b16;
  color: #7a9988;
  font-size: 11px;
}
.users-slice-root .adm-toast > button {
  padding: 0 0 0 7px;
  display: grid;
  place-items: center;
  color: #a2afc0;
}
.users-slice-root .adm-user-form {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.users-slice-root .adm-form-section {
  margin-bottom: 25px;
  padding-bottom: 24px;
  border-bottom: 1px solid #eef1f6;
}
.users-slice-root .adm-form-section:last-child {
  border-bottom: 0;
}
.users-slice-root .adm-form-section h3 {
  font-size: 11px;
  font-weight: 700;
  color: #71819e;
  margin: 0 0 16px;
}
.users-slice-root .adm-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.users-slice-root .adm-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 13px;
  font-size: 10px;
  color: #8c9ab2;
  min-width: 0;
}
.users-slice-root .adm-field > span {
  font-weight: 600;
}
.users-slice-root .adm-field > input,
.users-slice-root .adm-field > select,
.users-slice-root .adm-login-input {
  width: 100%;
  min-width: 0;
  border: 1px solid #dfe6f0;
  border-radius: 7px;
  background: #fff;
  font-size: 12px;
  color: #657794;
  min-height: 40px;
}
.users-slice-root .adm-field > small {
  font-size: 9px;
  line-height: 1.7;
  color: #a6b0c2;
}
.users-slice-root .adm-login-input {
  display: flex;
  align-items: center;
  overflow: hidden;
}
.users-slice-root .adm-login-input:focus-within {
  border-color: #9fa9e3;
  box-shadow: 0 0 0 3px #f2f3ff;
}
.users-slice-root .adm-login-input > input {
  border: 0;
  outline: none !important;
  padding: 10px 11px;
  min-width: 0;
  width: 100%;
  background: transparent;
  color: #657794;
  font-size: 12px;
}
.users-slice-root .adm-login-input > span {
  padding-left: 12px;
  color: #b1bbce;
  font-size: 12px;
}
.users-slice-root .adm-login-input > input {
  padding-left: 6px;
}
.users-slice-root .adm-field-hint {
  font-size: 9px;
  color: #a2aec1;
  line-height: 1.7;
  margin: 0 0 12px;
}
.users-slice-root .adm-office-access {
  border: 1px solid #e4e9f2;
  background: #fafbfe;
  border-radius: 9px;
  padding: 13px 14px;
}
.users-slice-root .adm-office-access-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  font-weight: 600;
  color: #8a98b2;
  margin-bottom: 10px;
}
.users-slice-root .adm-office-options {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #d5ddef transparent;
  margin: 0 -4px;
  padding: 0 4px;
}
.users-slice-root .adm-office-options > label {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  cursor: pointer;
  font-size: 11px;
  color: #7c8da7;
  line-height: 1.6;
  padding: 10px 0;
  border-top: 1px solid #e9edf5;
}
.users-slice-root .adm-office-options > label:first-child {
  border-top: 0;
  padding-top: 3px;
}
.users-slice-root .adm-office-options > label:has(input:disabled) {
  cursor: default;
}
.users-slice-root .adm-office-options > label > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.users-slice-root .adm-office-options b {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #7c8da7;
}
.users-slice-root .adm-office-options small {
  display: block;
  font-size: 9px;
  font-weight: 400;
  color: #a0acc0;
  line-height: 1.6;
  margin-top: 3px;
}
.users-slice-root .adm-office-access input {
  margin: 2px 0 0;
  accent-color: #8793dc;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.users-slice-root .adm-office-access > small {
  display: block;
  margin-top: 10px;
  font-size: 9px;
  line-height: 1.7;
  color: #a6b1c3;
}
.users-slice-root .adm-office-empty {
  font-size: 10px;
  line-height: 1.7;
  color: #9ca9bf;
  margin: 0;
}
.users-slice-root .adm-office-empty > a {
  color: #8290cd;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.users-slice-root .adm-active-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  cursor: pointer;
}
.users-slice-root .adm-active-control b {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #8594ae;
}
.users-slice-root .adm-active-control span {
  display: block;
  font-size: 9px;
  line-height: 1.7;
  color: #a5b0c2;
  margin-top: 5px;
}
.users-slice-root .adm-active-control input {
  appearance: none;
  width: 32px;
  height: 19px;
  flex-shrink: 0;
  background: #dce2ed;
  border: 1px solid #d4ddea;
  border-radius: 20px;
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
}
.users-slice-root .adm-active-control input:before {
  content: '';
  position: absolute;
  height: 13px;
  width: 13px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #3f527325;
  top: 2px;
  left: 2px;
  transition: transform 0.15s;
}
.users-slice-root .adm-active-control input:checked {
  background: #929de3;
  border-color: #8895de;
}
.users-slice-root .adm-active-control input:checked:before {
  transform: translateX(13px);
}
.users-slice-root .adm-active-control.is-disabled {
  cursor: default;
}
.users-slice-root .adm-active-control input:disabled {
  opacity: 0.45;
  cursor: default;
}
.users-slice-root .adm-reset-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0;
  text-align: left;
  color: #8795c6;
  font-size: 10px;
  font-weight: 650;
}
.users-slice-root .adm-reset-heading > svg:last-child {
  margin-left: auto;
  transition: transform 0.15s;
}
.users-slice-root .adm-reset-heading > svg.is-open {
  transform: rotate(90deg);
}
.users-slice-root .adm-reset-heading:disabled {
  cursor: default;
  opacity: 0.55;
}
.users-slice-root .adm-password-reset > .adm-field-hint {
  margin-top: 9px;
  margin-bottom: 0;
}
.users-slice-root .adm-reset-form {
  padding-top: 18px;
}
.users-slice-root .adm-reset-form > .adm-secondary {
  width: 100%;
  margin-top: 2px;
}
.users-slice-root .adm-inline-success {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #83a590;
  background: #f4faf6;
  border: 1px solid #deeee3;
  font-size: 10px;
  padding: 9px 10px;
  border-radius: 7px;
  margin-bottom: 11px;
}
.users-slice-root .adm-deactivate-view {
  padding: 30px 28px;
  overflow: auto;
}
.users-slice-root .adm-deactivate-icon {
  height: 61px;
  width: 61px;
  display: grid;
  place-items: center;
  background: #fbf1f2;
  border: 1px solid #f5e5e8;
  border-radius: 17px;
  color: #c1919b;
  margin-bottom: 24px;
}
.users-slice-root .adm-deactivate-view h3 {
  font-size: 19px;
  color: #61718a;
  letter-spacing: -0.4px;
  font-weight: 700;
  margin: 0 0 14px;
}
.users-slice-root .adm-deactivate-view > p {
  font-size: 12px;
  line-height: 1.9;
  color: #8898b1;
  margin: 0 0 16px;
}
.users-slice-root .adm-deactivate-view > p.adm-muted {
  font-size: 10px;
  color: #a5afc1;
}
.users-slice-root .adm-deactivate-actions {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  margin-top: 28px;
}
.users-slice-root .adm-deactivate-actions > .adm-danger {
  flex: 1;
}
@media (max-width: 570px) {
  .users-slice-root .adm-form-grid {
    gap: 10px;
  }
  .users-slice-root .adm-field > input,
  .users-slice-root .adm-field > select,
  .users-slice-root .adm-login-input {
    font-size: 13px;
  }
  .users-slice-root .adm-deactivate-view {
    padding: 28px 22px;
  }
  .users-slice-root .adm-toast {
    right: 14px;
    top: 71px;
    font-size: 10px;
    padding: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .users-slice-root .adm-active-control input,
  .users-slice-root .adm-active-control input:before {
    transition: none;
  }
}
.users-slice-root .adm-edit-fields {
  border: 0;
  min-width: 0;
  padding: 0;
  margin: 0;
}
.users-slice-root .adm-user-form {
  display: block;
  min-height: 0;
}
.users-slice-root .adm-user-dialog .ui-dialog-footer > .adm-panel-footer {
  padding: 0;
  border: 0;
  width: 100%;
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.users-slice-root .adm-user-dialog .ui-dialog-body {
  padding: 22px 25px;
}
`;
