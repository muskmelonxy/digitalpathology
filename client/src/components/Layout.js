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

const THEME_KEY = 'sidebar-theme';

function readTheme() {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch (err) {
    return 'dark';
  }
}

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
  const [theme, setTheme] = React.useState(readTheme);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (err) {
      // Private mode can reject storage; the choice still applies this session.
    }
  }, [theme]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: '总览', hint: 'Dashboard', icon: LayoutDashboard },
    { path: '/library', label: '数字切片库', hint: 'Library', icon: Microscope },
    { path: '/slides', label: '课程切片', hint: 'Course slides', icon: Image },
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

  const ThemeToggle = () => (
    <div className="theme-toggle" role="group" aria-label="侧栏主题">
      <button
        type="button"
        data-active={theme === 'dark'}
        onClick={() => setTheme('dark')}
      >
        深色
      </button>
      <button
        type="button"
        data-active={theme === 'light'}
        onClick={() => setTheme('light')}
      >
        浅色
      </button>
    </div>
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
    <div className={`h-screen overflow-hidden flex bg-paper text-ink app-shell theme-${theme}`}>
      <aside className={`sidebar theme-${theme} hidden md:flex flex-col w-[248px] shrink-0`}>
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center">
              <Microscope className="w-5 h-5" />
            </div>
            <div>
              <p className="font-serif text-lg leading-none">Digital Slides</p>
              <p className="sidebar-muted text-[11px] tracking-[0.14em] mt-1">数字玻片</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          <NavLinks />
        </nav>

        <div className="sidebar-foot p-3">
          <ThemeToggle />
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="user-badge w-8 h-8 rounded-full flex items-center justify-center font-semibold">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="sidebar-muted text-xs">{ROLE_LABELS[user?.role] || user?.role}</p>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="nav-link logout-link w-full text-left">
            <LogOut className="w-5 h-5" />
            <span>
              <strong>退出</strong>
              <em>Log out</em>
            </span>
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className={`sidebar sidebar-bar theme-${theme} md:hidden flex items-center justify-between px-4 h-14`}>
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
          <nav className={`sidebar theme-${theme} md:hidden px-3 pb-3 space-y-1`}>
            <NavLinks onNavigate={() => setMobileMenuOpen(false)} />
            <ThemeToggle />
            <button type="button" onClick={handleLogout} className="nav-link logout-link w-full text-left">
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
