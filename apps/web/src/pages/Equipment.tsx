import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { has } from '../lib/perms';
import { Badge, EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { dt } from '../lib/format';

interface EquipmentDriver {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

interface EquipmentAssignment {
  id: string;
  driverUserId: string;
  assignedAt: string;
  returnedAt: string | null;
  driver: EquipmentDriver | null;
}

interface Equipment {
  id: string;
  type: string;
  unitNumber: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  plateState: string | null;
  odometerMiles: number | null;
  notes: string | null;
  status: string;
  assignments: EquipmentAssignment[];
}

interface EquipmentPage {
  items: Equipment[];
  total: number;
  page: number;
  pageSize: number;
}

interface DriverOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

const TYPE_LABEL: Record<string, string> = { TRUCK: 'Truck', TRAILER: 'Trailer', OTHER: 'Other' };

export function EquipmentPage() {
  const { me } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Equipment | null>(null);
  const { data, loading, error, reload } = useAsync<EquipmentPage>(() => api('/equipment'));

  if (!me) return null;
  const canManage = has(me.permissions, 'equipment.manage');
  const isDriver = me.role === 'DRIVER';

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Equipment</h1>
        {canManage ? (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Add unit
          </button>
        ) : null}
      </div>
      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No equipment yet" hint="Add trucks and trailers to assign to drivers." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Type</th>
                  <th>Make / Model</th>
                  <th>VIN / Plate</th>
                  <th>Status</th>
                  <th>Assigned to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((eq) => {
                  const active = eq.assignments.find((a) => !a.returnedAt);
                  return (
                    <tr key={eq.id}>
                      <td className="mono">{eq.unitNumber}</td>
                      <td>{TYPE_LABEL[eq.type] ?? eq.type}</td>
                      <td>
                        {[eq.year, eq.make, eq.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="small muted">
                        {eq.vin ? `VIN ${eq.vin}` : '—'}
                        {eq.plate ? ` · ${eq.plate}${eq.plateState ? ` (${eq.plateState})` : ''}` : ''}
                      </td>
                      <td>
                        <StatusBadge status={eq.status} />
                      </td>
                      <td>
                        {active?.driver ? (
                          <>
                            {active.driver.firstName} {active.driver.lastName}
                            <div className="small muted">{active.driver.employeeCode}</div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        <button className="btn btn-outline btn-sm" onClick={() => setSelected(eq)}>
                          {isDriver ? 'View' : 'Manage'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate ? (
        <EquipmentFormModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            reload();
          }}
        />
      ) : null}
      {selected ? (
        <EquipmentManageModal
          equipment={selected}
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

function EquipmentFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    type: 'TRUCK',
    unitNumber: '',
    vin: '',
    year: '',
    make: '',
    model: '',
    plate: '',
    plateState: '',
    odometerMiles: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/equipment', {
        method: 'POST',
        body: {
          type: form.type,
          unitNumber: form.unitNumber,
          vin: form.vin || undefined,
          year: form.year ? Number(form.year) : null,
          make: form.make || undefined,
          model: form.model || undefined,
          plate: form.plate || undefined,
          plateState: form.plateState || undefined,
          odometerMiles: form.odometerMiles ? Number(form.odometerMiles) : null,
          notes: form.notes || undefined,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add equipment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add equipment unit"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !form.unitNumber}>
            {busy ? 'Saving…' : 'Add unit'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Type">
          <select value={form.type} onChange={set('type')}>
            <option value="TRUCK">Truck</option>
            <option value="TRAILER">Trailer</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Unit number">
          <input value={form.unitNumber} onChange={set('unitNumber')} required placeholder="TRK-001" />
        </Field>
        <Field label="VIN">
          <input value={form.vin} onChange={set('vin')} />
        </Field>
        <Field label="Year">
          <input type="number" min={1950} max={2100} value={form.year} onChange={set('year')} />
        </Field>
        <Field label="Make">
          <input value={form.make} onChange={set('make')} />
        </Field>
        <Field label="Model">
          <input value={form.model} onChange={set('model')} />
        </Field>
        <Field label="Plate">
          <input value={form.plate} onChange={set('plate')} />
        </Field>
        <Field label="Plate state">
          <input maxLength={2} value={form.plateState} onChange={set('plateState')} />
        </Field>
        <Field label="Odometer (miles)">
          <input type="number" min={0} value={form.odometerMiles} onChange={set('odometerMiles')} />
        </Field>
        <Field label="Notes">
          <input value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  );
}

function EquipmentManageModal({ equipment, onClose, onDone }: { equipment: Equipment; onClose: () => void; onDone: () => void }) {
  const { me } = useAuth();
  const [tab, setTab] = useState<'edit' | 'assign' | 'return'>('edit');
  const [driverId, setDriverId] = useState('');
  const [notes, setNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [status, setStatus] = useState(equipment.status);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drivers = useAsync<DriverOption[]>(() => api('/drivers'));

  if (!me) return null;
  const canManage = has(me.permissions, 'equipment.manage');
  const active = equipment.assignments.find((a) => !a.returnedAt);

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
      title={`${equipment.unitNumber} — ${TYPE_LABEL[equipment.type] ?? equipment.type}`}
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
      <div className="small muted mb-16">
        <StatusBadge status={equipment.status} />
        {active?.driver ? (
          <>
            {' '}
            · Assigned to {active.driver.firstName} {active.driver.lastName} since {dt(active.assignedAt)}
          </>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex mb-16">
          <button className={`btn ${tab === 'edit' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setTab('edit')}>
            Edit
          </button>
          <button className={`btn ${tab === 'assign' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setTab('assign')}>
            Assign
          </button>
          <button className={`btn ${tab === 'return' ? 'btn-primary' : 'btn-outline'} btn-sm`} disabled={!active} onClick={() => setTab('return')}>
            Return
          </button>
        </div>
      ) : null}

      {canManage && tab === 'edit' ? (
        <div className="form-grid">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="AVAILABLE">Available</option>
              <option value="ASSIGNED">Assigned</option>
              <option value="OUT_OF_SERVICE">Out of service</option>
              <option value="RETIRED">Retired</option>
            </select>
          </Field>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button
              className="btn btn-primary"
              disabled={busy || status === equipment.status}
              onClick={() =>
                void act(async () => {
                  await api(`/equipment/${equipment.id}`, { method: 'PATCH', body: { status } });
                }, 'Equipment updated.')
              }
            >
              Save status
            </button>
          </div>
        </div>
      ) : null}

      {canManage && tab === 'assign' ? (
        <div className="form-grid">
          <Field label="Driver">
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Select a driver…</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.firstName} {d.lastName} ({d.employeeCode})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Override reason" hint="Required if the driver already has an active unit of this type.">
            <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          </Field>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button
              className="btn btn-primary"
              disabled={busy || !driverId}
              onClick={() =>
                void act(async () => {
                  await api(`/equipment/${equipment.id}/assign`, {
                    method: 'POST',
                    body: { driverUserId: driverId, notes, overrideReason: overrideReason || undefined },
                  });
                }, 'Assigned.')
              }
            >
              Assign unit
            </button>
          </div>
        </div>
      ) : null}

      {canManage && tab === 'return' ? (
        <div className="form-grid">
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
            <button
              className="btn btn-primary"
              disabled={busy || !active}
              onClick={() =>
                void act(async () => {
                  await api(`/equipment/${equipment.id}/return`, {
                    method: 'POST',
                    body: { notes: notes || undefined },
                  });
                }, 'Returned.')
              }
            >
              Return unit
            </button>
          </div>
        </div>
      ) : null}

      <div className="small muted" style={{ marginTop: 8 }}>
        {equipment.vin ? `VIN ${equipment.vin}` : 'No VIN'}
        {equipment.plate ? ` · ${equipment.plate}${equipment.plateState ? ` (${equipment.plateState})` : ''}` : ''}
        {equipment.odometerMiles != null ? ` · ${equipment.odometerMiles.toLocaleString()} mi` : ''}
        {equipment.notes ? <div>{equipment.notes}</div> : null}
      </div>
    </Modal>
  );
}
