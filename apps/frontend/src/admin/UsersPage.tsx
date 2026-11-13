import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserRoundX,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import AdminShell from './AdminShell';
import type { AppUser } from '../auth/types';
import { useOffices } from '../offices/OfficeProvider';
import type { AccessOperation } from '../api/client';
import { useAccessOperations } from './useAccessOperations';
import './users.css';

type UserDraft = {
  login: string;
  firstName: string;
  lastName: string;
  password: string;
  role: AppUser['role'];
  active: boolean;
  buildingIds: string[];
};

type UserPanel = { mode: 'create' } | { mode: 'edit'; id: string };
type StatusFilter = 'all' | 'active' | 'inactive';

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
const fullName = (user: Pick<AppUser, 'firstName' | 'lastName' | 'login'>) =>
  [user.firstName, user.lastName].filter(Boolean).join(' ') || user.login;
const initials = (user: Pick<AppUser, 'firstName' | 'lastName' | 'login'>) =>
  `${user.firstName.trim().charAt(0)}${user.lastName.trim().charAt(0)}`.toUpperCase() ||
  user.login.slice(0, 2).toUpperCase();

function AccessOperationReceipt({
  operation,
  name,
}: {
  operation: AccessOperation;
  name?: string;
}) {
  const completed = operation.status === 'completed';
  return (
    <div className={`adm-access-receipt${completed ? ' is-completed' : ''}`}>
      <span className="adm-access-receipt-icon">
        {completed ? <CheckCircle2 size={17} /> : <LoaderCircle size={17} className="adm-spin" />}
      </span>
      <div>
        {name && <span className="adm-access-receipt-name">{name}</span>}
        <b>{completed ? 'Отзыв доступа завершён' : 'Отзыв доступа выполняется'}</b>
        {completed ? (
          <p>
            Будущих броней отменено: {operation.cancelled_count}. Текущих завершено:{' '}
            {operation.terminated_count}.
          </p>
        ) : (
          <p>
            {operation.publication?.last_error
              ? 'Обработка задерживается. Продолжаем проверять состояние.'
              : 'Права обновлены. Освобождение броней выполняется в фоне.'}
          </p>
        )}
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  required = false,
  autoComplete = 'new-password',
  minLength = 8,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="adm-field" htmlFor={id}>
      <span>{label}</span>
      <div className="adm-password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          maxLength={200}
        />
        <button
          type="button"
          aria-label={visible ? `Скрыть ${label.toLowerCase()}` : `Показать ${label.toLowerCase()}`}
          title={visible ? 'Скрыть пароль' : 'Показать пароль'}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </label>
  );
}

