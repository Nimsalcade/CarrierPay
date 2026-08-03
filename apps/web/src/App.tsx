import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { SetupPage } from './pages/Setup';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { UsersPage } from './pages/Users';
import { EquipmentPage } from './pages/Equipment';
import { LoadsPage } from './pages/Loads';
import { PayRulesPage } from './pages/PayRules';
import { RecurringItemsPage } from './pages/RecurringItems';
import { PayrollPage } from './pages/Payroll';
import { PayrollPeriodPage } from './pages/PayrollPeriod';
import { PayrollEntryPage } from './pages/PayrollEntry';
import { PaystubsPage } from './pages/Paystubs';
import { PaymentsPage } from './pages/Payments';
import { AuditPage } from './pages/Audit';
import { NotificationsPage } from './pages/Notifications';
import { SettingsPage } from './pages/Settings';
import { ChangePasswordPage } from './pages/ChangePassword';

export function App() {
  const { me, loading, setupRequired } = useAuth();

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="card card-pad">
          <Spinner large />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/setup"
        element={setupRequired && !me ? <SetupPage /> : <Navigate to="/" replace />}
      />
      <Route
        path="/login"
        element={!me ? <LoginPage /> : <Navigate to="/" replace />}
      />
      <Route
        path="/change-password"
        element={me ? <ChangePasswordPage /> : <Navigate to="/login" replace />}
      />
      <Route element={me ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/people" element={<UsersPage />} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route path="/loads" element={<LoadsPage />} />
        <Route path="/pay-rules" element={<PayRulesPage />} />
        <Route path="/recurring" element={<RecurringItemsPage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/payroll/:periodId" element={<PayrollPeriodPage />} />
        <Route path="/payroll/entries/:entryId" element={<PayrollEntryPage />} />
        <Route path="/paystubs" element={<PaystubsPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
