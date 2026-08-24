import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function Events() {
  const [events, setEvents] = useState([]);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  function load() {
    setLoading(true);
    api
      .get('/events', { params: { type: type || undefined, search: search || undefined } })
      .then((res) => setEvents(res.data))
      .finally(() => setLoading(false));
  }

  return (
    <div className="container">
      <h1 className="section-title">Now Booking</h1>
      <p className="muted">Movies and concerts with live seat availability.</p>

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input placeholder="Search by title…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="MOVIE">Movies</option>
          <option value="CONCERT">Concerts</option>
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      {loading ? (
        <p className="muted" style={{ marginTop: 24 }}>Loading events…</p>
      ) : events.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }}>No events found.</p>
      ) : (
        <div className="event-grid">
          {events.map((ev) => (
            <Link key={ev.id} to={`/events/${ev.id}`} className="card event-card">
              <span className="type-badge">{ev.type}</span>
              <h3>{ev.title}</h3>
              <div className="meta">{ev.venue?.name}</div>
              <div className="meta">{new Date(ev.date).toLocaleString()}</div>
              <div className="meta">
                {ev._count?.eventSeats > 0 ? (
                  <span style={{ color: 'var(--teal)' }}>{ev._count.eventSeats} seats available</span>
                ) : (
                  <span style={{ color: 'var(--maroon-bright)' }}>Sold out</span>
                )}
              </div>
              <div className="meta">
                From ₹{Math.min(...ev.pricing.map((p) => p.price)).toFixed(0)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
