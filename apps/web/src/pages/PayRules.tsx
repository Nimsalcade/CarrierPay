import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Badge, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { dt, money, pct } from '../lib/format';

interface Person {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  status: string;
}

interface RuleComponent {
  id: string;
  componentType: string;
  calculationMethod: string;
  displayLabel: string | null;
  amountCents: number | null;
  rateBasisPoints: number | null;
  centsPerMile: number | null;
  thresholdCents: number | null;
  sequence: number;
}

interface RuleSet {
  id: string;
  userId: string;
  role: string;
  name: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  notes: string | null;
  components: RuleComponent[];
}

interface ComponentDraft {
  componentType: string;
  calculationMethod: string;
  displayLabel: string;
  amountCents: string;
  rateBasisPoints: string;
  centsPerMile: string;
  thresholdCents: string;
}

const TYPE_LABEL: Record<string, string> = {
  LOAD_EARNING: 'Load earning',
  LOAD_COMMISSION: 'Load commission',
  WEEKLY_BASE: 'Weekly base',
  ACTIVE_DRIVER_BONUS: 'Active-driver bonus',
  PAYROLL_EARNINGS_PERCENT: 'Percent of payroll earnings',
  MINIMUM_WEEKLY_GUARANTEE: 'Minimum weekly guarantee',
  TIERED_COMMISSION: 'Tiered commission',
  ROLE_BONUS: 'Role bonus',
};

interface MethodOpt {
  method: string;
  label: string;
  fields: Array<'amountCents' | 'rateBasisPoints' | 'centsPerMile' | 'thresholdCents'>;
}

const METHODS_BY_TYPE: Record<string, MethodOpt[]> = {
  LOAD_EARNING: [
    { method: 'PERCENT_OF_LOAD_GROSS', fields: ['rateBasisPoints'], label: 'Percent of load gross' },
    { method: 'FIXED_PER_LOAD', fields: ['amountCents'], label: 'Fixed per load' },
    { method: 'CENTS_PER_LOADED_MILE', fields: ['centsPerMile'], label: 'Cents per loaded mile' },
    { method: 'CENTS_PER_TOTAL_MILE', fields: ['centsPerMile'], label: 'Cents per total mile' },
  ],
  LOAD_COMMISSION: [
    { method: 'PERCENT_OF_BOOKED_LOAD_GROSS', fields: ['rateBasisPoints'], label: 'Percent of booked load gross' },
    { method: 'FIXED_PER_LOAD', fields: ['amountCents'], label: 'Fixed per load' },
  ],
  WEEKLY_BASE: [{ method: 'FLAT_WEEKLY', fields: ['amountCents'], label: 'Flat weekly' }],
  ACTIVE_DRIVER_BONUS: [{ method: 'FIXED_PER_ACTIVE_DRIVER', fields: ['amountCents'], label: 'Fixed per active driver' }],
  PAYROLL_EARNINGS_PERCENT: [{ method: 'PERCENT_OF_PAYROLL_EARNINGS', fields: ['rateBasisPoints'], label: 'Percent of payroll earnings' }],
  MINIMUM_WEEKLY_GUARANTEE: [{ method: 'TIERED_WHOLE_PERIOD', fields: ['amountCents'], label: 'Weekly guarantee amount' }],
  TIERED_COMMISSION: [
    { method: 'TIERED_MARGINAL', fields: ['thresholdCents', 'rateBasisPoints'], label: 'Tiered marginal' },
    { method: 'TIERED_WHOLE_PERIOD', fields: ['thresholdCents', 'rateBasisPoints'], label: 'Tiered whole-period' },
  ],
  ROLE_BONUS: [{ method: 'MANUAL_BONUS', fields: ['amountCents'], label: 'Manual bonus' }],
};

