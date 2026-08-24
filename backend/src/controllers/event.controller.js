const prisma = require('../config/prisma');
const { serializeSeat } = require('../services/seat.service');

// Organiser creates a movie/concert listing tied to a venue, date/time and
// per-category pricing. One EventSeat row is generated for every physical
// seat in the venue so each show has its own independent live seat map.
async function createEvent(req, res) {
  const { title, type, venueId, date, description, pricing } = req.body;
  if (!title || !type || !venueId || !date || !Array.isArray(pricing) || pricing.length === 0) {
    return res.status(400).json({ error: 'title, type, venueId, date, pricing[] are required' });
  }

  const venue = await prisma.venue.findUnique({ where: { id: Number(venueId) }, include: { seats: true } });
  if (!venue) return res.status(404).json({ error: 'Venue not found' });

  const event = await prisma.event.create({
    data: {
      title,
      type,
      description,
      date: new Date(date),
      organiserId: req.user.id,
      venueId: venue.id,
      pricing: { create: pricing.map((p) => ({ category: p.category, price: Number(p.price) })) },
      eventSeats: { create: venue.seats.map((seat) => ({ seatId: seat.id, status: 'AVAILABLE' })) },
    },
    include: { pricing: true, venue: true },
  });

  res.status(201).json(event);
}

// Public listing with optional filters: type, from/to date, search text.
async function listEvents(req, res) {
  const { type, search, from, to, organiserId } = req.query;
  const where = {};
  if (type) where.type = type;
  if (organiserId) where.organiserId = Number(organiserId);
  if (search) where.title = { contains: search };
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  const events = await prisma.event.findMany({
    where,
    include: {
      venue: true,
      pricing: true,
      _count: { select: { eventSeats: { where: { status: 'AVAILABLE' } } } },
    },
    orderBy: { date: 'asc' },
  });
  res.json(events);
}

async function getEvent(req, res) {
  const event = await prisma.event.findUnique({
    where: { id: Number(req.params.id) },
    include: { venue: true, pricing: true, organiser: { select: { id: true, name: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
}

// Full live seat map for an event — the frontend renders this as a grid.
async function getEventSeats(req, res) {
  const eventId = Number(req.params.id);
  const seats = await prisma.eventSeat.findMany({
    where: { eventId },
    include: { seat: true },
    orderBy: [{ seat: { row: 'asc' } }, { seat: { number: 'asc' } }],
  });
  res.json(seats.map(serializeSeat));
}

// Organiser dashboard: bookings + revenue for one of their own events.
async function getEventSummary(req, res) {
  const eventId = Number(req.params.id);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.organiserId !== req.user.id) return res.status(403).json({ error: 'Not your event' });

  const bookings = await prisma.booking.findMany({
    where: { eventId, status: 'CONFIRMED' },
    include: { seats: true, user: { select: { name: true, email: true } } },
  });

  const totalRevenue = bookings.reduce((sum, b) => sum + b.totalAmount, 0);
  const seatsSold = bookings.reduce((sum, b) => sum + b.seats.length, 0);
  const totalSeats = await prisma.eventSeat.count({ where: { eventId } });

  res.json({
    event,
    totalRevenue,
    seatsSold,
    totalSeats,
    bookingsCount: bookings.length,
    bookings: bookings.map((b) => ({
      bookingRef: b.bookingRef,
      customer: b.user.name,
      email: b.user.email,
      amount: b.totalAmount,
      seats: b.seats.length,
      createdAt: b.createdAt,
    })),
  });
}

module.exports = { createEvent, listEvents, getEvent, getEventSeats, getEventSummary };
