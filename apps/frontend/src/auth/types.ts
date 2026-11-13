export type UserRole = 'admin' | 'employee';

export interface AppUser {
  id: string;
  login: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  active: boolean;
  buildingIds: string[];
  createdAt: string;
}

export interface UserInput {
  login: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  buildingIds: string[];
  password: string;
}

export type UserUpdate = Omit<UserInput, 'password'> & { active: boolean };

export interface AuthSnapshot {
  user: AppUser | null;
  users: AppUser[];
  expiresAt: number | null;
}

export interface AuthContextValue {
  ready: boolean;
  user: AppUser | null;
  users: AppUser[];
  error: string | null;
  signIn(login: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  createUser(input: UserInput): Promise<AppUser>;
  updateUser(id: string, input: UserUpdate): Promise<AppUser>;
  resetPassword(id: string, password: string): Promise<void>;
  changePassword(current: string, password: string): Promise<void>;
}