export default function UsersPage() {
  const auth = useAuth();
  const access = useAccessOperations(
    auth.ready && auth.user?.active && auth.user.role === 'admin' ? auth.user.id : null,
  );
  const { offices, error: officeError } = useOffices();
  const officeById = useMemo(() => new Map(offices.map((item) => [item.id, item])), [offices]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [panel, setPanel] = useState<UserPanel | null>(null);
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [success, setSuccess] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const users = auth.users ?? [];
  const operationByUser = useMemo(() => {
    const byUser = new Map<string, AccessOperation>();
    for (const operation of access.operations) {
      const current = byUser.get(operation.user_id);
      if (!current || (current.status === 'completed' && operation.status === 'pending'))
        byUser.set(operation.user_id, operation);
    }
    return byUser;
  }, [access.operations]);
  const displayedOperations = [
    ...access.operations.filter((operation) => operation.status === 'pending'),
    ...access.operations.filter((operation) => operation.status === 'completed').slice(0, 3),
  ];
  const activeCount = users.filter((user) => user.active).length;
  const editingUser =
    panel?.mode === 'edit' ? users.find((user) => user.id === panel.id) : undefined;
  const editingSelf = !!editingUser && editingUser.id === auth.user?.id;
  const busy = pending || resetPending;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const query = search.trim().toLocaleLowerCase('ru');
  const filteredUsers = users.filter((user) => {
    if (status === 'active' && !user.active) return false;
    if (status === 'inactive' && user.active) return false;
    return (
      !query ||
      `${user.firstName} ${user.lastName} ${user.login}`.toLocaleLowerCase('ru').includes(query)
    );
  });

  function closePanel() {
    if (busy) return;
    if (confirmation) {
      setConfirmation(false);
      return;
    }
    setPanel(null);
    setDraft(null);
  }

  function openPanel(next: UserPanel, user?: AppUser) {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next);
    setDraft(
      user
        ? {
            login: user.login,
            firstName: user.firstName,
            lastName: user.lastName,
            password: '',
            role: user.role,
            active: user.active,
            buildingIds: [...user.buildingIds],
          }
        : {
            login: '',
            firstName: '',
            lastName: '',
            password: '',
            role: 'employee',
            active: true,
            buildingIds: [],
          },
    );
    setPanelError('');
    setConfirmation(false);
    setResetOpen(false);
    setResetPassword('');
    setResetConfirmation('');
    setResetError('');
    setResetSuccess('');
  }

  useEffect(() => {
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [!!panel]);

  useEffect(() => {
    if (!panel) return;
    const dialog = dialogRef.current;
    const frame = requestAnimationFrame(() => {
      const initial =
        dialog?.querySelector<HTMLElement>('[data-autofocus]') ??
        dialog?.querySelector<HTMLElement>('input, button');
      initial?.focus();
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (busyRef.current) return;
        if (confirmation) setConfirmation(false);
        else {
          setPanel(null);
          setDraft(null);
        }
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const elements = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:enabled, input:enabled, select:enabled, a[href], [tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [!!panel, confirmation]);

  useEffect(() => {
    document.title = 'Пользователи — Планировка';
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(''), 5000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function changeDraft(patch: Partial<UserDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setPanelError('');
  }

  function validateDraft(): string | null {
    if (!draft) return 'Заполните данные пользователя.';
    if (!draft.firstName.trim() || !draft.lastName.trim()) return 'Укажите имя и фамилию.';
    if (!draft.login.trim()) return 'Укажите логин.';
    if (/\s/.test(draft.login.trim())) return 'Логин не должен содержать пробелы.';
    if (panel?.mode === 'create' && draft.password.length < 8)
      return 'Пароль должен содержать минимум 8 символов.';
    return null;
  }

  async function saveUser() {
    if (!panel || !draft || busy) return;
    const validation = validateDraft();
    if (validation) {
      setPanelError(validation);
      return;
    }
    setPending(true);
    setPanelError('');
    try {
      const input = {
        login: draft.login.trim(),
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        role: editingSelf ? auth.user!.role : draft.role,
        buildingIds: [...draft.buildingIds],
      };
      if (panel.mode === 'create') {
        await auth.createUser({ ...input, password: draft.password });
        setSuccess('Пользователь создан');
      } else {
        await auth.updateUser(panel.id, {
          ...input,
          active: editingSelf ? auth.user!.active : draft.active,
        });
        setSuccess(
          editingUser?.active && !draft.active
            ? 'Доступ пользователя отключён. Обработка броней проверяется отдельно.'
            : 'Данные пользователя сохранены',
        );
      }
      setPanel(null);
      setDraft(null);
      setConfirmation(false);
    } catch (error) {
      setPanelError(messageOf(error));
      setConfirmation(false);
    } finally {
      setPending(false);
    }
  }

  function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateDraft();
    if (validation) {
      setPanelError(validation);
      return;
    }
    if (editingUser?.active && draft && !draft.active && !editingSelf) setConfirmation(true);
    else void saveUser();
  }

  async function submitReset() {
    if (!editingUser || editingSelf || busy) return;
    setResetSuccess('');
    if (resetPassword.length < 8) {
      setResetError('Пароль должен содержать минимум 8 символов.');
      return;
    }
    if (resetPassword !== resetConfirmation) {
      setResetError('Пароли не совпадают.');
      return;
    }
    setResetPending(true);
    setResetError('');
    try {
      await auth.resetPassword(editingUser.id, resetPassword);
      setResetPassword('');
      setResetConfirmation('');
      setResetSuccess('Новый пароль установлен');
    } catch (error) {
      setResetError(messageOf(error));
    } finally {
      setResetPending(false);
    }
  }

  function handleResetKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'Enter' ||
      event.nativeEvent.isComposing ||
      !(event.target instanceof HTMLInputElement)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void submitReset();
  }

  function officeAccessLabel(person: AppUser) {
    if (person.role === 'admin')
      return { label: 'Все офисы', more: 0, title: 'Администратору доступны все офисы' };
    const ids = [...new Set(person.buildingIds)];
    if (ids.length === 0)
      return { label: 'Не назначен', more: 0, title: 'Доступ к офисам не назначен' };
    const names = ids.flatMap((id) => {
      const name = officeById.get(id)?.name;
      return name ? [name] : [];
    });
    const unknownCount = ids.length - names.length;
    return {
      label: names[0] ?? (ids.length === 1 ? 'Назначен офис' : `Назначено офисов: ${ids.length}`),
      more: names.length > 0 ? ids.length - 1 : 0,
      title: [
        ...names,
        ...(unknownCount > 0 ? [`Назначений вне списка: ${unknownCount}`] : []),
      ].join('\n'),
    };
  }

  const overlays = (
    <>
      {success && (
        <div className="adm-toast" role="status">
          <CheckCircle2 size={18} />
          <span>{success}</span>
          <button type="button" aria-label="Закрыть уведомление" onClick={() => setSuccess('')}>
            <X size={15} />
          </button>
        </div>
      )}

      {panel && draft && (
        <div
          className="adm-panel-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePanel();
          }}
        >
          <div
            ref={dialogRef}
            className="adm-panel"
            role={confirmation ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="adm-panel-title"
            aria-describedby={confirmation ? 'adm-deactivate-description' : undefined}
            tabIndex={-1}
          >
            <div className="adm-panel-header">
              <div>
                <span>
                  {confirmation
                    ? 'ПРЕКРАЩЕНИЕ ДОСТУПА'
                    : panel.mode === 'create'
                      ? 'НОВАЯ УЧЁТНАЯ ЗАПИСЬ'
                      : 'УЧЁТНАЯ ЗАПИСЬ'}
                </span>
                <h2 id="adm-panel-title">
                  {confirmation
                    ? 'Отключить пользователя?'
                    : panel.mode === 'create'
                      ? 'Добавить пользователя'
                      : 'Редактировать пользователя'}
                </h2>
              </div>
              <button
                type="button"
                aria-label={
                  confirmation ? 'Вернуться к редактированию' : 'Закрыть панель пользователя'
                }
                onClick={closePanel}
                disabled={busy}
              >
                <X size={20} />
              </button>
            </div>

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
                  <button
                    type="button"
                    className="adm-secondary"
                    onClick={() => setConfirmation(false)}
                    disabled={pending}
                  >
                    Вернуться
                  </button>
                  <button
                    type="button"
                    className="adm-danger"
                    data-autofocus
                    onClick={() => void saveUser()}
                    disabled={pending}
                  >
                    {pending ? (
                      <LoaderCircle className="adm-spin" size={16} />
                    ) : (
                      <UserRoundX size={16} />
                    )}
                    Отключить доступ
                  </button>
                </div>
              </div>
            ) : (
              <form className="adm-user-form" onSubmit={submitUser}>
                <fieldset className="adm-panel-body" disabled={busy}>
                  <section className="adm-form-section">
                    <h3>Личные данные</h3>
                    <div className="adm-form-grid">
                      <label className="adm-field" htmlFor="adm-first-name">
                        <span>Имя</span>
                        <input
                          id="adm-first-name"
                          value={draft.firstName}
                          onChange={(event) => changeDraft({ firstName: event.target.value })}
                          autoComplete="given-name"
                          required
                          maxLength={60}
                          data-autofocus
                        />
                      </label>
                      <label className="adm-field" htmlFor="adm-last-name">
                        <span>Фамилия</span>
                        <input
                          id="adm-last-name"
                          value={draft.lastName}
                          onChange={(event) => changeDraft({ lastName: event.target.value })}
                          autoComplete="family-name"
                          required
                          maxLength={60}
                        />
                      </label>
                    </div>
                    <label className="adm-field" htmlFor="adm-login">
                      <span>Логин</span>
                      <div className="adm-login-input">
                        <span>@</span>
                        <input
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
                    </label>
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
                    <label className="adm-field" htmlFor="adm-role">
                      <span>Роль</span>
                      <select
                        id="adm-role"
                        value={draft.role}
                        disabled={editingSelf}
                        onChange={(event) =>
                          changeDraft({ role: event.target.value as AppUser['role'] })
                        }
                      >
                        <option value="employee">Сотрудник</option>
                        <option value="admin">Администратор</option>
                      </select>
                    </label>
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
                        <input
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
                          <button type="button" onClick={() => void access.refresh()}>
                            Повторить проверку
                          </button>
                        </div>
                      )}
                    </section>
                  )}

                  {panel.mode === 'edit' && (
                    <section className="adm-form-section adm-password-reset">
                      <button
                        type="button"
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
                      </button>
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
                          <button
                            type="button"
                            className="adm-secondary"
                            onClick={() => void submitReset()}
                            disabled={busy || !resetPassword || !resetConfirmation}
                          >
                            {resetPending ? (
                              <LoaderCircle className="adm-spin" size={15} />
                            ) : (
                              <KeyRound size={15} />
                            )}
                            Сохранить новый пароль
                          </button>
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
                <div className="adm-panel-footer">
                  <button
                    type="button"
                    className="adm-secondary"
                    onClick={closePanel}
                    disabled={busy}
                  >
                    Отмена
                  </button>
                  <button type="submit" className="adm-primary" disabled={busy}>
                    {pending ? (
                      <LoaderCircle className="adm-spin" size={16} />
                    ) : panel.mode === 'create' ? (
                      <Plus size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    {panel.mode === 'create' ? 'Создать пользователя' : 'Сохранить изменения'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
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
          <div className="adm-page-heading">
            <div>
              <div className="adm-eyebrow">ДОСТУП К ПРОСТРАНСТВУ</div>
              <h1>
                Пользователи <span>{users.length}</span>
              </h1>
              <p>Сотрудники, роли и доступ к офисам.</p>
            </div>
            <button
              type="button"
              className="adm-primary"
              onClick={() => openPanel({ mode: 'create' })}
              disabled={!auth.ready}
            >
              <Plus size={17} />
              Добавить пользователя
            </button>
          </div>

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
                <button
                  type="button"
                  className="adm-secondary"
                  onClick={() => void access.refresh()}
                >
                  Проверить состояние
                </button>
              </div>
              {access.error && (
                <div className="adm-access-check-error" role="alert">
                  <span>Не удалось обновить состояние отзыва доступа.</span>
                  <button type="button" onClick={() => void access.refresh()}>
                    Повторить проверку
                  </button>
                </div>
              )}
              {access.loading && displayedOperations.length === 0 && (
                <p className="adm-access-loading" role="status">
                  <LoaderCircle size={15} className="adm-spin" />
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

          <section className="adm-user-list" aria-label="Список пользователей">
            <div className="adm-list-toolbar">
              <label className="adm-search">
                <Search size={17} />
                <input
                  aria-label="Поиск пользователей"
                  placeholder="Найти по имени или логину"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')}>
                    <X size={14} />
                  </button>
                )}
              </label>
              <label className="adm-status-filter">
                <span>Статус</span>
                <select
                  aria-label="Фильтр по статусу"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as StatusFilter)}
                >
                  <option value="all">Все пользователи</option>
                  <option value="active">Активные</option>
                  <option value="inactive">Доступ отключён</option>
                </select>
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
                <LoaderCircle className="adm-spin" size={25} />
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
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setStatus('all');
                    }}
                  >
                    Сбросить фильтры
                  </button>
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
                      <span
                        className={`adm-user-avatar${person.role === 'admin' ? ' is-admin' : ''}`}
                      >
                        {initials(person)}
                      </span>
                      <div>
                        <b>
                          {fullName(person)}
                          {person.id === auth.user?.id && <small>Вы</small>}
                        </b>
                        <span>
                          {person.role === 'admin' ? 'Администратор сервиса' : 'Сотрудник'}
                        </span>
                      </div>
                    </div>
                    <div className="adm-login-cell" data-label="Логин">
                      <span>@{person.login}</span>
                    </div>
                    <div data-label="Роль">
                      <span
                        className={`adm-role-badge${person.role === 'admin' ? ' is-admin' : ''}`}
                      >
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
                    <button
                      type="button"
                      className="adm-edit-button"
                      aria-label={`Редактировать пользователя ${fullName(person)}`}
                      title="Редактировать пользователя"
                      onClick={() => openPanel({ mode: 'edit', id: person.id }, person)}
                    >
                      <Pencil size={16} />
                    </button>
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
      )}
    </AdminShell>
  );
}
