import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import StorageDashboard from './pages/StorageDashboard';
import AdminDashboard from './pages/AdminDashboard';
import AdminLogin from './pages/AdminLogin';
import SshDashboard from './pages/SshDashboard';
import UserSettings from './pages/UserSettings';
import { AuthContext, useAuth } from './AuthContext';
import { decodeToken } from './api/token';

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
  const [accountName, setAccountName] = useState<string | null>(() => localStorage.getItem('account_name'));

  // Sync auth state when localStorage changes from other tabs
  useEffect(() => {
    const handleStorage = () => {
      setIsAuthenticated(!!localStorage.getItem('token'));
      setUserRole(localStorage.getItem('role'));
      setAccountName(localStorage.getItem('account_name'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const login = (token: string) => {
    const payload = decodeToken(token);
    if (!payload) throw new Error('ログインの応答を読めませんでした');
    localStorage.setItem('token', token);
    localStorage.setItem('role', payload.role);
    localStorage.setItem('account_name', payload.account_name);
    setIsAuthenticated(true);
    setUserRole(payload.role);
    setAccountName(payload.account_name);
  };

  const logout = () => {
    localStorage.clear();
    setIsAuthenticated(false);
    setUserRole(null);
    setAccountName(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, userRole, accountName, login, logout }}>
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
