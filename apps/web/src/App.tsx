import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/app-shell';
import { AuthProvider } from './features/auth/auth-provider';
import { RequireAuth, RequireRole } from './features/auth/require-auth';
import { AdminPage } from './routes/admin-page';
import { ChatPage } from './routes/chat-page';
import { ComponentGalleryPage } from './routes/component-gallery-page';
import { DocumentsPage } from './routes/documents-page';
import { LoginPage } from './routes/login-page';
import { NotFoundPage } from './routes/not-found-page';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {import.meta.env.DEV ? (
        <Route path="/dev/components" element={<ComponentGalleryPage />} />
      ) : null}

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route
            path="/admin"
            element={
              <RequireRole roles={['admin']}>
                <AdminPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
