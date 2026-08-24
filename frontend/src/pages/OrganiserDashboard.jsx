import { useEffect, useState } from 'react';
import api from '../api';

const emptyPricing = () => ({ category: '', price: '' });

export default function OrganiserDashboard() {
  const [venues, setVenues] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({ title: '', type: 'MOVIE', venueId: '', date: '', description: '' });
  const [pricing, setPricing] = useState([emptyPricing()]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const [summaryEventId, setSummaryEventId] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get('/venues').then((res) => setVenues(res.data));
    loadEvents();
  }, []);

  function loadEvents() {
    api.get('/events').then((res) => setEvents(res.data));
  }

  function update(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function updatePricing(i, k, v) {
    setPricing((p) => p.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  }
  function addPricingRow() {
    setPricing((p) => [...p, emptyPricing()]);
  }
  function removePricingRow(i) {
    setPricing((p) => p.filter((_, idx) => idx !== i));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await api.post('/events', {
        title: form.title,
        type: form.type,
        venueId: Number(form.venueId),
        date: form.date,
        description: form.description,
        pricing: pricing.map((p) => ({ category: p.category, price: Number(p.price) })),
      });
      setSuccess('Event created.');
      setForm({ title: '', type: 'MOVIE', venueId: '', date: '', description: '' });
      setPricing([emptyPricing()]);
      loadEvents();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create event.');
    } finally {
      setBusy(false);
    }
  }

  async function viewSummary(id) {
    setSummaryEventId(id);
    setSummary(null);
    const res = await api.get(`/events/${id}/summary`);
    setSummary(res.data);
  }

  return (
    <div className="container">
      <h1 className="section-title">Organiser — Events</h1>

      <div className="card" style={{ marginTop: 16 }}>
        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert success">{success}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Title</label>
            <input value={form.title} onChange={(e) => update('title', e.target.value)} required />
          </div>
          <div className="field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => update('type', e.target.value)}>
              <option value="MOVIE">Movie</option>
              <option value="CONCERT">Concert</option>
            </select>
          </div>
          <div className="field">
            <label>Venue</label>
            <select value={form.venueId} onChange={(e) => update('venueId', e.target.value)} required>
              <option value="">Select a venue…</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name} ({v._count?.seats} seats)</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Date &amp; time</label>
            <input type="datetime-local" value={form.date} onChange={(e) => update('date', e.target.value)} required />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <textarea rows={2} value={form.description} onChange={(e) => update('description', e.target.value)} />
          </div>

          <label>Pricing per category</label>
          {pricing.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input placeholder="Category (e.g. Premium)" value={p.category} onChange={(e) => updatePricing(i, 'category', e.target.value)} required />
              <input type="number" placeholder="Price" value={p.price} onChange={(e) => updatePricing(i, 'price', e.target.value)} required />
              <button type="button" className="btn-secondary" onClick={() => removePricingRow(i)} disabled={pricing.length === 1}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={addPricingRow} style={{ marginBottom: 16 }}>+ Add category price</button>

          <button className="btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create Event'}</button>
        </form>
      </div>

      <h2 className="section-title" style={{ fontSize: 20 }}>Your Events</h2>
      <div className="event-grid">
        {events.map((ev) => (
          <div className="card" key={ev.id}>
            <span className="type-badge">{ev.type}</span>
            <h3 style={{ margin: '8px 0' }}>{ev.title}</h3>
            <p className="muted">{ev.venue?.name} · {new Date(ev.date).toLocaleString()}</p>
            <button className="btn-secondary" onClick={() => viewSummary(ev.id)}>View booking summary</button>
          </div>
        ))}
      </div>

      {summaryEventId && summary && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>{summary.event.title} — Summary</h3>
          <div className="stat-row">
            <div className="stat"><div className="num">₹{summary.totalRevenue.toFixed(0)}</div><div className="label">Revenue</div></div>
            <div className="stat"><div className="num">{summary.seatsSold}/{summary.totalSeats}</div><div className="label">Seats sold</div></div>
            <div className="stat"><div className="num">{summary.bookingsCount}</div><div className="label">Bookings</div></div>
          </div>
          <table className="table">
            <thead><tr><th>Reference</th><th>Customer</th><th>Seats</th><th>Amount</th><th>When</th></tr></thead>
            <tbody>
              {summary.bookings.map((b) => (
                <tr key={b.bookingRef}>
                  <td>{b.bookingRef}</td>
                  <td>{b.customer}<div className="muted" style={{ fontSize: 12 }}>{b.email}</div></td>
                  <td>{b.seats}</td>
                  <td>₹{b.amount.toFixed(2)}</td>
                  <td>{new Date(b.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
