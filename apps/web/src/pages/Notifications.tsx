import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { Spinner, ErrorBox, EmptyState } from '../components/ui';
import { dt } from '../lib/format';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotifPage {
  items: Notif[];
  total: number;
}

export function NotificationsPage() {
  const { me } = useAuth();
  const { data, loading, error, reload } = useAsync<NotifPage>(() => api('/notifications'));

  const markRead = async (id: string) => {
    await api(`/notifications/${id}/read`, { method: 'POST' });
    reload();
  };
  const markAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    reload();
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div>
      <div className="flex-between mb-16">
        <h1>Notifications</h1>
        <button className="btn btn-outline btn-sm" onClick={() => void markAll()}>
          Mark all read
        </button>
      </div>
      <div className="card">
        {data && data.items.length === 0 ? <EmptyState title="No notifications" hint="New activity will appear here." /> : null}
        {data?.items.map((n) => (
          <div
            key={n.id}
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              background: n.readAt ? undefined : 'var(--primary-50)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{n.title}</div>
              {n.body ? <div className="small muted">{n.body}</div> : null}
              <div className="small muted">{dt(n.createdAt)}</div>
            </div>
            {!n.readAt ? (
              <button className="btn btn-outline btn-sm" onClick={() => void markRead(n.id)}>
                Mark read
              </button>
            ) : (
              <span className="badge badge-gray">read</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
