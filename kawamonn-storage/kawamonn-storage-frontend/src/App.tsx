import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import StorageDashboard from './pages/StorageDashboard';
import AdminDashboard from './pages/AdminDashboard';
import AdminLogin from './pages/AdminLogin';
import SshDashboard from './pages/SshDashboard';
import UserSettings from './pages/UserSettings';
import '@mantine/core/styles.css';

// Set absolute URL for API if running on Mobile Native (Capacitor)
if (Capacitor.isNativePlatform()) {
  axios.defaults.baseURL = 'https://storage.kawamonn.com'; // Adjust to target API domain
}

// -----------------------------------------------
// Auth Context — manages auth state as React state
// so that navigation triggers re-renders properly
// -----------------------------------------------
interface AuthContextValue {
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

// -----------------------------------------------
// Protected Route wrappers
// -----------------------------------------------
function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, userRole } = useAuth();
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />;
  if (userRole !== 'admin') return <Navigate to="/" replace />;
  return children;
}

// -----------------------------------------------
// Main App
// -----------------------------------------------
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!localStorage.getItem('token'));
  const [userRole, setUserRole] = useState<string | null>(() => localStorage.getItem('role'));

  // Sync auth state when localStorage changes from other tabs
  useEffect(() => {
    const handleStorage = () => {
      setIsAuthenticated(!!localStorage.getItem('token'));
      setUserRole(localStorage.getItem('role'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const login = (token: string, role: string, accountName: string) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    localStorage.setItem('account_name', accountName);
    setIsAuthenticated(true);
    setUserRole(role);
  };

  const logout = () => {
    localStorage.clear();
    setIsAuthenticated(false);
    setUserRole(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, userRole, login, logout }}>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset" element={<ResetPassword />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <StorageDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            }
          />
          <Route
            path="/ssh"
            element={
              <ProtectedRoute>
                <SshDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <UserSettings />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
