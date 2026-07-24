import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { CabinetLayout } from './layout/CabinetLayout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { MeetingsPage } from './pages/MeetingsPage';
import './styles/global.scss';

// TODO(Task 6): заменить на импорт реального SettingsPage.
function SettingsPagePlaceholder() {
  return <div style={{ padding: 24 }}>Настройки — скоро</div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root');

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<CabinetLayout />}>
              <Route index element={<MeetingsPage />} />
              <Route path="settings" element={<SettingsPagePlaceholder />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
