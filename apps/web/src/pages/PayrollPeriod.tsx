import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Badge, ConfirmButton, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { dateOnly, money } from '../lib/format';

interface LineItem {
  id: string;
  category: string;
  sourceType: string;
  sourceId: string | null;
  description: string;
  amountCents: number;
  ruleSetId: string | null;
  ruleComponentId: string | null;
  calculationJson: unknown;
  originalAmountCents: number | null;
  overrideReason: string | null;
}

interface Entry {
  id: string;
  payPeriodId: string;
  user: { id: string; firstName: string; lastName: string; employeeCode: string; role: string };
  totals: {
    grossRevenueCents: number;
    earningsCents: number;
    otherPayCents: number;
    reimbursementsCents: number;
    advancesCents: number;
    deductionsCents: number;
    netPayCents: number;
  };
  status: string;
  validationFlags: string[];
  lineItems: LineItem[];
}

interface PeriodDetail {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: string;
  totalsHash: string | null;
  error: string | null;
  batch: {
    grossRevenueCents: number;
    earningsCents: number;
    reimbursementsCents: number;
    advancesCents: number;
    deductionsCents: number;
    netPayCents: number;
    additionsCents: number;
    subtractionsCents: number;
  };
  entries: Entry[];
}

const FLAG_LABEL: Record<string, string> = {
  MISSING_PAY_RULE: 'Missing pay rule',
  MISSING_LOAD_RATE: 'Missing load rate',
  MISSING_MILEAGE: 'Missing mileage',
  DUPLICATE_SOURCE: 'Duplicate source',
  NEGATIVE_NET: 'Negative net',
  ZERO_NET: 'Zero net',
  STALE_ENTRY: 'Stale entry',
  EQUIPMENT_CONFLICT: 'Equipment conflict',
};

export function PayrollPeriodPage() {
  const { periodId = '' } = useParams();
  const { me } = useAuth();
  const { data, loading, error, reload } = useAsync<PeriodDetail>(() => api(`/pay-periods/${periodId}`), [periodId]);
  const [showApprove, setShowApprove] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!me) return null;
  const isSuper = me.role === 'SUPER_ACCOUNT_MANAGER';

  const act = async (fn: () => Promise<{ message?: string }>, success: string) => {
    setBusy(true);
    setActionMsg(null);
    setActionError(null);
    try {
      await fn();
      setActionMsg(success);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <div>
          <h1>
            Payroll period{' '}
            <span className="muted">
              {data ? `${dateOnly(data.startAt)} → ${dateOnly(data.endAt)}` : ''}
            </span>
          </h1>
          <div className="small muted">{data ? data.timezone : ''}</div>
        </div>
        {data ? (
          <div className="flex">
            {data.status === 'PENDING_APPROVAL' && isSuper ? (
              <button className="btn btn-primary" onClick={() => setShowApprove(true)}>
                Approve
              </button>
            ) : null}
            {data.status === 'APPROVED' && isSuper ? (
              <button className="btn btn-primary" onClick={() => setShowPublish(true)}>
                Generate paystubs &amp; publish
              </button>
            ) : null}
            {isSuper ? (
              <button
                className="btn btn-outline"
                disabled={busy || ['PUBLISHED', 'VOID'].includes(data.status)}
                onClick={() =>
                  void act(() => api(`/pay-periods/${periodId}/recalculate`, { method: 'POST' }), 'Period recalculated.')
                }
              >
                Recalculate
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {actionMsg ? <div className="alert alert-success">{actionMsg}</div> : null}
      {actionError ? <div className="alert alert-error">{actionError}</div> : null}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data ? (
        <>
          <div className="card mb-16">
            <div className="flex-between">
              <div>
                <StatusBadge status={data.status} />
                {data.totalsHash ? <span className="small mono muted"> · hash {data.totalsHash.slice(0, 12)}…</span> : null}
                {data.error ? <div className="alert alert-error">{data.error}</div> : null}
              </div>
              <div className="text-right">
                <div className="small muted">Net pay</div>
                <div className="big-num">{money(data.batch.netPayCents)}</div>
              </div>
            </div>
            <div className="stat-row">
              <Stat label="Gross revenue" value={money(data.batch.grossRevenueCents)} />
              <Stat label="Earnings" value={money(data.batch.earningsCents)} />
              <Stat label="Additions" value={money(data.batch.additionsCents)} />
              <Stat label="Subtractions" value={money(data.batch.subtractionsCents)} />
              <Stat label="Net pay" value={money(data.batch.netPayCents)} />
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th className="num">Earnings</th>
                    <th className="num">Additions</th>
                    <th className="num">Subtractions</th>
                    <th className="num">Net pay</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.user.firstName} {e.user.lastName}
                        <div className="small muted">{e.user.employeeCode}</div>
                      </td>
                      <td className="small muted">{e.user.role.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="num">{money(e.totals.earningsCents)}</td>
                      <td className="num">{money(e.totals.reimbursementsCents)}</td>
                      <td className="num">{money(e.totals.advancesCents + e.totals.deductionsCents)}</td>
                      <td className="num">{money(e.totals.netPayCents)}</td>
                      <td>
                        <StatusBadge status={e.status} />
                        {e.validationFlags.length > 0 ? (
                          <div className="small">
                            {e.validationFlags.map((f) => (
                              <Badge key={f} tone="amber">
                                {FLAG_LABEL[f] ?? f}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">
                        <Link className="btn btn-outline btn-sm" to={`/payroll/entries/${e.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {data && showApprove ? (
        <ApproveModal
          onClose={() => setShowApprove(false)}
          onDone={() => {
            setShowApprove(false);
            reload();
          }}
        />
      ) : null}
      {data && showPublish ? (
        <PublishModal
          periodId={periodId}
          onClose={() => setShowPublish(false)}
          onDone={() => {
            setShowPublish(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="small muted">{label}</div>
      <div className="mono">{value}</div>
    </div>
  );
}

function ApproveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { periodId = '' } = useParams();
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/pay-periods/${periodId}/approve`, { method: 'POST', body: { comments: comments || undefined } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Approve payroll period"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Approving…' : 'Approve period'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <Field label="Comments (optional)">
        <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} />
      </Field>
      <div className="small muted">
        Approval is blocked while blocking validation flags remain (missing pay rules, missing rates, stale entries, negative net, etc.). The approved totals are hashed for an immutable audit trail.
      </div>
    </Modal>
  );
}

function PublishModal({ periodId, onClose, onDone }: { periodId: string; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/pay-periods/${periodId}/publish`, { method: 'POST', body: {} });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Publishing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Publish paystubs"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <ConfirmButton label={busy ? 'Working…' : 'Publish period'} confirmLabel="Yes, publish" onConfirm={() => void submit()} />
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="small muted">
        This generates PDF paystubs for every approved entry, publishes the period, and locks all delivered loads that fed this payroll. This action cannot be undone; corrections later require a paystub revision.
      </div>
    </Modal>
  );
}
