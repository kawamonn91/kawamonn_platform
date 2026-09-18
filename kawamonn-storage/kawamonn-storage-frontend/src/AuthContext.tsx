import { createContext, useContext } from 'react';

// -----------------------------------------------
// Auth Context — manages auth state as React state
// so that navigation triggers re-renders properly
// -----------------------------------------------
export interface AuthContextValue {
    isAuthenticated: boolean;
    userRole: string | null;
    login: (token: string, role: string, accountName: string) => void;
    logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
    isAuthenticated: false,
    userRole: null,
    login: () => {},
    logout: () => {},
});

export function useAuth() {
    return useContext(AuthContext);
}
