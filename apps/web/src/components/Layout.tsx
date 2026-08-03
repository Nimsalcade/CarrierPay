import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../lib/format';
import { hasAny } from '../lib/perms';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  perms: string[];
  end?: boolean;
}

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: '▦', perms: [], end: true }],
  },
  {
    title: 'Operations',
    items: [
      { to: '/loads', label: 'Loads', icon: '🚚', perms: ['loads.manage', 'loads.create', 'loads.view_all', 'loads.view_own_booked', 'loads.view_own'] },
      { to: '/equipment', label: 'Equipment', icon: '🛠', perms: ['equipment.manage', 'equipment.view_assigned'] },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/people', label: 'Staff & Drivers', icon: '👥', perms: ['users.manage', 'users.create_staff', 'users.create_drivers'] },
      { to: '/pay-rules', label: 'Pay Rules', icon: '📐', perms: ['pay-rules.manage', 'pay-rules.manage_drivers'] },
      { to: '/recurring', label: 'Recurring Items', icon: '🔁', perms: ['recurring.manage', 'recurring.manage_drivers'] },
    ],
  },
  {
    title: 'Payroll',
    items: [
      { to: '/payroll', label: 'Payroll', icon: '🧾', perms: ['payroll.run', 'payroll.view', 'payroll.view_own', 'payroll.view_own_estimate'] },
      { to: '/paystubs', label: 'Paystubs', icon: '📄', perms: ['paystubs.view_all', 'paystubs.view_own'] },
      { to: '/payments', label: 'Payments', icon: '💳', perms: ['payments.mark_paid'] },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/audit', label: 'Audit Trail', icon: '📋', perms: ['audit.view_all', 'audit.view_own'] },
      { to: '/notifications', label: 'Notifications', icon: '🔔', perms: [] },
      { to: '/settings', label: 'Company Settings', icon: '⚙️', perms: ['settings.manage', 'company.settings.manage'] },
    ],
  },
];

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;

  const perm = (item: NavItem) => (item.perms.length === 0 ? true : hasAny(me.permissions, item.perms));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">C</div>
          <span className="name">CarrierPay</span>
        </div>
        <nav className="sidebar-nav">
          {SECTIONS.map((section) => {
            const items = section.items.filter(perm);
            if (items.length === 0) return null;
            return (
              <div key={section.title}>
                <div className="nav-section">{section.title}</div>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  >
                    <span className="ico">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>CarrierPay</h1>
          <div className="spacer" />
          <div className="user">
            <span>
              {me.firstName} {me.lastName}
              <span className="muted"> · {me.role.replace(/_/g, ' ').toLowerCase()}</span>
            </span>
            <span className="avatar">{initials(me.firstName, me.lastName)}</span>
            <Link className="btn btn-ghost btn-sm" to="/change-password">
              Password
            </Link>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
