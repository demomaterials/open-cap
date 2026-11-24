import { createContext, useContext } from 'react';

export const AuthContext = createContext({ user: null, setUser: () => {} });
export const useAuth = () => useContext(AuthContext);

const RANK = { viewer: 1, editor: 2, admin: 3 };
export function can(user, role) {
  return (RANK[user?.role] ?? 0) >= RANK[role];
}
