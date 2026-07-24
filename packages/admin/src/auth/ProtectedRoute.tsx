import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <div className="muted" style={{ padding: 24 }}>Загрузка…</div>;
  if (status === 'guest') return <Navigate to="/login" replace />;
  return <Outlet />;
}
