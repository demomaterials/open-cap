import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { get, post, setUnauthorizedHandler } from './api.js';
import { AuthContext, can } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Frameworks from './pages/Frameworks.jsx';
import FrameworkDetail from './pages/FrameworkDetail.jsx';
import FrameworkEdit from './pages/FrameworkEdit.jsx';
import Controls from './pages/Controls.jsx';
import ControlDetail from './pages/ControlDetail.jsx';
import ControlEdit from './pages/ControlEdit.jsx';
import Assets from './pages/Assets.jsx';
import AssetDetail from './pages/AssetDetail.jsx';
import AssetNew from './pages/AssetNew.jsx';
import Connectors from './pages/Connectors.jsx';
import ConnectorDetail from './pages/ConnectorDetail.jsx';
import ConnectorEdit from './pages/ConnectorEdit.jsx';
import Activity from './pages/Activity.jsx';
import Users from './pages/Users.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/frameworks', label: 'Frameworks' },
  { to: '/controls', label: 'Controls' },
  { to: '/assets', label: 'Assets' },
  { to: '/connectors', label: 'Connectors' },
  { to: '/activity', label: 'Activity' },
];

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    get('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="boot">open-cap</div>;
  if (!user) {
    return (
      <AuthContext.Provider value={{ user, setUser }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />} />
        </Routes>
      </AuthContext.Provider>
    );
  }

  const logout = async () => {
    await post('/api/auth/logout').catch(() => {});
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <div>
              <div className="brand-name">open-cap</div>
              <div className="brand-sub">Continuous compliance</div>
            </div>
          </div>
          <nav>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>{n.label}</NavLink>
            ))}
            {can(user, 'admin') && <NavLink to="/users" className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>Users</NavLink>}
          </nav>
          <div className="me">
            <div className="me-name">{user.display_name || user.username}</div>
            <div className="me-role">{user.role}</div>
            <button type="button" className="btn small ghost" onClick={logout}>Sign out</button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/frameworks" element={<Frameworks />} />
            <Route path="/frameworks/new" element={<FrameworkEdit />} />
            <Route path="/frameworks/:id" element={<FrameworkDetail />} />
            <Route path="/frameworks/:id/edit" element={<FrameworkEdit />} />
            <Route path="/controls" element={<Controls />} />
            <Route path="/controls/new" element={<ControlEdit />} />
            <Route path="/controls/:id" element={<ControlDetail />} />
            <Route path="/controls/:id/edit" element={<ControlEdit />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/assets/new" element={<AssetNew />} />
            <Route path="/assets/:id" element={<AssetDetail />} />
            <Route path="/connectors" element={<Connectors />} />
            <Route path="/connectors/new" element={<ConnectorEdit />} />
            <Route path="/connectors/:id" element={<ConnectorDetail />} />
            <Route path="/connectors/:id/edit" element={<ConnectorEdit />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/users" element={<Users />} />
            <Route path="*" element={<div className="page"><h1>Not found</h1></div>} />
          </Routes>
        </main>
      </div>
    </AuthContext.Provider>
  );
}
