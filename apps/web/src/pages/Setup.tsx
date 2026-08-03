import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Field } from '../components/ui';

export function SetupPage() {
  const { completeSetup } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    companyName: '',
    legalName: '',
    city: '',
    state: '',
    timezone: 'America/Chicago',
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    employeeCode: '',
    password: '',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await completeSetup({
        company: {
          companyName: form.companyName,
          legalName: form.legalName,
          city: form.city || undefined,
          state: form.state || undefined,
          timezone: form.timezone,
          weekStartDay: 6,
          payrollTriggerCron: '0 0 * * 6',
          settlementPrefix: 'ST-',
          settlementPadding: 5,
          batchPrefix: 'SB-',
          batchPadding: 3,
        },
        admin: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          username: form.username,
          employeeCode: form.employeeCode,
          password: form.password,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="auth-logo">C</div>
        <h1>Set up CarrierPay</h1>
        <div className="sub">Create your company profile and the first administrator account.</div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form onSubmit={submit}>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-3)' }}>Company</h3>
          <div className="form-grid">
            <Field label="Company name">
              <input value={form.companyName} onChange={set('companyName')} required />
            </Field>
            <Field label="Legal name">
              <input value={form.legalName} onChange={set('legalName')} required />
            </Field>
            <Field label="City">
              <input value={form.city} onChange={set('city')} />
            </Field>
            <Field label="State">
              <input value={form.state} onChange={set('state')} maxLength={2} />
            </Field>
            <Field label="Timezone">
              <select value={form.timezone} onChange={set('timezone')}>
                <option value="America/Chicago">America/Chicago</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Denver">America/Denver</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
          </div>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-3)', marginTop: 20 }}>Administrator</h3>
          <div className="form-grid">
            <Field label="First name">
              <input value={form.firstName} onChange={set('firstName')} required />
            </Field>
            <Field label="Last name">
              <input value={form.lastName} onChange={set('lastName')} required />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="Username">
              <input value={form.username} onChange={set('username')} required minLength={3} />
            </Field>
            <Field label="Employee code">
              <input value={form.employeeCode} onChange={set('employeeCode')} required />
            </Field>
            <Field label="Password (12+ characters)" hint="You will be prompted to change it after first login.">
              <input type="password" value={form.password} onChange={set('password')} required minLength={12} />
            </Field>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Creating…' : 'Create company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
