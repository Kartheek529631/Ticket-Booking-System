import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import socket from '../socket';
import { useAuth } from '../context/AuthContext';
import SeatMap from '../components/SeatMap';

export default function EventDetail() {
  const { id } = useParams();
  const eventId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [seats, setSeats] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [holdExpiresAt, setHoldExpiresAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    api.get(`/events/${eventId}`).then((res) => setEvent(res.data));
    refreshSeats();

    socket.emit('event:join', eventId);
    const onUpdate = ({ eventId: evId, seats: updated }) => {
      if (evId !== eventId) return;
      setSeats((prev) => {
        const map = new Map(prev.map((s) => [s.eventSeatId, s]));
        for (const u of updated) map.set(u.eventSeatId, u);
        return Array.from(map.values());
      });
      // If one of our selected seats got taken/expired from under us, drop it.
      setSelected((prevSel) => {
        const next = new Set(prevSel);
        for (const u of updated) {
          if (u.status !== 'AVAILABLE' && next.has(u.eventSeatId)) next.delete(u.eventSeatId);
        }
        return next;
      });
    };
    socket.on('seat:update', onUpdate);

    return () => {
      socket.emit('event:leave', eventId);
      socket.off('seat:update', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-release UI state once the hold TTL passes (server also enforces this independently).
  useEffect(() => {
    if (holdExpiresAt && now > new Date(holdExpiresAt).getTime()) {
      setHoldExpiresAt(null);
      setSelected(new Set());
      setError('Your seat hold expired. Please select seats again.');
      refreshSeats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, holdExpiresAt]);

  function refreshSeats() {
    api.get(`/events/${eventId}/seats`).then((res) => setSeats(res.data));
  }

  const categoryAvailability = useMemo(() => {
    const byCategory = {};
    for (const s of seats) {
      byCategory[s.category] = byCategory[s.category] || { available: 0, total: 0 };
      byCategory[s.category].total += 1;
      if (s.status === 'AVAILABLE') byCategory[s.category].available += 1;
    }
    return byCategory;
  }, [seats]);

  const priceByCategory = useMemo(() => {
    const map = {};
    (event?.pricing || []).forEach((p) => (map[p.category] = p.price));
    return map;
  }, [event]);

  const total = useMemo(() => {
    let sum = 0;
    for (const s of seats) {
      if (selected.has(s.eventSeatId)) sum += priceByCategory[s.category] || 0;
    }
    return sum;
  }, [selected, seats, priceByCategory]);

  function toggleSeat(seat) {
    if (!user) return navigate('/login');
    if (holdExpiresAt) return; // seats are already held — must confirm or cancel first
    setError('');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seat.eventSeatId)) next.delete(seat.eventSeatId);
      else next.add(seat.eventSeatId);
      return next;
    });
  }

  async function holdSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/events/${eventId}/hold`, { seatIds: Array.from(selected) });
      setHoldExpiresAt(res.data.expiresAt);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not hold seats — someone may have just taken them.');
      refreshSeats();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function cancelCheckout() {
    setBusy(true);
    try {
      await api.delete(`/events/${eventId}/hold`, { data: { seatIds: Array.from(selected) } });
    } finally {
      setHoldExpiresAt(null);
      setSelected(new Set());
      setBusy(false);
      refreshSeats();
    }
  }

  async function confirmBooking() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/bookings', { eventId, seatIds: Array.from(selected) });
      setSuccess(`Booking confirmed! Reference ${res.data.bookingRef}. A confirmation email with your QR ticket is on its way.`);
      setHoldExpiresAt(null);
      setSelected(new Set());
      refreshSeats();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not confirm booking.');
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist(category) {
    if (!user) return navigate('/login');
    try {
      await api.post(`/events/${eventId}/waitlist`, { category });
      setSuccess(`You're on the waitlist for ${category}. We'll email you the moment a seat frees up.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not join waitlist.');
    }
  }

  if (!event) return <div className="container"><p className="muted">Loading…</p></div>;

  const secondsLeft = holdExpiresAt ? Math.max(0, Math.floor((new Date(holdExpiresAt).getTime() - now) / 1000)) : 0;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="container">
      <span className="type-badge">{event.type}</span>
      <h1 className="section-title" style={{ marginTop: 8 }}>{event.title}</h1>
      <p className="muted">{event.venue?.name} · {new Date(event.date).toLocaleString()}</p>
      {event.description && <p className="muted">{event.description}</p>}

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <div className="card" style={{ marginTop: 20 }}>
        <SeatMap seats={seats} selected={selected} onToggle={toggleSeat} currentUserId={user?.id} />
      </div>

      <div className="stat-row">
        {Object.entries(categoryAvailability).map(([cat, info]) => (
          <div className="stat" key={cat}>
            <div className="num">{info.available}/{info.total}</div>
            <div className="label">{cat} · ₹{priceByCategory[cat]}</div>
            {info.available === 0 && (
              <button className="btn-secondary" style={{ marginTop: 8, fontSize: 12, padding: '6px 10px' }} onClick={() => joinWaitlist(cat)}>
                Join waitlist
              </button>
            )}
          </div>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="checkout-bar">
          <div>
            <strong>{selected.size} seat{selected.size > 1 ? 's' : ''} selected</strong>
            <div className="muted">Total: ₹{total.toFixed(2)}</div>
          </div>

          {holdExpiresAt ? (
            <>
              <div className="timer">{mm}:{ss} to confirm</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-secondary" onClick={cancelCheckout} disabled={busy}>Cancel</button>
                <button className="btn-primary" onClick={confirmBooking} disabled={busy}>Confirm Booking</button>
              </div>
            </>
          ) : (
            <button className="btn-primary" onClick={holdSelected} disabled={busy}>
              {busy ? 'Holding…' : 'Hold Seats & Checkout'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
