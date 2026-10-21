import { createContext, useContext } from 'react';

// -----------------------------------------------
// Auth Context — manages auth state as React state
// so that navigation triggers re-renders properly
// -----------------------------------------------
export interface AuthContextValue {
    isAuthenticated: boolean;
    /** このトークンで使える役割(管理者は、確認コードを通してログインしたときだけ 'admin') */
    userRole: string | null;
    accountName: string | null;
    /** ログインの API が返したトークンで、ログインした状態にする */
    login: (token: string) => void;
    logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
    isAuthenticated: false,
    userRole: null,
    accountName: null,
    login: () => {},
    logout: () => {},
});

export function useAuth() {
    return useContext(AuthContext);
}
