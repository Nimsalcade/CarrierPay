import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { ErrorBox, Field, Spinner } from '../components/ui';

interface Settings {
  id: string;
  companyName: string;
  legalName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  weekStartDay: number;
  payrollTriggerCron: string;
  goLiveDate: string | null;
  settlementPrefix: string;
  settlementPadding: number;
  batchPrefix: string;
  batchPadding: number;
  separateReimbursements: boolean;
  createZeroPayEntries: boolean;
  prorateAssistantPay: boolean;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SettingsPage() {
  const { me } = useAuth();
  const { data, loading, error, reload } = useAsync<Settings>(() => api('/settings'));
  const [form, setForm] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm((f) => f ?? data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!me) return null;
  const isSuper = me.role === 'SUPER_ACCOUNT_MANAGER';
  const isManager = isSuper || me.role === 'ASSISTANT_ACCOUNT_MANAGER';

  if (!isManager) return <ErrorBox error="You do not have access to company settings." />;

  if (loading || !form) {
    return (
      <div className="card">
        <Spinner />
      </div>
    );
  }

  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => (f ? { ...f, [k]: value } : f));
  };

  const num = (k: 'settlementPadding' | 'batchPadding' | 'weekStartDay') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: Number(e.target.value) } : f));

  const save = async () => {
    setBusy(true);
    setSaveErr(null);
    setMsg(null);
    try {
      await api('/settings', {
        method: 'PATCH',
        body: {
          companyName: form.companyName,
          legalName: form.legalName,
          addressLine1: form.addressLine1 || undefined,
          addressLine2: form.addressLine2 || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          zip: form.zip || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          timezone: form.timezone,
          weekStartDay: form.weekStartDay,
          payrollTriggerCron: form.payrollTriggerCron,
          goLiveDate: form.goLiveDate ? form.goLiveDate.slice(0, 10) : undefined,
          settlementPrefix: form.settlementPrefix,
          settlementPadding: form.settlementPadding,
          batchPrefix: form.batchPrefix,
          batchPadding: form.batchPadding,
          separateReimbursements: form.separateReimbursements,
          createZeroPayEntries: form.createZeroPayEntries,
          prorateAssistantPay: form.prorateAssistantPay,
        },
      });
      setMsg('Settings saved.');
      reload();
    } catch (err) {
      setSaveErr(err instanceof ApiError ? err.message : 'Failed to save settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Company Settings</h1>
        {isSuper ? (
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        ) : null}
      </div>
      {msg ? <div className="alert alert-success">{msg}</div> : null}
      {saveErr ? <div className="alert alert-error">{saveErr}</div> : null}
      {error ? <ErrorBox error={error} /> : null}

      <div className="card mb-16">
        <h3 className="mb-16">Company</h3>
        <div className="form-grid">
          <Field label="Company name">
            <input value={form.companyName} onChange={set('companyName')} disabled={!isSuper} />
          </Field>
          <Field label="Legal name">
            <input value={form.legalName} onChange={set('legalName')} disabled={!isSuper} />
          </Field>
          <Field label="Address line 1">
            <input value={form.addressLine1 ?? ''} onChange={set('addressLine1')} disabled={!isSuper} />
          </Field>
          <Field label="Address line 2">
            <input value={form.addressLine2 ?? ''} onChange={set('addressLine2')} disabled={!isSuper} />
          </Field>
          <Field label="City">
            <input value={form.city ?? ''} onChange={set('city')} disabled={!isSuper} />
          </Field>
          <Field label="State">
            <input maxLength={2} value={form.state ?? ''} onChange={set('state')} disabled={!isSuper} />
          </Field>
          <Field label="ZIP">
            <input value={form.zip ?? ''} onChange={set('zip')} disabled={!isSuper} />
          </Field>
          <Field label="Phone">
            <input value={form.phone ?? ''} onChange={set('phone')} disabled={!isSuper} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email ?? ''} onChange={set('email')} disabled={!isSuper} />
          </Field>
        </div>
      </div>

      <div className="card mb-16">
        <h3 className="mb-16">Payroll calendar</h3>
        <div className="form-grid">
          <Field label="Timezone">
            <select value={form.timezone} onChange={set('timezone')} disabled={!isSuper}>
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Week starts on">
            <select value={form.weekStartDay} onChange={num('weekStartDay')} disabled={!isSuper}>
              {WEEK_DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payroll trigger cron" hint="Determines when the weekly payroll window closes.">
            <input value={form.payrollTriggerCron} onChange={set('payrollTriggerCron')} disabled={!isSuper} className="mono" />
          </Field>
          <Field label="Go-live date">
            <input type="date" value={form.goLiveDate ? form.goLiveDate.slice(0, 10) : ''} onChange={set('goLiveDate')} disabled={!isSuper} />
          </Field>
        </div>
      </div>

      <div className="card mb-16">
        <h3 className="mb-16">Settlement numbering</h3>
        <div className="form-grid">
          <Field label="Settlement prefix">
            <input value={form.settlementPrefix} onChange={set('settlementPrefix')} disabled={!isSuper} className="mono" />
          </Field>
          <Field label="Settlement padding">
            <input type="number" min={3} max={10} value={form.settlementPadding} onChange={num('settlementPadding')} disabled={!isSuper} />
          </Field>
          <Field label="Batch prefix">
            <input value={form.batchPrefix} onChange={set('batchPrefix')} disabled={!isSuper} className="mono" />
          </Field>
          <Field label="Batch padding">
            <input type="number" min={2} max={10} value={form.batchPadding} onChange={num('batchPadding')} disabled={!isSuper} />
          </Field>
        </div>
      </div>

      <div className="card mb-16">
        <h3 className="mb-16">Payroll behavior</h3>
        <div className="form-grid">
          <label className="checkbox-line">
            <input type="checkbox" checked={form.separateReimbursements} onChange={set('separateReimbursements')} disabled={!isSuper} />
            Show reimbursements as a separate check line
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={form.createZeroPayEntries} onChange={set('createZeroPayEntries')} disabled={!isSuper} />
            Create entries even when net pay is zero
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={form.prorateAssistantPay} onChange={set('prorateAssistantPay')} disabled={!isSuper} />
            Prorate assistant manager pay
          </label>
        </div>
      </div>

      {!isSuper ? (
        <div className="small muted">Assistant managers can view settings but only the super manager can edit them.</div>
      ) : null}
    </div>
  );
}
