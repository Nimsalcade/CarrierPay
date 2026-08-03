import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { dateOnly, dt, money } from '../lib/format';

interface Payment {
  id: string;
  paidDate: string;
  method: string | null;
  externalReference: string | null;
  note: string | null;
  paystub: {
    id: string;
    settlementNumber: string;
    payrollEntry: { user: { id: string; firstName: string; lastName: string; employeeCode: string } };
  };
  actor: { id: string; firstName: string; lastName: string } | null;
}

interface PaymentPage {
  items: Payment[];
  total: number;
  page: number;
  pageSize: number;
}

export function PaymentsPage() {
  const { me } = useAuth();
  const { data, loading, error } = useAsync<PaymentPage>(() => api('/payments'));

  if (!me) return null;

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Payments</h1>
      </div>
      <div className="card">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No payments recorded" hint="Mark paystubs as paid from the Paystubs page." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Paid date</th>
                  <th>Employee</th>
                  <th>Settlement #</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((p) => (
                  <tr key={p.id}>
                    <td>{dateOnly(p.paidDate)}</td>
                    <td>
                      {p.paystub.payrollEntry.user.firstName} {p.paystub.payrollEntry.user.lastName}
                      <div className="small muted">{p.paystub.payrollEntry.user.employeeCode}</div>
                    </td>
                    <td className="mono">{p.paystub.settlementNumber}</td>
                    <td>{p.method ?? '—'}</td>
                    <td className="small muted">{p.externalReference ?? '—'}</td>
                    <td className="small muted">{p.actor ? `${p.actor.firstName} ${p.actor.lastName}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data ? <div className="small muted mt-8">{data.total} payment(s)</div> : null}
    </div>
  );
}
