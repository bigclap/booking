import { useUsersPage } from '../hooks/useUsersPage';
import { UsersScreen } from '../organisms/UsersScreen';

export default function UsersPage() {
  return <UsersScreen state={useUsersPage()} />;
}
