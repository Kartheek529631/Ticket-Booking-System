const prisma = require('../config/prisma');
const { SCHEDULER_INTERVAL_MS } = require('../config/settings');
const { emitSeatUpdate } = require('../socket');
const { expireOffer } = require('./waitlist.service');

/**
 * TTL ENFORCEMENT
 * ---------------
 * Rather than relying on a client-driven timer (which a customer could
 * simply not trigger by closing the tab), expiry is swept periodically by
 * the server itself, directly against the database's holdExpiresAt column.
 * This is what actually reclaims seats when a checkout is abandoned.
 *
 * Two independent sweeps run every SCHEDULER_INTERVAL_MS:
 *   1. HELD seats whose TTL passed  -> back to AVAILABLE.
 *   2. OFFERED seats (waitlist) whose TTL passed -> cascade to next in line.
 */

async function sweepExpiredHolds() {
  const now = new Date();
  const expired = await prisma.eventSeat.findMany({
    where: { status: 'HELD', holdExpiresAt: { lt: now } },
    include: { seat: true },
  });
  if (expired.length === 0) return;

  const byEvent = groupBy(expired, (s) => s.eventId);
  for (const [eventId, seats] of Object.entries(byEvent)) {
    const ids = seats.map((s) => s.id);
    // Conditional update guards against a seat having been booked in the
    // instant between the read above and this write.
    await prisma.eventSeat.updateMany({
      where: { id: { in: ids }, status: 'HELD', holdExpiresAt: { lt: now } },
      data: { status: 'AVAILABLE', heldByUserId: null, holdExpiresAt: null, version: { increment: 1 } },
    });
    const refreshed = await prisma.eventSeat.findMany({ where: { id: { in: ids } }, include: { seat: true } });
    emitSeatUpdate(Number(eventId), refreshed.map(serialize));
  }
}

async function sweepExpiredWaitlistOffers() {
  const now = new Date();
  const expiredEntries = await prisma.waitlist.findMany({
    where: { status: 'OFFERED', offerExpiresAt: { lt: now } },
  });
  for (const entry of expiredEntries) {
    await expireOffer(entry.id);
  }
}

function serialize(eventSeat) {
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

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
}

function startSchedulers() {
  // node-cron needs a cron expression; we instead use a plain interval for
  // sub-minute precision, which is what a 10-15 minute TTL sweep needs.
  setInterval(() => {
    sweepExpiredHolds().catch((err) => console.error('[scheduler] hold sweep failed:', err));
    sweepExpiredWaitlistOffers().catch((err) => console.error('[scheduler] waitlist sweep failed:', err));
  }, SCHEDULER_INTERVAL_MS);

  console.log(`[scheduler] TTL sweeps running every ${SCHEDULER_INTERVAL_MS / 1000}s`);
}

module.exports = { startSchedulers, sweepExpiredHolds, sweepExpiredWaitlistOffers };
