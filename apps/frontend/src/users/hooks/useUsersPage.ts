import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuth } from '../../auth/hooks';
import { useOffices } from '../../office/hooks';
import type { AppUser } from '../../auth/types';
import type { AccessOperation } from '../../shared/api';
import { useAccessOperations } from './useAccessOperations';
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
export function useUsersPage() {
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

  return {
    auth,
    access,
    offices,
    officeError,
    officeById,
    search,
    setSearch,
    status,
    setStatus,
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
    users,
    operationByUser,
    displayedOperations,
    activeCount,
    editingUser,
    editingSelf,
    busy,
    query,
    filteredUsers,
    closePanel,
    openPanel,
    changeDraft,
    saveUser,
    submitUser,
    submitReset,
    handleResetKeyDown,
    officeAccessLabel,
  };
}
export type UsersPageState = ReturnType<typeof useUsersPage>;
