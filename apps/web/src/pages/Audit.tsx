import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { dt } from '../lib/format';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  requestId: string | null;
  ipSummary: string | null;
  createdAt: string;
  actor: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
  before: unknown;
  after: unknown;
}

interface AuditPage {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

const ACTION_LABEL: Record<string, string> = {
  'USER.CREATE': 'User created',
  'USER.UPDATE': 'User updated',
  'USER.STATUS': 'User status changed',
  'USER.PASSWORD_RESET': 'Password reset',
  'USER.ROLE_CONVERT': 'Role converted',
  'EQUIPMENT.CREATE': 'Equipment created',
  'EQUIPMENT.UPDATE': 'Equipment updated',
  'EQUIPMENT.ASSIGN': 'Equipment assigned',
  'EQUIPMENT.RETURN': 'Equipment returned',
  'LOAD.CREATE': 'Load created',
  'LOAD.UPDATE': 'Load updated',
  'LOAD.STATUS': 'Load status changed',
  'PAY_RULE.CREATE': 'Pay rule created',
  'PAY_RULE.END': 'Pay rule ended',
  'RECURRING.CREATE': 'Recurring item created',
  'RECURRING.UPDATE': 'Recurring item updated',
  'PAYROLL.CALCULATE': 'Payroll calculated',
  'PAYROLL.RECALCULATE': 'Payroll recalculated',
  'PAYROLL.ADJUSTMENT': 'Payroll adjustment',
  'PAYROLL.APPROVE': 'Payroll approved',
  'PAYROLL.PUBLISH': 'Payroll published',
  'PAYSTUB.REVISE': 'Paystub revised',
  'PAYMENT.MARK_PAID': 'Payment recorded',
  'SETTINGS.UPDATE': 'Settings updated',
};

export function AuditPage() {
  const { me } = useAuth();
  const [entityFilter, setEntityFilter] = useState('');
  const { data, loading, error } = useAsync<AuditPage>(
    () => api('/audit', { query: { entityType: entityFilter || undefined } }),
    [entityFilter],
  );

  if (!me) return null;

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Audit Trail</h1>
        <select className="input" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
          <option value="">All entities</option>
          <option value="user">User</option>
          <option value="equipment">Equipment</option>
          <option value="load">Load</option>
          <option value="pay_rule_set">Pay rule</option>
          <option value="recurring_item">Recurring item</option>
          <option value="pay_period">Pay period</option>
          <option value="payroll_entry">Payroll entry</option>
          <option value="paystub">Paystub</option>
          <option value="company_settings">Settings</option>
        </select>
      </div>
      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No audit events" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Reason</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((a) => (
                  <tr key={a.id}>
                    <td className="small">{dt(a.createdAt)}</td>
                    <td className="small">
                      {a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : 'System'}
                      {a.actor ? <div className="muted">{a.actor.employeeCode}</div> : null}
                    </td>
                    <td className="small">{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td className="small mono">
                      {a.entityType}
                      {a.entityId ? ` / ${a.entityId.slice(0, 8)}` : ''}
                    </td>
                    <td className="small muted">{a.reason ?? '—'}</td>
                    <td>
                      <JsonPreview before={a.before} after={a.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data ? <div className="small muted mt-8">{data.total} event(s)</div> : null}
    </div>
  );
}

function JsonPreview({ before, after }: { before: unknown; after: unknown }) {
  const [open, setOpen] = useState(false);
  const has = (before != null && before !== '') || (after != null && after !== '');
  if (!has) return <span className="muted small">—</span>;
  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        View
      </button>
    );
  }
  return (
    <pre className="json-preview">
      <button className="btn btn-ghost btn-sm" style={{ float: 'right' }} onClick={() => setOpen(false)}>
        Hide
      </button>
      {before != null ? (
        <>
          <div className="small muted">before</div>
          {JSON.stringify(before, null, 2)}
        </>
      ) : null}
      {after != null ? (
        <>
          <div className="small muted">after</div>
          {JSON.stringify(after, null, 2)}
        </>
      ) : null}
    </pre>
  );
}
