import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { has } from '../lib/perms';
import { Badge, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { dt } from '../lib/format';

interface User {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  employeeCode: string;
  status: string;
  driverType: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

interface UserPage {
  items: User[];
  total: number;
  page: number;
  pageSize: number;
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ACCOUNT_MANAGER: 'Super manager',
  ASSISTANT_ACCOUNT_MANAGER: 'Assistant manager',
  DISPATCHER: 'Dispatcher',
  DRIVER: 'Driver',
};

export function UsersPage() {
  const { me } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const { data, loading, error, reload } = useAsync<UserPage>(() => api('/users'));

  if (!me) return null;
  const canCreate = has(me.permissions, 'users.manage') || has(me.permissions, 'users.create_staff') || has(me.permissions, 'users.create_drivers');
  const canManage = has(me.permissions, 'users.manage');

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Staff &amp; Drivers</h1>
        {canCreate ? (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Add person
          </button>
        ) : null}
      </div>
      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No people yet" hint="Add your first driver, dispatcher, or manager." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="num">Hired</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.employeeCode}</td>
                    <td>
                      {u.firstName} {u.lastName}
                      <div className="small muted">{u.email ?? u.username ?? ''}</div>
                    </td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td>
                      <StatusBadge status={u.status} />
                      {u.mustChangePassword ? <Badge tone="amber">pw reset</Badge> : null}
                    </td>
                    <td className="num">{u.hireDate ? u.hireDate.slice(0, 10) : '—'}</td>
                    <td className="num">
                      {canManage ? (
                        <button className="btn btn-outline btn-sm" onClick={() => setSelected(u)}>
                          Manage
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

      {showCreate ? (
        <UserFormModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            reload();
          }}
        />
      ) : null}
      {selected ? (
        <UserManageModal
          user={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function UserFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me } = useAuth();
  const [form, setForm] = useState({
    role: 'DRIVER',
    firstName: '',
    lastName: '',
    employeeCode: '',
    email: '',
    username: '',
    phone: '',
    hireDate: '',
    driverType: '',
    temporaryPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/users', {
        method: 'POST',
        body: {
          role: form.role,
          firstName: form.firstName,
          lastName: form.lastName,
          employeeCode: form.employeeCode,
          email: form.email || undefined,
          username: form.username || undefined,
          phone: form.phone || undefined,
          hireDate: form.hireDate || undefined,
          driverType: form.driverType || undefined,
          temporaryPassword: form.temporaryPassword,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create user.');
    } finally {
      setBusy(false);
    }
  };

  const isAssistant = me?.role === 'ASSISTANT_ACCOUNT_MANAGER';

  return (
    <Modal
      title="Add a person"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Role">
          <select value={form.role} onChange={set('role')}>
            {!isAssistant ? <option value="SUPER_ACCOUNT_MANAGER">Super manager</option> : null}
            {!isAssistant ? <option value="ASSISTANT_ACCOUNT_MANAGER">Assistant manager</option> : null}
            {!isAssistant ? <option value="DISPATCHER">Dispatcher</option> : null}
            <option value="DRIVER">Driver</option>
          </select>
        </Field>
        <Field label="Employee code">
          <input value={form.employeeCode} onChange={set('employeeCode')} required />
        </Field>
        <Field label="First name">
          <input value={form.firstName} onChange={set('firstName')} required />
        </Field>
        <Field label="Last name">
          <input value={form.lastName} onChange={set('lastName')} required />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Username">
          <input value={form.username} onChange={set('username')} />
        </Field>
        <Field label="Phone">
          <input value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Hire date">
          <input type="date" value={form.hireDate} onChange={set('hireDate')} />
        </Field>
        {form.role === 'DRIVER' ? (
          <Field label="Driver type">
            <select value={form.driverType} onChange={set('driverType')}>
              <option value="">—</option>
              <option value="CONTRACTOR">Contractor</option>
              <option value="EMPLOYEE">Employee</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
        ) : null}
        <Field label="Temporary password" hint="Min 12 characters. The user must change it at first login.">
          <input type="password" value={form.temporaryPassword} onChange={set('temporaryPassword')} required minLength={12} />
        </Field>
      </div>
    </Modal>
  );
}

function UserManageModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'status' | 'password' | 'role'>('status');
  const [status, setStatus] = useState(user.status);
  const [reason, setReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState(user.role);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(success);
      setTimeout(onDone, 700);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Manage ${user.firstName} ${user.lastName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="flex mb-16">
        <button className={`btn ${tab === 'status' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setTab('status')}>
          Status
        </button>
        <button className={`btn ${tab === 'password' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setTab('password')}>
          Reset password
        </button>
        <button className={`btn ${tab === 'role' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setTab('role')}>
          Convert role
        </button>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {ok ? <div className="alert alert-success">{ok}</div> : null}

      {tab === 'status' ? (
        <div className="form-grid">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
            </select>
          </Field>
          <Field label="Reason">
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          </Field>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button
              className="btn btn-primary"
              disabled={busy || status === user.status}
              onClick={() =>
                void act(async () => {
                  await api(`/users/${user.id}/status`, { method: 'POST', body: { status, reason } });
                }, 'Status updated.')
              }
            >
              Apply status
            </button>
          </div>
          <div className="small muted" style={{ gridColumn: '1 / -1' }}>
            {user.hireDate ? <>Hired {user.hireDate.slice(0, 10)}</> : null}
            {user.terminationDate ? <> · Terminated {user.terminationDate.slice(0, 10)}</> : null}
            {user.mustChangePassword ? ' · Password reset pending' : null}
          </div>
        </div>
      ) : null}

      {tab === 'password' ? (
        <div className="form-grid">
          <Field label="New temporary password" hint="All existing sessions will be signed out.">
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={12} />
          </Field>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button
              className="btn btn-primary"
              disabled={busy || newPassword.length < 12}
              onClick={() =>
                void act(async () => {
                  await api(`/users/${user.id}/reset-password`, { method: 'POST', body: { newTemporaryPassword: newPassword } });
                }, 'Password reset.')
              }
            >
              Reset password
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'role' ? (
        <div className="form-grid">
          <Field label="New role">
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              {Object.keys(ROLE_LABEL).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason">
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          </Field>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button
              className="btn btn-primary"
              disabled={busy || newRole === user.role}
              onClick={() =>
                void act(async () => {
                  await api(`/users/${user.id}/convert-role`, { method: 'POST', body: { role: newRole, reason } });
                }, 'Role converted. The user needs a new pay rule for the new role.')
              }
            >
              Convert role
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
