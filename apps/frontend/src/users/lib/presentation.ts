import type { AppUser } from '../../auth/types';
export const fullName = (user: Pick<AppUser, 'firstName' | 'lastName' | 'login'>) =>
  [user.firstName, user.lastName].filter(Boolean).join(' ') || user.login;
export const initials = (user: Pick<AppUser, 'firstName' | 'lastName' | 'login'>) =>
  `${user.firstName.trim().charAt(0)}${user.lastName.trim().charAt(0)}`.toUpperCase() ||
  user.login.slice(0, 2).toUpperCase();
