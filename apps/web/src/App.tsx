import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Dashboard from './pages/Dashboard';
import Overview from './pages/Overview';
import AssistantPage from './pages/AssistantPage';
import Integrations from './pages/Integrations';
import Onboarding from './pages/Onboarding';
import Login from './pages/Login';
import Settings from './pages/Settings';
import ScheduledJobs from './pages/ScheduledJobs';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* Protected — nested under Dashboard shell */}
          <Route
            path="/dashboard"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
          >
            <Route index element={<Overview />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="integrations" element={<Integrations />} />
          </Route>

          {/* Settings has its own layout */}
          <Route
            path="/settings"
            element={<ProtectedRoute><Settings /></ProtectedRoute>}
          />

          {/* Scheduled jobs */}
          <Route
            path="/scheduled-jobs"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
          >
            <Route index element={<ScheduledJobs />} />
          </Route>

          {/* Root redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
