import { useEffect, useState } from 'react';
import api from '../api';

export default function MyBookings() {
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    api.get('/bookings').then((res) => setBookings(res.data)).finally(() => setLoading(false));
  }

  async function cancel(id) {
    if (!confirm('Cancel this booking? If there is a waitlist, your seat will be offered to the next customer.')) return;
    setError('');
    try {
      await api.post(`/bookings/${id}/cancel`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cancel booking.');
    }
  }

  return (
    <div className="container">
      <h1 className="section-title">My Bookings</h1>
      {error && <div className="alert error">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : bookings.length === 0 ? (
        <p className="muted">No bookings yet.</p>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Event</th>
                <th>Seats</th>
                <th>Amount</th>
                <th>Status</th>
                <th>QR</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.bookingRef}</td>
                  <td>
                    {b.event.title}
                    <div className="muted" style={{ fontSize: 12 }}>{new Date(b.event.date).toLocaleString()}</div>
                  </td>
                  <td>{b.seats.map((s) => s.eventSeat.seat.label).join(', ')}</td>
                  <td>₹{b.totalAmount.toFixed(2)}</td>
                  <td><span className={`badge-status ${b.status}`}>{b.status}</span></td>
                  <td>
                    {b.qrCodeDataUrl ? <img src={b.qrCodeDataUrl} alt="QR" width={48} height={48} /> : <span className="muted">emailing…</span>}
                  </td>
                  <td>
                    {b.status === 'CONFIRMED' && (
                      <button className="btn-danger" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => cancel(b.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
