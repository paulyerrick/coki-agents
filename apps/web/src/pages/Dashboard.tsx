import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from '../lib/auth';

const NAV = [
  { label: 'Overview',        to: '/dashboard' },
  { label: 'Assistant',       to: '/dashboard/assistant' },
  { label: 'Integrations',    to: '/dashboard/integrations' },
  { label: 'Scheduled Jobs',  to: '/scheduled-jobs' },
  { label: 'Settings',        to: '/settings' },
];

export default function Dashboard() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col py-6 px-4 gap-2">
        <div className="text-lg font-bold text-brand-700 mb-6">COKI Agents</div>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map((item) => {
            const active =
              item.to === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-400 hover:text-gray-600 text-left px-3 py-2"
        >
          Sign out
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Outlet renders the matched child route */}
        <Outlet />
      </main>
    </div>
  );
}
