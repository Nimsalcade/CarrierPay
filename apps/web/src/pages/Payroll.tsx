import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { EmptyState, ErrorBox, Spinner, StatusBadge } from '../components/ui';
import { dateOnly, money } from '../lib/format';

interface Period {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  peopleCount: number;
  grossRevenueCents: number;
  earningsCents: number;
  additionsCents: number;
  subtractionsCents: number;
  netPayCents: number;
  validationFlags: string[];
}

interface PeriodPage {
  items: Period[];
  total: number;
  page: number;
  pageSize: number;
}

export function PayrollPage() {
  const { me } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const { data, loading, error, reload } = useAsync<PeriodPage>(
    () => api('/pay-periods', { query: { status: statusFilter || undefined } }),
    [statusFilter],
  );
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcMsg, setCalcMsg] = useState<string | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  if (!me) return null;
  const isSuper = me.role === 'SUPER_ACCOUNT_MANAGER';

  const runCalculation = async () => {
    setCalcBusy(true);
    setCalcError(null);
    setCalcMsg(null);
    try {
      const res = await api<{ periodId: string; created: boolean }>('/pay-periods/calculate', { method: 'POST' });
      setCalcMsg(`Calculation complete${res.created ? '' : ' (period was already terminal)'}.`);
      reload();
    } catch (err) {
      setCalcError(err instanceof ApiError ? err.message : 'Calculation failed.');
    } finally {
      setCalcBusy(false);
    }
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Payroll</h1>
        {isSuper ? (
          <button className="btn btn-primary" onClick={() => void runCalculation()} disabled={calcBusy}>
            {calcBusy ? 'Calculating…' : '⚡ Calculate period'}
          </button>
        ) : null}
      </div>
      {calcMsg ? <div className="alert alert-success">{calcMsg}</div> : null}
      {calcError ? <div className="alert alert-error">{calcError}</div> : null}

      <div className="card mb-16">
        <div className="flex" style={{ alignItems: 'center', gap: 8 }}>
          <label className="small muted">Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All periods</option>
            <option value="DRAFT">Draft</option>
            <option value="CALCULATING">Calculating</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="APPROVED">Approved</option>
            <option value="GENERATING">Generating paystubs</option>
            <option value="PUBLISHED">Published</option>
            <option value="FAILED">Failed</option>
            <option value="VOID">Void</option>
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No pay periods yet" hint="Run a calculation to create the most recent payroll window." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="num">People</th>
                  <th className="num">Gross</th>
                  <th className="num">Earnings</th>
                  <th className="num">Net pay</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">
                      {dateOnly(p.startAt)} → {dateOnly(p.endAt)}
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                      {p.validationFlags.length > 0 ? <span className="badge badge-amber">flags</span> : null}
                    </td>
                    <td className="num">{p.peopleCount}</td>
                    <td className="num">{money(p.grossRevenueCents)}</td>
                    <td className="num">{money(p.earningsCents)}</td>
                    <td className="num">{money(p.netPayCents)}</td>
                    <td className="num">
                      <Link className="btn btn-outline btn-sm" to={`/payroll/${p.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
