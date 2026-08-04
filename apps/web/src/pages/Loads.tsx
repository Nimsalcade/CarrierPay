import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Badge, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { LOAD_TRANSITIONS } from '@carrierpay/shared';
import { dt, money } from '../lib/format';

interface DriverOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

interface EquipmentOption {
  id: string;
  type: string;
  unitNumber: string;
  status: string;
}

interface LoadItem {
  id: string;
  loadNumber: string;
  status: string;
  customerName: string;
  originFacility: string;
  destinationFacility: string;
  pickupAt: string | null;
  deliveryAt: string | null;
  grossRateCents: number;
  loadedMilesHundredths: number;
  emptyMilesHundredths: number;
  driver: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
  bookedBy: { id: string; firstName: string; lastName: string } | null;
}

interface LoadPage {
  items: LoadItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface AttachmentItem {
  id: string;
  kind: 'POD' | 'RATE_CONFIRMATION';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const ATTACHMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/tiff';

export function LoadsPage() {
  const { me } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<LoadItem | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const { data, loading, error, reload } = useAsync<LoadPage>(
    () => api('/loads', { query: { status: statusFilter || undefined } }),
    [statusFilter],
  );

  if (!me) return null;
  const canCreate = me.role === 'DISPATCHER' || me.role === 'SUPER_ACCOUNT_MANAGER';

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Loads</h1>
        <div className="flex">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input">
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="BOOKED">Booked</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_TRANSIT">In transit</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="PAYROLL_LOCKED">Payroll locked</option>
          </select>
          {canCreate ? (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + Book load
            </button>
          ) : null}
        </div>
      </div>
      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No loads match" hint="Book a new load to get started." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Load #</th>
                  <th>Customer</th>
                  <th>Route</th>
                  <th>Driver</th>
                  <th className="num">Gross</th>
                  <th className="num">Miles</th>
                  <th>Delivery</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.loadNumber}</td>
                    <td>{l.customerName}</td>
                    <td className="small">
                      {l.originFacility} → {l.destinationFacility}
                    </td>
                    <td>
                      {l.driver ? `${l.driver.firstName} ${l.driver.lastName}` : <span className="muted">Unassigned</span>}
                    </td>
                    <td className="num">{money(l.grossRateCents)}</td>
                    <td className="num">{(l.loadedMilesHundredths / 100).toFixed(0)}</td>
                    <td className="small muted">{dt(l.deliveryAt)}</td>
                    <td>
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="num">
                      <button className="btn btn-outline btn-sm" onClick={() => setSelected(l)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate ? (
        <LoadFormModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            reload();
          }}
        />
      ) : null}
      {selected ? (
        <LoadManageModal
          load={selected}
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

function LoadFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me } = useAuth();
  const drivers = useAsync<DriverOption[]>(() => api('/drivers'));
  const trucks = useAsync<EquipmentOption[]>(() => api('/equipment', { query: { type: 'TRUCK' } }));
  const trailers = useAsync<EquipmentOption[]>(() => api('/equipment', { query: { type: 'TRAILER' } }));

  const [form, setForm] = useState({
    loadNumber: '',
    driverUserId: '',
    truckId: '',
    trailerId: '',
    customerName: '',
    confirmationNumber: '',
    originFacility: '',
    originCity: '',
    originState: '',
    originZip: '',
    pickupAt: '',
    destinationFacility: '',
    destinationCity: '',
    destinationState: '',
    destinationZip: '',
    deliveryAt: '',
    grossRateCents: '',
    accessorialGrossCents: '',
    loadedMilesHundredths: '',
    emptyMilesHundredths: '',
    status: 'DRAFT',
    internalNotes: '',
    driverInstructions: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const cents = (v: string) => (v === '' ? 0 : Math.round(Number(v) * 100));
    const miles = (v: string) => (v === '' ? 0 : Math.round(Number(v) * 100));
    try {
      await api('/loads', {
        method: 'POST',
        body: {
          loadNumber: form.loadNumber,
          driverUserId: form.driverUserId,
          truckId: form.truckId || null,
          trailerId: form.trailerId || null,
          customerName: form.customerName,
          confirmationNumber: form.confirmationNumber || undefined,
          originFacility: form.originFacility,
          originCity: form.originCity || undefined,
          originState: form.originState || undefined,
          originZip: form.originZip || undefined,
          pickupAt: form.pickupAt || undefined,
          destinationFacility: form.destinationFacility,
          destinationCity: form.destinationCity || undefined,
          destinationState: form.destinationState || undefined,
          destinationZip: form.destinationZip || undefined,
          deliveryAt: form.deliveryAt || undefined,
          grossRateCents: cents(form.grossRateCents),
          accessorialGrossCents: form.accessorialGrossCents ? cents(form.accessorialGrossCents) : undefined,
          loadedMilesHundredths: miles(form.loadedMilesHundredths),
          emptyMilesHundredths: miles(form.emptyMilesHundredths),
          status: form.status,
          internalNotes: form.internalNotes || undefined,
          driverInstructions: form.driverInstructions || undefined,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to book load.');
    } finally {
      setBusy(false);
    }
  };

  const requiredFilled = form.loadNumber && form.driverUserId && form.customerName && form.originFacility && form.destinationFacility && form.grossRateCents !== '';

  return (
    <Modal
      title="Book a load"
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !requiredFilled}>
            {busy ? 'Saving…' : 'Book load'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Load number">
          <input value={form.loadNumber} onChange={set('loadNumber')} required placeholder="LD-1001" />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={set('status')}>
            <option value="DRAFT">Draft</option>
            <option value="BOOKED">Booked</option>
            <option value="ASSIGNED">Assigned</option>
          </select>
        </Field>
        <Field label="Driver">
          <select value={form.driverUserId} onChange={set('driverUserId')}>
            <option value="">Select a driver…</option>
            {drivers.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.firstName} {d.lastName} ({d.employeeCode})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer">
          <input value={form.customerName} onChange={set('customerName')} required />
        </Field>
        <Field label="Confirmation #">
          <input value={form.confirmationNumber} onChange={set('confirmationNumber')} />
        </Field>
        <Field label="Truck">
          <select value={form.truckId} onChange={set('truckId')}>
            <option value="">—</option>
            {trucks.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.unitNumber}
                {t.status !== 'AVAILABLE' ? ` (${t.status})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trailer">
          <select value={form.trailerId} onChange={set('trailerId')}>
            <option value="">—</option>
            {trailers.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.unitNumber}
                {t.status !== 'AVAILABLE' ? ` (${t.status})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Origin facility">
          <input value={form.originFacility} onChange={set('originFacility')} required />
        </Field>
        <Field label="Origin city">
          <input value={form.originCity} onChange={set('originCity')} />
        </Field>
        <Field label="Origin state">
          <input maxLength={2} value={form.originState} onChange={set('originState')} />
        </Field>
        <Field label="Origin ZIP">
          <input value={form.originZip} onChange={set('originZip')} />
        </Field>
        <Field label="Pickup at">
          <input type="datetime-local" value={form.pickupAt} onChange={set('pickupAt')} />
        </Field>
        <Field label="Destination facility">
          <input value={form.destinationFacility} onChange={set('destinationFacility')} required />
        </Field>
        <Field label="Destination city">
          <input value={form.destinationCity} onChange={set('destinationCity')} />
        </Field>
        <Field label="Destination state">
          <input maxLength={2} value={form.destinationState} onChange={set('destinationState')} />
        </Field>
        <Field label="Destination ZIP">
          <input value={form.destinationZip} onChange={set('destinationZip')} />
        </Field>
        <Field label="Delivered at">
          <input type="datetime-local" value={form.deliveryAt} onChange={set('deliveryAt')} />
        </Field>
        <Field label="Gross rate ($)">
          <input type="number" min={0} step="0.01" value={form.grossRateCents} onChange={set('grossRateCents')} required />
        </Field>
        <Field label="Accessorial ($)">
          <input type="number" min={0} step="0.01" value={form.accessorialGrossCents} onChange={set('accessorialGrossCents')} />
        </Field>
        <Field label="Loaded miles">
          <input type="number" min={0} step="0.01" value={form.loadedMilesHundredths} onChange={set('loadedMilesHundredths')} required />
        </Field>
        <Field label="Empty miles">
          <input type="number" min={0} step="0.01" value={form.emptyMilesHundredths} onChange={set('emptyMilesHundredths')} />
        </Field>
        <Field label="Driver instructions">
          <input value={form.driverInstructions} onChange={set('driverInstructions')} />
        </Field>
        <Field label="Internal notes">
          <input value={form.internalNotes} onChange={set('internalNotes')} />
        </Field>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        {me?.role === 'DISPATCHER' ? 'Dispatchers can only book loads for themselves.' : ''}
      </div>
    </Modal>
  );
}

function LoadManageModal({ load, onClose, onDone }: { load: LoadItem; onClose: () => void; onDone: () => void }) {
  const { me } = useAuth();
  const transitions = LOAD_TRANSITIONS[load.status as keyof typeof LOAD_TRANSITIONS] ?? [];
  const [toStatus, setToStatus] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Document attachments (POD / rate confirmation) — PRD §6.4
  const [attachments, setAttachments] = useState<AttachmentItem[] | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<'POD' | 'RATE_CONFIRMATION'>('POD');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<AttachmentItem[]>(`/loads/${load.id}/attachments`)
      .then((items) => {
        if (!cancelled) setAttachments(items);
      })
      .catch((err) => {
        if (!cancelled) setAttachError(err instanceof ApiError ? err.message : 'Failed to load attachments.');
      });
    return () => {
      cancelled = true;
    };
  }, [load.id]);

  const upload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setAttachError(null);
    try {
      const fd = new FormData();
      fd.append('kind', uploadKind);
      fd.append('file', uploadFile);
      const created = await api<AttachmentItem>(`/loads/${load.id}/attachments`, { method: 'POST', body: fd });
      setAttachments((prev) => (prev ? [created, ...prev] : [created]));
      setUploadFile(null);
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (a: AttachmentItem) => {
    setAttachError(null);
    try {
      await api(`/loads/${load.id}/attachments/${a.id}`, { method: 'DELETE' });
      setAttachments((prev) => prev?.filter((x) => x.id !== a.id) ?? null);
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  };

  if (!me) return null;
  const isSuper = me.role === 'SUPER_ACCOUNT_MANAGER';
  const isDispatcher = me.role === 'DISPATCHER';
  // Dispatchers may transition loads they booked or drive.
  const dispatcherAllowed = isDispatcher && (load.bookedBy?.id === me.id || load.driver?.id === me.id);
  const canStatus = isSuper || dispatcherAllowed;
  const canAttach = isSuper || me.role === 'ASSISTANT_ACCOUNT_MANAGER' || isDispatcher;

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
      title={`Load ${load.loadNumber}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      {ok ? <div className="alert alert-success">{ok}</div> : null}
      <div className="mb-16">
        <StatusBadge status={load.status} />
      </div>
      <div className="form-grid">
        <Field label="Customer">
          <div className="input-readonly">{load.customerName}</div>
        </Field>
        <Field label="Route">
          <div className="input-readonly">
            {load.originFacility} → {load.destinationFacility}
          </div>
        </Field>
        <Field label="Driver">
          <div className="input-readonly">{load.driver ? `${load.driver.firstName} ${load.driver.lastName}` : 'Unassigned'}</div>
        </Field>
        <Field label="Gross rate">
          <div className="input-readonly">{money(load.grossRateCents)}</div>
        </Field>
        <Field label="Booked by">
          <div className="input-readonly">{load.bookedBy ? `${load.bookedBy.firstName} ${load.bookedBy.lastName}` : '—'}</div>
        </Field>
        <Field label="Pickup">
          <div className="input-readonly">{dt(load.pickupAt)}</div>
        </Field>
        <Field label="Delivery">
          <div className="input-readonly">{dt(load.deliveryAt)}</div>
        </Field>
      </div>

      {canStatus && transitions.length > 0 ? (
        <div className="form-grid" style={{ marginTop: 16 }}>
          <Field label="Move to">
            <select value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
              <option value="">Choose a status…</option>
              {transitions.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason (optional)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button
              className="btn btn-primary"
              disabled={busy || !toStatus}
              onClick={() =>
                void act(async () => {
                  await api(`/loads/${load.id}/status`, { method: 'POST', body: { status: toStatus, reason: reason || undefined } });
                }, `Moved to ${toStatus.replace(/_/g, ' ')}.`)
              }
            >
              Update status
            </button>
          </div>
        </div>
      ) : null}

      <div className="form-grid" style={{ marginTop: 20 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px' }}>Documents</h3>
          {attachError ? <div className="alert alert-error">{attachError}</div> : null}
          <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
            <select value={uploadKind} onChange={(e) => setUploadKind(e.target.value as 'POD' | 'RATE_CONFIRMATION')} className="input" style={{ width: 180 }}>
              <option value="POD">Proof of delivery</option>
              <option value="RATE_CONFIRMATION">Rate confirmation</option>
            </select>
            <input
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              style={{ maxWidth: 260 }}
            />
            <button className="btn btn-primary" disabled={uploading || !uploadFile} onClick={() => void upload()}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
          {canAttach ? null : <p className="small muted">Only managers and dispatchers can upload documents.</p>}
          {attachments === null ? (
            <Spinner />
          ) : attachments.length === 0 ? (
            <p className="muted">No documents attached.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>File</th>
                  <th className="num">Size</th>
                  <th>Uploaded by</th>
                  <th>Uploaded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {attachments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Badge tone={a.kind === 'POD' ? 'blue' : 'green'}>{a.kind === 'POD' ? 'POD' : 'Rate conf.'}</Badge>
                    </td>
                    <td className="small">
                      <a href={`/api/v1/loads/${load.id}/attachments/${a.id}/download`}>{a.originalName}</a>
                    </td>
                    <td className="num muted">{fmtBytes(a.sizeBytes)}</td>
                    <td className="small muted">
                      {a.uploadedBy ? `${a.uploadedBy.firstName} ${a.uploadedBy.lastName}` : '—'}
                    </td>
                    <td className="small muted">{dt(a.createdAt)}</td>
                    <td className="num">
                      {isSuper || a.uploadedBy?.id === me.id ? (
                        <button className="btn btn-danger btn-sm" onClick={() => void removeAttachment(a)}>
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
