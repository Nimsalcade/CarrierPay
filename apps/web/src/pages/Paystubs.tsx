import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { EmptyState, ErrorBox, Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { dateOnly, dt, money } from '../lib/format';

interface Paystub {
  id: string;
  settlementNumber: string;
  version: number;
  generatedAt: string;
  publishedAt: string;
  pdfPath: string | null;
  checksum: string | null;
  netPayCents: number | null;
  payrollEntry: {
    id: string;
    netPayCents: number;
    user: { id: string; firstName: string; lastName: string; employeeCode: string; role: string };
    payPeriod: { startAt: string; endAt: string; status: string };
  };
  payments: Array<{ id: string; paidDate: string; method: string | null; externalReference: string | null }>;
}

interface PaystubPage {
  items: Paystub[];
  total: number;
  page: number;
  pageSize: number;
}

export function PaystubsPage() {
  const { me } = useAuth();
  const { data, loading, error, reload } = useAsync<PaystubPage>(() => api('/paystubs'));
  const [marking, setMarking] = useState<Paystub | null>(null);

  if (!me) return null;
  const isSuper = me.role === 'SUPER_ACCOUNT_MANAGER';

  const download = (id: string) => {
    window.open(`/api/v1/paystubs/${id}/download`, '_blank', 'noopener');
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Paystubs</h1>
      </div>
      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No paystubs yet" hint="Published payroll periods generate paystubs here." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Settlement #</th>
                  <th>Employee</th>
                  <th>Period</th>
                  <th className="num">Net pay</th>
                  <th>Published</th>
                  <th>Payment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((s) => {
                  const paid = s.payments[0];
                  return (
                    <tr key={s.id}>
                      <td className="mono">
                        {s.settlementNumber}
                        {s.version > 1 ? <span className="badge badge-indigo">R{s.version}</span> : null}
                      </td>
                      <td>
                        {s.payrollEntry.user.firstName} {s.payrollEntry.user.lastName}
                        <div className="small muted">{s.payrollEntry.user.employeeCode}</div>
                      </td>
                      <td className="small muted">
                        {dateOnly(s.payrollEntry.payPeriod.startAt)} → {dateOnly(s.payrollEntry.payPeriod.endAt)}
                      </td>
                      <td className="num">{money(s.payrollEntry.netPayCents)}</td>
                      <td className="small">{dt(s.publishedAt)}</td>
                      <td>
                        {paid ? (
                          <span className="small">
                            <span className="badge badge-green">Paid</span>{' '}
                            {dateOnly(paid.paidDate)}
                            {paid.method ? ` · ${paid.method}` : ''}
                          </span>
                        ) : (
                          <span className="badge badge-gray">Unpaid</span>
                        )}
                      </td>
                      <td className="num">
                        <div className="flex" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => download(s.id)}>
                            PDF
                          </button>
                          {isSuper && !paid ? (
                            <button className="btn btn-outline btn-sm" onClick={() => setMarking(s)}>
                              Mark paid
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {marking ? (
        <MarkPaidModal
          stub={marking}
          onClose={() => setMarking(null)}
          onDone={() => {
            setMarking(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function MarkPaidModal({ stub, onClose, onDone }: { stub: Paystub; onClose: () => void; onDone: () => void }) {
  const [paidDate, setPaidDate] = useState('');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/paystubs/${stub.id}/mark-paid`, {
        method: 'POST',
        body: {
          paidDate: paidDate || undefined,
          method: method || undefined,
          reference: reference || undefined,
          note: note || undefined,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Mark ${stub.settlementNumber} as paid`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Paid date">
          <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
        <Field label="Method">
          <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="ACH / Check / Cash" />
        </Field>
        <Field label="Reference">
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
