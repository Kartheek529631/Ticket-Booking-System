const prisma = require('../config/prisma');
const seatService = require('../services/seat.service');
const waitlistService = require('../services/waitlist.service');

async function holdSeats(req, res) {
  const eventId = Number(req.params.id);
  const { seatIds } = req.body;
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    return res.status(400).json({ error: 'seatIds[] is required' });
  }

  try {
    const { held, expiresAt } = await seatService.holdSeats(eventId, seatIds, req.user.id);
    res.json({ held: held.map(seatService.serializeSeat), expiresAt });
  } catch (err) {
    if (err instanceof seatService.HoldConflictError) {
      return res.status(409).json({ error: err.message, conflictingSeatIds: err.seatIds });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to hold seats' });
  }
}

async function releaseSeats(req, res) {
  const eventId = Number(req.params.id);
  const { seatIds } = req.body;
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    return res.status(400).json({ error: 'seatIds[] is required' });
  }
  const count = await seatService.releaseSeats(eventId, seatIds, req.user.id);
  res.json({ released: count });
}

async function createBooking(req, res) {
  const { eventId, seatIds } = req.body;
  if (!eventId || !Array.isArray(seatIds) || seatIds.length === 0) {
    return res.status(400).json({ error: 'eventId and seatIds[] are required' });
  }
  try {
    const booking = await seatService.confirmBooking({ eventId: Number(eventId), seatIds, userId: req.user.id });
    res.status(201).json(booking);
  } catch (err) {
    if (err instanceof seatService.BookingError) {
      return res.status(409).json({ error: err.message, seatIds: err.seatIds });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm booking' });
  }
}

// Confirms a booking for a seat that was OFFERED via the waitlist flow.
async function acceptWaitlistOffer(req, res) {
  const waitlistId = Number(req.params.id);
  try {
    const entry = await waitlistService.acceptOffer(waitlistId, req.user.id);
    const booking = await seatService.confirmBooking({
      eventId: entry.eventId,
      seatIds: [entry.offeredEventSeatId],
      userId: req.user.id,
    });
    await waitlistService.markConverted(waitlistId);
    res.status(201).json(booking);
  } catch (err) {
    console.error(err);
    res.status(409).json({ error: err.message });
  }
}

async function myBookings(req, res) {
  const bookings = await prisma.booking.findMany({
    where: { userId: req.user.id },
    include: {
      event: { include: { venue: true } },
      seats: { include: { eventSeat: { include: { seat: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(bookings);
}

async function cancelBooking(req, res) {
  const bookingId = Number(req.params.id);
  try {
    const booking = await seatService.cancelBooking(bookingId, req.user.id);
    res.json(booking);
  } catch (err) {
    if (err instanceof seatService.BookingError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
}

module.exports = { holdSeats, releaseSeats, createBooking, acceptWaitlistOffer, myBookings, cancelBooking };
