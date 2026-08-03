import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field } from '../components/ui';

export function ChangePasswordPage() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setOk(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Change password</h1>
      <div className="card card-pad" style={{ maxWidth: 460 }}>
        <div className="small muted mb-16">
          Signed in as {me?.firstName} {me?.lastName}. Your password must be at least 12 characters.
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {ok ? <div className="alert alert-success">Password updated successfully.</div> : null}
        <form onSubmit={submit}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <Field label="Current password">
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
            </Field>
            <Field label="New password">
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void logout().then(() => navigate('/login'))}>
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
