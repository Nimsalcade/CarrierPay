import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Badge, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
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

interface EntryDetail {
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
  ytdPreview?: {
    earningsCents: number;
    otherPayCents: number;
    reimbursementsCents: number;
    advancesCents: number;
    deductionsCents: number;
    netPayCents: number;
  } | null;
  payPeriod?: { id: string; startAt: string; endAt: string; status: string };
}

const CATEGORY_TONE: Record<string, 'green' | 'blue' | 'gray' | 'red' | 'amber' | 'indigo'> = {
  EARNING: 'green',
  GUARANTEE_TOP_UP: 'green',
  OTHER_PAY: 'indigo',
  REIMBURSEMENT: 'blue',
  ADVANCE: 'amber',
  DEDUCTION: 'red',
  MANUAL_ADJUSTMENT: 'red',
};

const SOURCE_LABEL: Record<string, string> = {
  LOAD: 'Load',
  RECURRING_ITEM: 'Recurring',
  MANUAL_ITEM: 'Manual',
  GUARANTEE: 'Guarantee',
  OVERRIDE: 'Override',
  RULE_COMPONENT: 'Rule component',
};

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

export function PayrollEntryPage() {
  const { entryId = '' } = useParams();
  const { me } = useAuth();
  const { data, loading, error, reload } = useAsync<EntryDetail>(() => api(`/payroll-entries/${entryId}`), [entryId]);
  const [showAdjust, setShowAdjust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);

  if (!me) return null;
  const isSuper = me.role === 'SUPER_ACCOUNT_MANAGER';
  const isManager = isSuper || me.role === 'ASSISTANT_ACCOUNT_MANAGER';
  const periodStatus = data?.payPeriod?.status;

  const revise = async () => {
    setBusy(true);
    setActError(null);
    setMsg(null);
    try {
      await api(`/payroll-entries/${entryId}/paystubs/revise`, { method: 'POST' });
      setMsg('Paystub revision generated.');
    } catch (err) {
      setActError(err instanceof ApiError ? err.message : 'Revision failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <div>
          <h1>Payroll entry</h1>
          <div className="small muted">
            {data ? `${data.user.firstName} ${data.user.lastName} · ${dateOnly(data.payPeriod?.startAt ?? '')} → ${dateOnly(data.payPeriod?.endAt ?? '')}` : ''}
          </div>
        </div>
        {data ? (
          <div className="flex">
            {isManager && periodStatus !== 'PUBLISHED' && periodStatus !== 'VOID' ? (
              <button className="btn btn-primary" onClick={() => setShowAdjust(true)}>
                + Adjustment
              </button>
            ) : null}
            {isSuper && periodStatus === 'PUBLISHED' ? (
              <button className="btn btn-outline" disabled={busy} onClick={() => void revise()}>
                Revise paystub
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {msg ? <div className="alert alert-success">{msg}</div> : null}
      {actError ? <div className="alert alert-error">{actError}</div> : null}

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
                {data.validationFlags.map((f) => (
                  <Badge key={f} tone="amber">
                    {FLAG_LABEL[f] ?? f}
                  </Badge>
                ))}
              </div>
              <div className="text-right">
                <div className="small muted">Net pay</div>
                <div className="big-num">{money(data.totals.netPayCents)}</div>
              </div>
            </div>
            <div className="stat-row">
              <Stat label="Gross revenue" value={money(data.totals.grossRevenueCents)} />
              <Stat label="Earnings" value={money(data.totals.earningsCents)} />
              <Stat label="Other pay" value={money(data.totals.otherPayCents)} />
              <Stat label="Reimbursements" value={money(data.totals.reimbursementsCents)} />
              <Stat label="Advances" value={money(data.totals.advancesCents)} />
              <Stat label="Deductions" value={money(data.totals.deductionsCents)} />
            </div>
          </div>

          {data.ytdPreview ? (
            <div className="card mb-16">
              <div className="small muted mb-16">Year-to-date (published, including this period)</div>
              <div className="stat-row">
                <Stat label="Earnings" value={money(data.ytdPreview.earningsCents)} />
                <Stat label="Reimbursements" value={money(data.ytdPreview.reimbursementsCents)} />
                <Stat label="Advances" value={money(data.ytdPreview.advancesCents)} />
                <Stat label="Deductions" value={money(data.ytdPreview.deductionsCents)} />
                <Stat label="Net pay" value={money(data.ytdPreview.netPayCents)} />
              </div>
            </div>
          ) : null}

          <div className="card">
            <h3 className="mb-16">Line items</h3>
            {data.lineItems.length === 0 ? (
              <div className="muted">No line items.</div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Source</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lineItems.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <Badge tone={CATEGORY_TONE[l.category] ?? 'gray'}>{l.category.replace(/_/g, ' ')}</Badge>
                        </td>
                        <td className="small">{SOURCE_LABEL[l.sourceType] ?? l.sourceType}</td>
                        <td className="small">{l.description}</td>
                        <td className={`num mono ${l.amountCents < 0 ? 'neg' : ''}`}>{money(l.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {data && showAdjust ? (
        <AdjustmentModal
          entryId={entryId}
          onClose={() => setShowAdjust(false)}
          onDone={() => {
            setShowAdjust(false);
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

function AdjustmentModal({ entryId, onClose, onDone }: { entryId: string; onClose: () => void; onDone: () => void }) {
  const [itemType, setItemType] = useState('MANUAL_ADJUSTMENT');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/payroll-entries/${entryId}/adjustments`, {
        method: 'POST',
        body: {
          amountCents: Math.round(Number(amount) * 100),
          itemType,
          description,
          reason,
          quantity: quantity ? Number(quantity) : null,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add adjustment.');
    } finally {
      setBusy(false);
    }
  };

  const valid = amount !== '' && description && reason.length >= 3;

  return (
    <Modal
      title="Add adjustment"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Add adjustment'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Type">
          <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
            <option value="MANUAL_ADJUSTMENT">Manual adjustment</option>
            <option value="REIMBURSEMENT">Reimbursement</option>
            <option value="ADVANCE">Advance</option>
            <option value="DEDUCTION">Deduction</option>
            <option value="OTHER_PAY">Other pay</option>
          </select>
        </Field>
        <Field label="Amount ($)" hint="Deductions/advances are stored as a positive value.">
          <input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} required />
        </Field>
        <Field label="Reason" hint="Min 3 characters; recorded in the audit trail.">
          <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </Field>
        <Field label="Quantity (optional)">
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        Super managers&apos; adjustments are applied immediately (approved for calculation). Assistant manager proposals require approval before they affect the entry.
      </div>
    </Modal>
  );
}
