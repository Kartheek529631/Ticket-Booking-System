const prisma = require('../config/prisma');
const { WAITLIST_OFFER_TTL_MS } = require('../config/settings');
const { sendWaitlistOfferEmail } = require('../utils/email');
const { emitSeatUpdate, emitWaitlistUpdate } = require('../socket');

/**
 * WAITLIST FLOW
 * -------------
 * Waitlist is a per-(event, category) FIFO queue (ordered by createdAt).
 * A customer may only join when that category currently has 0 AVAILABLE
 * seats (i.e. "sold out" for that category).
 *
 * When a seat in that category frees up (cancellation, or a previous offer
 * expiring), the seat is put into OFFERED state and reserved exclusively
 * for the head-of-queue customer with a holdExpiresAt (offer TTL). The
 * customer gets an email with a link to complete the booking.
 *
 * If they accept in time -> normal booking confirmation flow runs against
 * that OFFERED seat (treated like a hold) -> waitlist entry becomes CONVERTED.
 * If the TTL lapses first -> a scheduler (see services/scheduler.js) marks
 * the entry EXPIRED and calls offerSeatToNextInWaitlist again, cascading to
 * the next person in line. If nobody is left waiting, the seat becomes
 * plain AVAILABLE.
 */

async function isSoldOut(eventId, category) {
  const available = await prisma.eventSeat.count({
    where: { eventId, status: 'AVAILABLE', seat: { category } },
  });
  return available === 0;
}

async function joinWaitlist(eventId, userId, category) {
  const soldOut = await isSoldOut(eventId, category);
  if (!soldOut) {
    const err = new Error(`Seats are still available in ${category} — no need to join the waitlist`);
    err.name = 'WaitlistError';
    throw err;
  }

  const existing = await prisma.waitlist.findFirst({
    where: { eventId, userId, category, status: { in: ['WAITING', 'OFFERED'] } },
  });
  if (existing) return existing;

  return prisma.waitlist.create({ data: { eventId, userId, category, status: 'WAITING' } });
}

// Attempts to hand a just-freed seat to the next WAITING entry for that
// (event, category). Returns true if offered to someone, false if the
// queue is empty (caller should then mark the seat plain AVAILABLE).
async function offerSeatToNextInWaitlist(eventId, category, eventSeatId) {
  const next = await prisma.waitlist.findFirst({
    where: { eventId, category, status: 'WAITING' },
    orderBy: { createdAt: 'asc' },
    include: { user: true },
  });
  if (!next) return false;

  const offerExpiresAt = new Date(Date.now() + WAITLIST_OFFER_TTL_MS);

  await prisma.$transaction([
    prisma.eventSeat.update({
      where: { id: eventSeatId },
      data: {
        status: 'OFFERED',
        heldByUserId: next.userId,
        holdExpiresAt: offerExpiresAt,
        version: { increment: 1 },
      },
    }),
    prisma.waitlist.update({
      where: { id: next.id },
      data: { status: 'OFFERED', offeredEventSeatId: eventSeatId, offerExpiresAt },
    }),
  ]);

  const eventSeat = await prisma.eventSeat.findUnique({ where: { id: eventSeatId }, include: { seat: true } });
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: true } });

  emitSeatUpdate(eventId, [
    {
      eventSeatId: eventSeat.id,
      seatId: eventSeat.seatId,
      label: eventSeat.seat.label,
      row: eventSeat.seat.row,
      number: eventSeat.seat.number,
      category: eventSeat.seat.category,
      status: eventSeat.status,
      holdExpiresAt: eventSeat.holdExpiresAt,
    },
  ]);
  emitWaitlistUpdate(eventId, { category, offeredTo: next.userId, offerExpiresAt });

  const acceptUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/waitlist/${next.id}/accept`;
  sendWaitlistOfferEmail({
    to: next.user.email,
    name: next.user.name,
    event,
    category,
    offerExpiresAt,
    acceptUrl,
  }).catch((err) => console.error('[waitlist] offer email failed:', err.message));

  return true;
}

// Called when a waitlisted customer's offer TTL lapses without action.
// Cascades the seat to the next person in line, or frees it entirely.
async function expireOffer(waitlistId) {
  const entry = await prisma.waitlist.findUnique({ where: { id: waitlistId } });
  if (!entry || entry.status !== 'OFFERED') return;

  await prisma.waitlist.update({ where: { id: entry.id }, data: { status: 'EXPIRED', respondedAt: new Date() } });

  const offered = await offerSeatToNextInWaitlist(entry.eventId, entry.category, entry.offeredEventSeatId);
  if (!offered) {
    await prisma.eventSeat.update({
      where: { id: entry.offeredEventSeatId },
      data: { status: 'AVAILABLE', heldByUserId: null, holdExpiresAt: null, version: { increment: 1 } },
    });
    const eventSeat = await prisma.eventSeat.findUnique({ where: { id: entry.offeredEventSeatId }, include: { seat: true } });
    emitSeatUpdate(entry.eventId, [
      {
        eventSeatId: eventSeat.id,
        seatId: eventSeat.seatId,
        label: eventSeat.seat.label,
        row: eventSeat.seat.row,
        number: eventSeat.seat.number,
        category: eventSeat.seat.category,
        status: eventSeat.status,
        holdExpiresAt: eventSeat.holdExpiresAt,
      },
    ]);
  }
}

// Customer clicks "complete my booking" on the offer email/link in time.
// This simply confirms that the seat is still OFFERED to them and returns
// it so the booking controller can run the normal confirmBooking() flow.
async function acceptOffer(waitlistId, userId) {
  const entry = await prisma.waitlist.findUnique({ where: { id: waitlistId } });
  if (!entry) throw new Error('Waitlist entry not found');
  if (entry.userId !== userId) throw new Error('Not your waitlist offer');
  if (entry.status !== 'OFFERED') throw new Error('This offer is no longer active');
  if (entry.offerExpiresAt && entry.offerExpiresAt < new Date()) {
    throw new Error('This offer has expired');
  }
  return entry;
}

async function markConverted(waitlistId) {
  await prisma.waitlist.update({ where: { id: waitlistId }, data: { status: 'CONVERTED', respondedAt: new Date() } });
}

module.exports = {
  isSoldOut,
  joinWaitlist,
  offerSeatToNextInWaitlist,
  expireOffer,
  acceptOffer,
  markConverted,
};
