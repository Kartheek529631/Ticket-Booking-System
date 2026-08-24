// Renders seats grouped by row. `seats` is the flat array returned by
// GET /api/events/:id/seats (each item: { eventSeatId, row, number, label,
// category, status, holdExpiresAt }). `selected` is a Set of eventSeatId
// currently chosen by this user (client-side, before the hold call).
export default function SeatMap({ seats, selected, onToggle, currentUserId }) {
  const rows = {};
  for (const s of seats) {
    rows[s.row] = rows[s.row] || [];
    rows[s.row].push(s);
  }
  const rowKeys = Object.keys(rows).sort();

  function classFor(seat) {
    if (selected.has(seat.eventSeatId)) return 'selected';
    if (seat.status === 'BOOKED') return 'booked';
    if (seat.status === 'OFFERED') return 'offered';
    if (seat.status === 'HELD') return 'held';
    return 'available';
  }

  function isClickable(seat) {
    if (seat.status === 'BOOKED' || seat.status === 'OFFERED') return false;
    if (seat.status === 'HELD') return false; // held by someone (possibly me, but simplest UX: locked once held)
    return true;
  }

  return (
    <div>
      <div className="screen-label">Screen this way</div>
      <div className="screen-arc" />
      <div className="seat-map">
        {rowKeys.map((row) => (
          <div className="seat-row" key={row}>
            <span className="row-label">{row}</span>
            {rows[row]
              .sort((a, b) => a.number - b.number)
              .map((seat) => (
                <button
                  key={seat.eventSeatId}
                  type="button"
                  className={`seat ${classFor(seat)}`}
                  disabled={!isClickable(seat)}
                  title={`${seat.label} · ${seat.category} · ${seat.status}`}
                  onClick={() => onToggle(seat)}
                >
                  {seat.number}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="legend">
        <span><span className="swatch" style={{ background: 'var(--panel-2)', border: '1px solid var(--gold-dim)' }} />Available</span>
        <span><span className="swatch" style={{ background: 'var(--gold)' }} />Selected</span>
        <span><span className="swatch" style={{ background: 'var(--amber)' }} />Held by another customer</span>
        <span><span className="swatch" style={{ background: 'var(--teal)' }} />Offered (waitlist)</span>
        <span><span className="swatch" style={{ background: 'var(--maroon)' }} />Booked</span>
      </div>
    </div>
  );
}
