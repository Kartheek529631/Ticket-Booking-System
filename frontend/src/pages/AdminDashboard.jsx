import { useEffect, useState } from 'react';
import api from '../api';

const emptyRow = () => ({ row: '', from: 1, to: 8, category: 'Standard' });

export default function AdminDashboard() {
  const [venues, setVenues] = useState([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [rows, setRows] = useState([emptyRow()]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, []);

  function load() {
    api.get('/venues').then((res) => setVenues(res.data));
  }

  function updateRow(i, key, value) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  }

  function addRow() {
    setRows((r) => [...r, emptyRow()]);
  }
  function removeRow(i) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const seatLayout = rows.map((r) => ({
        row: r.row.toUpperCase(),
        numbers: Array.from({ length: Number(r.to) - Number(r.from) + 1 }, (_, i) => Number(r.from) + i),
        category: r.category,
      }));
      await api.post('/venues', { name, address, seatLayout });
      setSuccess('Venue created.');
      setName('');
      setAddress('');
      setRows([emptyRow()]);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create venue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1 className="section-title">Admin — Venues</h1>
      <p className="muted">Define a venue's fixed seat layout once; organisers reuse it for every show.</p>

      <div className="card" style={{ marginTop: 16 }}>
        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert success">{success}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Venue name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} required />
          </div>

          <label>Seat rows</label>
          {rows.map((r, i) => (
            <div className="row-def" key={i}>
              <div>
                <label>Row letter</label>
                <input value={r.row} onChange={(e) => updateRow(i, 'row', e.target.value)} placeholder="A" required />
              </div>
              <div>
                <label>Seat numbers</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min={1} value={r.from} onChange={(e) => updateRow(i, 'from', e.target.value)} />
                  <span className="muted">to</span>
                  <input type="number" min={1} value={r.to} onChange={(e) => updateRow(i, 'to', e.target.value)} />
                </div>
              </div>
              <div>
                <label>Category</label>
                <input value={r.category} onChange={(e) => updateRow(i, 'category', e.target.value)} placeholder="Premium / Standard" required />
              </div>
              <button type="button" className="btn-secondary" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={addRow} style={{ marginBottom: 16 }}>
            + Add row
          </button>

          <button className="btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create Venue'}</button>
        </form>
      </div>

      <h2 className="section-title" style={{ fontSize: 20 }}>Your Venues</h2>
      <div className="event-grid">
        {venues.map((v) => (
          <div className="card" key={v.id}>
            <h3 style={{ marginTop: 0 }}>{v.name}</h3>
            <p className="muted">{v.address}</p>
            <p className="muted">{v._count?.seats} seats · {v._count?.events} events scheduled</p>
          </div>
        ))}
      </div>
    </div>
  );
}
