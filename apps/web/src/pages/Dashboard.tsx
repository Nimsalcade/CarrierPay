import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Spinner, ErrorBox, StatusBadge } from '../components/ui';
import { money, dt } from '../lib/format';

interface ManagerDash {
  role: string;
  unreadCount: number;
  stats: {
    activeDrivers: number;
    activeDispatchers: number;
    activeAssistants: number;
    openLoads: number;
    deliveredThisWeek: number;
    pendingApprovalPeriods: number;
    ytdGrossRevenueCents: number;
    ytdEarningsCents: number;
    ytdNetPayCents: number;
  };
  latestPeriod: { id: string; startAt: string; endAt: string; status: string } | null;
}

interface DriverDash {
  role: string;
  unreadCount: number;
  stats: { activeLoads: number; deliveredThisWeek: number; ytdEarningsCents: number; ytdNetPayCents: number };
  latestPaystub: { id: string; settlementNumber: string; publishedAt: string | null; netPayCents: number } | null;
}

interface DispatcherDash {
  role: string;
  unreadCount: number;
  stats: { openLoads: number; deliveredThisWeek: number; deliveredTotal: number };
}

type Dash = ManagerDash | DriverDash | DispatcherDash;

export function DashboardPage() {
  const { me } = useAuth();
  const { data, loading, error } = useAsync<Dash>(() => api('/dashboard'));

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  if (data.role === 'DRIVER') {
    const d = data as DriverDash;
    return (
      <div>
        <h1>Welcome back, {me?.firstName}</h1>
        <div className="stat-grid">
          <Stat label="Active loads" value={String(d.stats.activeLoads)} />
          <Stat label="Delivered this week" value={String(d.stats.deliveredThisWeek)} />
          <Stat label="YTD earnings" value={money(d.stats.ytdEarningsCents)} />
          <Stat label="YTD net pay" value={money(d.stats.ytdNetPayCents)} />
        </div>
        <div className="card">
          <div className="card-header">
            <h2>Latest paystub</h2>
            <div className="spacer" />
            {d.latestPaystub ? <Link to="/paystubs">All paystubs →</Link> : null}
          </div>
          <div className="card-pad">
            {d.latestPaystub ? (
              <div className="flex-between">
                <div>
                  <div className="small muted">{d.latestPaystub.settlementNumber}</div>
                  <div className="muted small">{dt(d.latestPaystub.publishedAt)}</div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{money(d.latestPaystub.netPayCents)}</div>
              </div>
            ) : (
              <div className="muted small">No published paystubs yet.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (data.role === 'DISPATCHER') {
    const d = data as DispatcherDash;
    return (
      <div>
        <h1>Dispatcher overview</h1>
        <div className="stat-grid">
          <Stat label="Open loads" value={String(d.stats.openLoads)} />
          <Stat label="Delivered this week" value={String(d.stats.deliveredThisWeek)} />
          <Stat label="Delivered total" value={String(d.stats.deliveredTotal)} />
        </div>
      </div>
    );
  }

  const d = data as ManagerDash;
  return (
    <div>
      <h1>Company overview</h1>
      <div className="stat-grid">
        <Stat label="Active drivers" value={String(d.stats.activeDrivers)} />
        <Stat label="Dispatchers" value={String(d.stats.activeDispatchers)} />
        <Stat label="Assistants" value={String(d.stats.activeAssistants)} />
        <Stat label="Open loads" value={String(d.stats.openLoads)} />
        <Stat label="Delivered this week" value={String(d.stats.deliveredThisWeek)} />
        <Stat label="Pending approval" value={String(d.stats.pendingApprovalPeriods)} />
        <Stat label="YTD gross revenue" value={money(d.stats.ytdGrossRevenueCents)} />
        <Stat label="YTD net pay" value={money(d.stats.ytdNetPayCents)} />
      </div>
      <div className="card">
        <div className="card-header">
          <h2>Latest pay period</h2>
          <div className="spacer" />
          <Link to="/payroll">All periods →</Link>
        </div>
        <div className="card-pad">
          {d.latestPeriod ? (
            <div className="flex-between">
              <div>
                <div className="small muted">
                  {dt(d.latestPeriod.startAt)} — {dt(d.latestPeriod.endAt)}
                </div>
                <StatusBadge status={d.latestPeriod.status} />
              </div>
              <Link className="btn btn-outline btn-sm" to={`/payroll/${d.latestPeriod.id}`}>
                Review batch
              </Link>
            </div>
          ) : (
            <div className="muted small">No pay periods yet. Run a calculation from the Payroll page.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
