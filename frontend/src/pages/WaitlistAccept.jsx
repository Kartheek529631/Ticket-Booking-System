import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function WaitlistAccept() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  async function accept() {
    if (!user) return navigate('/login');
    setStatus('busy');
    setError('');
    try {
      const res = await api.post(`/bookings/waitlist-offer/${id}/accept`);
      setStatus('done');
      navigate('/bookings', { state: { justBooked: res.data.bookingRef } });
    } catch (err) {
      setStatus('error');
      setError(err.response?.data?.error || 'This offer is no longer available.');
    }
  }

  return (
    <div className="center-page">
      <div className="card auth-card">
        <h2>Waitlist Offer</h2>
        <p className="muted">
          A seat has opened up for you. Confirming will book it at the event's listed price for that category. If your offer
          window has passed, the seat has already moved on to the next person in line.
        </p>
        {error && <div className="alert error">{error}</div>}
        <button className="btn-primary btn-block" onClick={accept} disabled={status === 'busy'}>
          {status === 'busy' ? 'Booking…' : 'Complete My Booking'}
        </button>
      </div>
    </div>
  );
}
