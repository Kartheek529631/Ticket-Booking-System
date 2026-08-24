const prisma = require('../config/prisma');
const { SEAT_HOLD_TTL_MS } = require('../config/settings');
const { generateBookingRef } = require('../utils/bookingRef');
const { generateBookingQr } = require('../utils/qrcode');
const { sendBookingConfirmationEmail, sendCancellationEmail } = require('../utils/email');
const { emitSeatUpdate } = require('../socket');
const { offerSeatToNextInWaitlist } = require('./waitlist.service');

/**
 * CONCURRENCY STRATEGY
 * ---------------------
 * Every seat's live state lives in a single EventSeat row (one row per
 * seat-per-event). Instead of "read status, then write", every state
 * transition is a single conditional UPDATE:
 *
 *   UPDATE EventSeat SET status = 'HELD', ... WHERE id = ? AND status = 'AVAILABLE'
 *
 * The database evaluates the WHERE clause and applies the write atomically
 * per row — this is true for SQLite (single-writer, serialized) and for
 * Postgres/MySQL (the row is locked before the predicate is re-checked).
 * If two customers race for the same seat, exactly one UPDATE affects a row
 * (returns count 1); the loser's UPDATE affects 0 rows, so its Prisma
 * `updateMany` count is 0 and the request is rejected with 409. No seat can
 * ever be held or booked twice.
 *
 * All multi-seat operations run inside prisma.$transaction so a booking of
 * several seats either fully succeeds or fully rolls back.
 */

