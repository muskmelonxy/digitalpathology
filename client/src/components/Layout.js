import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Image,
  BookOpen,
  Upload,
  Users,
  LogOut,
  Menu,
  X,
  Microscope,
} from 'lucide-react';

const ROLE_LABELS = {
  teacher: '教师',
  student: '学生',
  admin: '管理员',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: '总览', hint: 'Dashboard', icon: LayoutDashboard },
    { path: '/library', label: '直读库', hint: 'Library', icon: Microscope },
    { path: '/slides', label: '课程玻片', hint: 'Slides', icon: Image },
    { path: '/courses', label: '课程', hint: 'Courses', icon: BookOpen },
  ];

  const teacherNavItems = [
    { path: '/upload', label: '上传', hint: 'Upload', icon: Upload },
    { path: '/students', label: '学生', hint: 'Students', icon: Users },
  ];

  const allNavItems = user?.role !== 'student'
    ? [...navItems, ...teacherNavItems]
    : navItems;

  const immersive = /^\/library\/.+/.test(location.pathname) || /^\/slides\/[^/]+$/.test(location.pathname);

  const isActive = (path) => (
    path === '/'
      ? location.pathname === '/'
      : location.pathname === path || location.pathname.startsWith(`${path}/`)
  );

  const NavLinks = ({ onNavigate }) => (
    <>
      {allNavItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={`nav-link ${active ? 'is-active' : ''}`}
          >
            <Icon className="w-5 h-5" />
            <span>
              <strong>{item.label}</strong>
              <em>{item.hint}</em>
            </span>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="h-screen overflow-hidden flex bg-paper text-ink">
      <aside className="hidden md:flex flex-col w-[248px] shrink-0 bg-[#12211f] text-[#e7efe9]">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1f6f68] flex items-center justify-center">
              <Microscope className="w-5 h-5" />
            </div>
            <div>
              <p className="font-serif text-lg leading-none">Digital Slides</p>
              <p className="text-[11px] tracking-[0.14em] text-[#9fb5ad] mt-1">数字玻片</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          <NavLinks />
        </nav>

        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-[#e7a15a] text-[#2a1608] flex items-center justify-center font-semibold">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="text-xs text-[#9fb5ad]">{ROLE_LABELS[user?.role] || user?.role}</p>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="nav-link w-full text-left text-[#f0c1b0]">
            <LogOut className="w-5 h-5" />
            <span>
              <strong>退出</strong>
              <em>Log out</em>
            </span>
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-stone-200 bg-[#12211f] text-[#e7efe9]">
          <p className="font-serif">数字玻片</p>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="p-2"
            aria-label="菜单"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
        {mobileMenuOpen && (
          <nav className="md:hidden bg-[#12211f] text-[#e7efe9] px-3 pb-3 space-y-1">
            <NavLinks onNavigate={() => setMobileMenuOpen(false)} />
            <button type="button" onClick={handleLogout} className="nav-link w-full text-left">
              <LogOut className="w-5 h-5" />
              <span>
                <strong>退出</strong>
                <em>Log out</em>
              </span>
            </button>
          </nav>
        )}

        <main className={`flex-1 min-h-0 ${immersive ? 'overflow-hidden' : 'overflow-auto'}`}>
          <div className={immersive ? 'h-full' : 'p-5 md:p-8'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
