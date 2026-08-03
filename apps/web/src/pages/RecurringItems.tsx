import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Badge, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { dateOnly, money } from '../lib/format';

interface Person {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  status: string;
}

interface RecurringItem {
  id: string;
  userId: string;
  itemType: string;
  name: string;
  description: string | null;
  amountCents: number;
  recurrence: string;
  intervalCount: number;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  applyWhenNoEarnings: boolean;
  active: boolean;
  quantity: number | null;
}

const TYPE_LABEL: Record<string, string> = {
  DEDUCTION: 'Deduction',
  REIMBURSEMENT: 'Reimbursement',
  ADVANCE: 'Advance',
  OTHER_PAY: 'Other pay',
};

const RECURRENCE_LABEL: Record<string, string> = {
  EVERY_PAY_PERIOD: 'Every pay period',
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Biweekly',
  MONTHLY: 'Monthly',
  FIXED_OCCURRENCES: 'Fixed occurrences',
};

export function RecurringItemsPage() {
  const { me } = useAuth();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<RecurringItem | null>(null);
  const people = useAsync<Person[]>(() => api('/users'));
  const items = useAsync<RecurringItem[]>(() => (selectedUserId ? api(`/users/${selectedUserId}/recurring-items`) : Promise.resolve([])), [selectedUserId]);

  if (!me) return null;
  const isDriver = me.role === 'DRIVER';
  const effectiveUserId = selectedUserId ?? (isDriver ? me.id : null);
  const canManage = me.role === 'SUPER_ACCOUNT_MANAGER' || me.role === 'ASSISTANT_ACCOUNT_MANAGER';

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Recurring Items</h1>
        {effectiveUserId && canManage ? (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setShowCreate(true);
            }}
          >
            + Add item
          </button>
        ) : null}
      </div>

      {!isDriver ? (
        <div className="card mb-16">
          <div className="flex" style={{ alignItems: 'center', gap: 8 }}>
            <label className="small muted">Person</label>
            <select className="input" value={selectedUserId ?? ''} onChange={(e) => setSelectedUserId(e.target.value || null)}>
              <option value="">Select a person…</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} ({p.employeeCode}) — {p.role.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="card">
        {!effectiveUserId ? (
          <EmptyState title="Select a person" hint="Choose a person above to view their recurring items." />
        ) : items.loading ? (
          <Spinner />
        ) : items.error ? (
          <ErrorBox error={items.error} />
        ) : items.data && items.data.length === 0 ? (
          <EmptyState title="No recurring items" hint="Add deductions, reimbursements, advances, or other recurring pay." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th className="num">Amount</th>
                  <th>Recurrence</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.data?.map((it) => (
                  <tr key={it.id}>
                    <td>
                      {it.name}
                      {it.description ? <div className="small muted">{it.description}</div> : null}
                    </td>
                    <td>{TYPE_LABEL[it.itemType] ?? it.itemType}</td>
                    <td className="num">{money(it.amountCents)}</td>
                    <td className="small">
                      {RECURRENCE_LABEL[it.recurrence] ?? it.recurrence}
                      {it.recurrence === 'MONTHLY' && it.dayOfMonth ? ` (day ${it.dayOfMonth})` : ''}
                      {it.intervalCount > 1 ? ` ×${it.intervalCount}` : ''}
                    </td>
                    <td className="small">{dateOnly(it.startDate)}</td>
                    <td className="small muted">{it.endDate ? dateOnly(it.endDate) : '—'}</td>
                    <td>
                      <Badge tone={it.active ? 'green' : 'gray'}>{it.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="num">
                      {canManage ? (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            setEditing(it);
                            setShowCreate(true);
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {effectiveUserId && showCreate ? (
        <ItemFormModal
          userId={effectiveUserId}
          item={editing}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            setEditing(null);
            items.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ItemFormModal({ userId, item, onClose, onDone }: { userId: string; item: RecurringItem | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    itemType: item?.itemType ?? 'REIMBURSEMENT',
    name: item?.name ?? '',
    description: item?.description ?? '',
    amountCents: item ? String(item.amountCents / 100) : '',
    recurrence: item?.recurrence ?? 'EVERY_PAY_PERIOD',
    intervalCount: item ? String(item.intervalCount) : '1',
    dayOfMonth: item?.dayOfMonth ? String(item.dayOfMonth) : '',
    startDate: item ? dateOnly(item.startDate) : '',
    endDate: item?.endDate ? dateOnly(item.endDate) : '',
    maxOccurrences: item?.maxOccurrences ? String(item.maxOccurrences) : '',
    applyWhenNoEarnings: item?.applyWhenNoEarnings ?? false,
    quantity: item?.quantity ? String(item.quantity) : '',
    active: item?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const payload = {
      itemType: form.itemType,
      name: form.name,
      description: form.description || undefined,
      amountCents: Math.round(Number(form.amountCents) * 100),
      recurrence: form.recurrence,
      intervalCount: Number(form.intervalCount) || 1,
      dayOfMonth: form.recurrence === 'MONTHLY' && form.dayOfMonth ? Number(form.dayOfMonth) : null,
      startDate: form.startDate,
      endDate: form.endDate || null,
      maxOccurrences: form.maxOccurrences ? Number(form.maxOccurrences) : null,
      applyWhenNoEarnings: form.applyWhenNoEarnings,
      quantity: form.quantity ? Number(form.quantity) : null,
      ...(item ? { active: form.active } : {}),
    };
    try {
      if (item) {
        await api(`/recurring-items/${item.id}`, { method: 'PATCH', body: payload });
      } else {
        await api(`/users/${userId}/recurring-items`, { method: 'POST', body: payload });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save item.');
    } finally {
      setBusy(false);
    }
  };

  const valid = form.name && form.amountCents !== '' && form.startDate && (form.recurrence !== 'MONTHLY' || form.dayOfMonth);

  return (
    <Modal
      title={item ? `Edit ${item.name}` : 'Add recurring item'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !valid}>
            {busy ? 'Saving…' : item ? 'Save changes' : 'Add item'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Type">
          <select value={form.itemType} onChange={set('itemType')}>
            <option value="REIMBURSEMENT">Reimbursement</option>
            <option value="DEDUCTION">Deduction</option>
            <option value="ADVANCE">Advance</option>
            <option value="OTHER_PAY">Other pay</option>
          </select>
        </Field>
        <Field label="Name">
          <input value={form.name} onChange={set('name')} required placeholder="e.g. CELL PHONE" />
        </Field>
        <Field label="Amount ($)">
          <input type="number" min={0} step="0.01" value={form.amountCents} onChange={set('amountCents')} required />
        </Field>
        <Field label="Recurrence">
          <select value={form.recurrence} onChange={set('recurrence')}>
            {Object.entries(RECURRENCE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        {form.recurrence === 'WEEKLY' || form.recurrence === 'BIWEEKLY' ? (
          <Field label="Interval count">
            <input type="number" min={1} value={form.intervalCount} onChange={set('intervalCount')} />
          </Field>
        ) : null}
        {form.recurrence === 'MONTHLY' ? (
          <Field label="Day of month">
            <input type="number" min={1} max={31} value={form.dayOfMonth} onChange={set('dayOfMonth')} required />
          </Field>
        ) : null}
        <Field label="Start date">
          <input type="date" value={form.startDate} onChange={set('startDate')} required />
        </Field>
        <Field label="End date (optional)">
          <input type="date" value={form.endDate} onChange={set('endDate')} />
        </Field>
        {form.recurrence === 'FIXED_OCCURRENCES' ? (
          <Field label="Max occurrences">
            <input type="number" min={1} value={form.maxOccurrences} onChange={set('maxOccurrences')} />
          </Field>
        ) : null}
        <Field label="Quantity (optional)">
          <input type="number" min={1} value={form.quantity} onChange={set('quantity')} />
        </Field>
        <Field label="Description">
          <input value={form.description} onChange={set('description')} />
        </Field>
        <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
          <label className="checkbox-line">
            <input type="checkbox" checked={form.applyWhenNoEarnings} onChange={set('applyWhenNoEarnings')} />
            Apply even when there are no earnings this period
          </label>
          {item ? (
            <label className="checkbox-line">
              <input type="checkbox" checked={form.active} onChange={set('active')} />
              Active
            </label>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
