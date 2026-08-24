import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="container">
      <div className="navbar">
        <Link to="/events" className="brand">MAR<span>QUEE</span></Link>
        <div className="navlinks">
          <Link to="/events">Browse</Link>
          {user?.role === 'CUSTOMER' && <Link to="/bookings">My Bookings</Link>}
          {user?.role === 'ORGANISER' && <Link to="/organiser">Organiser</Link>}
          {user?.role === 'ADMIN' && <Link to="/admin">Admin</Link>}
          {user ? (
            <>
              <span className="pill">{user.name} · {user.role}</span>
              <button className="linklike" onClick={onLogout}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link to="/register">Register</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