export function PayRulesPage() {
  const { me } = useAuth();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const people = useAsync<Person[]>(() => api('/users'));
  const rules = useAsync<RuleSet[]>(() => (selectedUserId ? api(`/users/${selectedUserId}/pay-rules`) : Promise.resolve([])), [selectedUserId]);

  if (!me) return null;
  const isDriver = me.role === 'DRIVER';
  const effectiveUserId = selectedUserId ?? (isDriver ? me.id : null);

  const canCreate = me.role === 'SUPER_ACCOUNT_MANAGER' || me.role === 'ASSISTANT_ACCOUNT_MANAGER';

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Pay Rules</h1>
        {effectiveUserId && canCreate ? (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New rule
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
          <EmptyState title="Select a person" hint="Choose a person above to view their pay rules." />
        ) : rules.loading ? (
          <Spinner />
        ) : rules.error ? (
          <ErrorBox error={rules.error} />
        ) : rules.data && rules.data.length === 0 ? (
          <EmptyState title="No pay rules yet" hint="Create a rule set for this person to start calculating earnings." />
        ) : (
          <div className="stack">
            {rules.data?.map((r) => (
              <RuleCard key={r.id} rule={r} onEnded={rules.reload} canManage={canCreate} />
            ))}
          </div>
        )}
      </div>

      {effectiveUserId && showCreate ? (
        <CreateRuleModal
          userId={effectiveUserId}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            rules.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function RuleCard({ rule, onEnded, canManage }: { rule: RuleSet; onEnded: () => void; canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRule = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/pay-rules/${rule.id}/end`, { method: 'POST' });
      onEnded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to end rule.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="flex-between">
        <div>
          <strong>{rule.name}</strong> <Badge tone="indigo">v{rule.version}</Badge> <StatusBadge status={rule.status} />
          <div className="small muted">
            {rule.effectiveFrom.slice(0, 10)} → {rule.effectiveTo ? rule.effectiveTo.slice(0, 10) : 'open-ended'}
            {rule.notes ? ` · ${rule.notes}` : ''}
          </div>
        </div>
        {canManage && rule.status === 'ACTIVE' ? (
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void endRule()}>
            {busy ? 'Ending…' : 'End rule'}
          </button>
        ) : null}
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="mt-8">
        {rule.components.map((c) => (
          <div key={c.id} className="small flex-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <span>
              {TYPE_LABEL[c.componentType] ?? c.componentType}
              {c.displayLabel ? ` — ${c.displayLabel}` : ''}
              <span className="muted"> · {c.calculationMethod.replace(/_/g, ' ').toLowerCase()}</span>
            </span>
            <span className="mono">{c.amountCents != null ? money(c.amountCents) : c.rateBasisPoints != null ? pct(c.rateBasisPoints) : c.centsPerMile != null ? `¢${c.centsPerMile}/mi` : c.thresholdCents != null ? `≥${money(c.thresholdCents)}` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateRuleModal({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [notes, setNotes] = useState('');
  const [components, setComponents] = useState<ComponentDraft[]>([
    { componentType: 'LOAD_EARNING', calculationMethod: 'PERCENT_OF_LOAD_GROSS', displayLabel: '', amountCents: '', rateBasisPoints: '3000', centsPerMile: '', thresholdCents: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateComp = (i: number, patch: Partial<ComponentDraft>) => {
    setComponents((cs) => {
      const next = cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
      // When the type changes, reset method to the first available option.
      if (patch.componentType) {
        const opts = METHODS_BY_TYPE[patch.componentType] ?? [];
        const first = opts[0];
        next[i] = { ...next[i]!, calculationMethod: first?.method ?? '' };
      }
      return next;
    });
  };

  const addComp = () =>
    setComponents((cs) => [
      ...cs,
      { componentType: 'LOAD_EARNING', calculationMethod: 'PERCENT_OF_LOAD_GROSS', displayLabel: '', amountCents: '', rateBasisPoints: '3000', centsPerMile: '', thresholdCents: '' },
    ]);

  const removeComp = (i: number) => setComponents((cs) => cs.filter((_, idx) => idx !== i));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${userId}/pay-rules`, {
        method: 'POST',
        body: {
          name,
          effectiveFrom,
          effectiveTo: effectiveTo || null,
          notes: notes || undefined,
          components: components.map((c, i) => ({
            componentType: c.componentType,
            calculationMethod: c.calculationMethod,
            displayLabel: c.displayLabel || undefined,
            amountCents: c.amountCents === '' ? undefined : Math.round(Number(c.amountCents) * 100),
            rateBasisPoints: c.rateBasisPoints === '' ? undefined : Number(c.rateBasisPoints),
            centsPerMile: c.centsPerMile === '' ? undefined : Math.round(Number(c.centsPerMile) * 100),
            thresholdCents: c.thresholdCents === '' ? undefined : Math.round(Number(c.thresholdCents) * 100),
            sequence: i,
          })),
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create rule.');
    } finally {
      setBusy(false);
    }
  };

  const valid = name && effectiveFrom && components.every((c) => c.componentType && c.calculationMethod);

  return (
    <Modal
      title="New pay rule"
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !valid}>
            {busy ? 'Creating…' : 'Create rule'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Rule name">
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Driver 30% linehaul" />
        </Field>
        <Field label="Effective from">
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </Field>
        <Field label="Effective to (optional)">
          <input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
        </Field>
        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <div className="small muted mb-16" style={{ marginTop: 8 }}>
        Starting a new rule automatically ends the current active rule the day before.
      </div>

      {components.map((c, i) => {
        const opts = METHODS_BY_TYPE[c.componentType] ?? [];
        return (
          <div key={i} className="panel mb-16">
            <div className="flex-between mb-16">
              <strong>Component {i + 1}</strong>
              {components.length > 1 ? (
                <button className="btn btn-ghost btn-sm" onClick={() => removeComp(i)}>
                  Remove
                </button>
              ) : null}
            </div>
            <div className="form-grid">
              <Field label="Type">
                <select value={c.componentType} onChange={(e) => updateComp(i, { componentType: e.target.value })}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Method">
                <select value={c.calculationMethod} onChange={(e) => updateComp(i, { calculationMethod: e.target.value })}>
                  {opts.map((o) => (
                    <option key={o.method} value={o.method}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Display label (optional)">
                <input value={c.displayLabel} onChange={(e) => updateComp(i, { displayLabel: e.target.value })} />
              </Field>
              {opts.find((o) => o.method === c.calculationMethod)?.fields.includes('amountCents') ? (
                <Field label="Amount ($)">
                  <input type="number" min={0} step="0.01" value={c.amountCents} onChange={(e) => updateComp(i, { amountCents: e.target.value })} />
                </Field>
              ) : null}
              {opts.find((o) => o.method === c.calculationMethod)?.fields.includes('rateBasisPoints') ? (
                <Field label="Rate (%)">
                  <input type="number" min={0} max={100} step="0.01" value={c.rateBasisPoints} onChange={(e) => updateComp(i, { rateBasisPoints: e.target.value })} />
                </Field>
              ) : null}
              {opts.find((o) => o.method === c.calculationMethod)?.fields.includes('centsPerMile') ? (
                <Field label="¢ per mile">
                  <input type="number" min={0} step="0.01" value={c.centsPerMile} onChange={(e) => updateComp(i, { centsPerMile: e.target.value })} />
                </Field>
              ) : null}
              {opts.find((o) => o.method === c.calculationMethod)?.fields.includes('thresholdCents') ? (
                <Field label="Threshold ($)">
                  <input type="number" min={0} step="0.01" value={c.thresholdCents} onChange={(e) => updateComp(i, { thresholdCents: e.target.value })} />
                </Field>
              ) : null}
            </div>
          </div>
        );
      })}
      <button className="btn btn-outline btn-sm" onClick={addComp}>
        + Add component
      </button>
    </Modal>
  );
}