async function holdSeats(eventId, seatIds, userId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SEAT_HOLD_TTL_MS);
  const held = [];
  const failed = [];

  await prisma.$transaction(async (tx) => {
    for (const eventSeatId of seatIds) {
      // Conditional update: only succeeds if seat is currently AVAILABLE,
      // or HELD by the *same* user (renewal), or a stale HELD whose TTL passed.
      const result = await tx.eventSeat.updateMany({
        where: {
          id: eventSeatId,
          eventId,
          OR: [
            { status: 'AVAILABLE' },
            { status: 'HELD', heldByUserId: userId },
            { status: 'HELD', holdExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: 'HELD',
          heldByUserId: userId,
          holdExpiresAt: expiresAt,
          version: { increment: 1 },
        },
      });

      if (result.count === 1) {
        held.push(eventSeatId);
      } else {
        failed.push(eventSeatId);
      }
    }

    if (failed.length > 0) {
      // Roll back the whole transaction — an all-or-nothing hold request.
      throw new HoldConflictError(failed);
    }
  });

  const seats = await prisma.eventSeat.findMany({
    where: { id: { in: held } },
    include: { seat: true },
  });
  emitSeatUpdate(eventId, seats.map(serializeSeat));
  return { held: seats, expiresAt };
}

class HoldConflictError extends Error {
  constructor(seatIds) {
    super('One or more seats are no longer available');
    this.name = 'HoldConflictError';
    this.seatIds = seatIds;
  }
}

// Explicit release, e.g. customer abandons/cancels checkout before confirming.
async function releaseSeats(eventId, seatIds, userId) {
  const result = await prisma.eventSeat.updateMany({
    where: { id: { in: seatIds }, eventId, status: 'HELD', heldByUserId: userId },
    data: { status: 'AVAILABLE', heldByUserId: null, holdExpiresAt: null, version: { increment: 1 } },
  });
  const seats = await prisma.eventSeat.findMany({ where: { id: { in: seatIds }, eventId }, include: { seat: true } });
  emitSeatUpdate(eventId, seats.map(serializeSeat));
  return result.count;
}

// Confirms a booking for seats currently held by this user. Idempotent-safe:
// only seats verified HELD-by-this-user-and-unexpired move to BOOKED.
async function confirmBooking({ eventId, seatIds, userId }) {
  const now = new Date();

  const booking = await prisma.$transaction(async (tx) => {
    const eventSeats = await tx.eventSeat.findMany({
      where: { id: { in: seatIds }, eventId },
      include: { seat: true },
    });

    if (eventSeats.length !== seatIds.length) {
      throw new BookingError('Some seats do not exist for this event');
    }
    const invalid = eventSeats.filter(
      (s) => s.status !== 'HELD' || s.heldByUserId !== userId || (s.holdExpiresAt && s.holdExpiresAt < now)
    );
    if (invalid.length > 0) {
      throw new BookingError('Your hold on one or more seats has expired. Please reselect your seats.', invalid.map((s) => s.id));
    }

    const event = await tx.event.findUnique({ where: { id: eventId }, include: { pricing: true, venue: true } });
    const priceByCategory = Object.fromEntries(event.pricing.map((p) => [p.category, p.price]));

    let total = 0;
    const seatPrices = eventSeats.map((es) => {
      const price = priceByCategory[es.seat.category] ?? 0;
      total += price;
      return { eventSeatId: es.id, price };
    });

    const bookingRef = generateBookingRef();
    const created = await tx.booking.create({
      data: {
        bookingRef,
        userId,
        eventId,
        totalAmount: total,
        status: 'CONFIRMED',
        seats: { create: seatPrices },
      },
      include: { seats: { include: { eventSeat: { include: { seat: true } } } }, event: { include: { venue: true } } },
    });

    // Flip seats to BOOKED — again a conditional update guarding against any
    // last-instant race (e.g. hold expired mid-transaction).
    for (const es of eventSeats) {
      const result = await tx.eventSeat.updateMany({
        where: { id: es.id, status: 'HELD', heldByUserId: userId },
        data: { status: 'BOOKED', holdExpiresAt: null, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw new BookingError('Seat hold expired during confirmation. Please try again.');
      }
    }

    return created;
  });

  // Fire-and-forget side effects: QR + email (do not block/roll back the booking on email failure).
  const seatLabels = booking.seats.map((bs) => bs.eventSeat.seat.label);
  generateBookingQr(booking.bookingRef, { eventId, seats: seatLabels })
    .then(async (qrDataUrl) => {
      await prisma.booking.update({ where: { id: booking.id }, data: { qrCodeDataUrl: qrDataUrl } });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      await sendBookingConfirmationEmail({
        to: user.email,
        name: user.name,
        event: booking.event,
        seatLabels,
        bookingRef: booking.bookingRef,
        totalAmount: booking.totalAmount,
        qrDataUrl,
      });
    })
    .catch((err) => console.error('[booking] QR/email step failed:', err.message));

  emitSeatUpdate(eventId, booking.seats.map((bs) => serializeSeat(bs.eventSeat)));
  return booking;
}

class BookingError extends Error {
  constructor(message, seatIds) {
    super(message);
    this.name = 'BookingError';
    this.seatIds = seatIds;
  }
}

// Cancels a confirmed booking. If a waitlist exists for the freed category,
// the seat is routed straight to the next waitlisted customer instead of
// going back to general availability.
async function cancelBooking(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { seats: { include: { eventSeat: { include: { seat: true } } } }, event: true, user: true },
  });
  if (!booking) throw new BookingError('Booking not found');
  if (booking.userId !== userId) throw new BookingError('Not your booking');
  if (booking.status === 'CANCELLED') throw new BookingError('Booking already cancelled');

  await prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });

  for (const bs of booking.seats) {
    const eventSeatId = bs.eventSeat.id;
    const category = bs.eventSeat.seat.category;
    // Try to hand the seat straight to the next waitlisted customer.
    const offered = await offerSeatToNextInWaitlist(booking.eventId, category, eventSeatId);
    if (!offered) {
      await prisma.eventSeat.update({
        where: { id: eventSeatId },
        data: { status: 'AVAILABLE', heldByUserId: null, holdExpiresAt: null, version: { increment: 1 } },
      });
    }
  }

  const updatedSeats = await prisma.eventSeat.findMany({
    where: { id: { in: booking.seats.map((s) => s.eventSeatId) } },
    include: { seat: true },
  });
  emitSeatUpdate(booking.eventId, updatedSeats.map(serializeSeat));

  sendCancellationEmail({ to: booking.user.email, name: booking.user.name, event: booking.event, bookingRef: booking.bookingRef }).catch(
    (err) => console.error('[cancel] email failed:', err.message)
  );

  return booking;
}

function serializeSeat(eventSeat) {
  return {
    eventSeatId: eventSeat.id,
    seatId: eventSeat.seatId,
    label: eventSeat.seat.label,
    row: eventSeat.seat.row,
    number: eventSeat.seat.number,
    category: eventSeat.seat.category,
    status: eventSeat.status,
    holdExpiresAt: eventSeat.holdExpiresAt,
  };
}

module.exports = {
  holdSeats,
  releaseSeats,
  confirmBooking,
  cancelBooking,
  serializeSeat,
  HoldConflictError,
  BookingError,
};
