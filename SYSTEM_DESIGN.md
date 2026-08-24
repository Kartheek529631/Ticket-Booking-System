# System Design Write-up — Ticket Booking System

## 1. Seat hold and TTL mechanism

Every physical seat's live state for one specific show is a single row in
`EventSeat` (one row per seat-per-event), carrying `status`
(`AVAILABLE`/`HELD`/`OFFERED`/`BOOKED`), `heldByUserId`, and `holdExpiresAt`.
Keeping this as one narrow, frequently-updated table — separate from the
static `Seat` layout and from `Booking` — means every hold/release/book
operation is a cheap, indexable single-row write instead of a scan across
booking history.

When a customer selects seats, `POST /events/:id/hold` sets matching rows to
`HELD` with `holdExpiresAt = now + TTL` (default 10 minutes, configurable via
`SEAT_HOLD_TTL_MS`). The frontend shows a live countdown and calls the same
endpoint idempotently if the customer reselects, extending their own hold.

Reclaiming an abandoned checkout cannot depend on the browser — a closed tab
or dead connection never fires a "please release my seat" request. Instead a
**server-side scheduler** (`services/scheduler.js`) sweeps the database every
`SCHEDULER_INTERVAL_MS` (default 15s), looking for `HELD` rows whose
`holdExpiresAt` has passed, and flips them back to `AVAILABLE`. This is the
single source of truth for expiry: whether the customer closed the tab,
lost connectivity, or is still sitting on the page, the seat is reclaimed on
the same schedule, and every connected client's seat map updates via a
Socket.io `seat:update` broadcast to that event's room. The same sweep also
drives waitlist offer expiry (see §3).

## 2. Concurrency prevention

The seat-hold problem is a classic race: two customers click the same seat
within milliseconds. The system prevents double-holding/double-booking with
**conditional atomic updates** rather than a read-then-write pattern:

```sql
UPDATE EventSeat SET status='HELD', heldByUserId=?, holdExpiresAt=?
WHERE id=? AND status='AVAILABLE'
```

The database evaluates the `WHERE` clause and applies the write as one
indivisible operation per row. On Postgres/MySQL, the row is locked before
the predicate is re-checked, so a losing concurrent transaction's UPDATE
simply matches zero rows rather than overwriting a winner's change; on
SQLite, the entire database is single-writer and serialized, making the same
guarantee trivially true. Prisma's `updateMany` returns an affected-row
count, so the application layer knows immediately whether it won the race
(`count === 1`) or lost it (`count === 0`) — no separate locking primitive,
advisory lock, or Redis dependency is needed.

Multi-seat operations (holding several seats, or confirming a multi-seat
booking) wrap this pattern in a single `prisma.$transaction`: each seat in
the request is conditionally updated in turn, and if *any* seat in the batch
fails its predicate, the whole transaction throws and rolls back — an
all-or-nothing request, so a customer never ends up holding 3 of the 4 seats
they asked for. The same conditional-update guard is applied a second time at
booking confirmation (flipping `HELD → BOOKED`), closing the narrow window
where a hold could expire in the instant between the confirm request arriving
and the transaction committing.

## 3. Waitlist auto-assignment flow

Waitlist entries are a plain FIFO queue, scoped per `(eventId, category)` and
ordered by `createdAt`. A customer may only join once that category has zero
`AVAILABLE` seats — checked server-side on join, not just inferred from the
UI — so the queue only ever represents genuine demand.

When a seat in a category frees up (a cancellation, or a previous offer
lapsing), `offerSeatToNextInWaitlist()` runs as one transaction: it finds the
oldest `WAITING` entry, sets that `EventSeat` to `OFFERED` reserved
specifically for that user with a fresh expiry (`offerExpiresAt`, default 15
minutes via `WAITLIST_OFFER_TTL_MS`), and updates the `Waitlist` row to
`OFFERED`. Booking cancellation checks the waitlist for that seat's category
*before* ever marking a seat plain `AVAILABLE` — a sold-out show's cancelled
seat always routes to the waitlist first, and only falls back to general
availability once the queue is empty.

## 4. Time-limited offer handling

An `OFFERED` seat behaves like a hold, but addressed to one specific
customer: the customer receives an email with a link
(`/waitlist/:id/accept`) valid until `offerExpiresAt`. Accepting runs the
same booking-confirmation path used for a normal hold, since the seat is
already reserved to them — no separate booking code path to maintain.

Non-response is handled by the same periodic scheduler that sweeps hold
expiry: it separately queries `Waitlist` rows still `OFFERED` past their
`offerExpiresAt`, marks them `EXPIRED`, and immediately calls
`offerSeatToNextInWaitlist()` again for that seat — cascading down the queue
until someone accepts within their window or the queue is exhausted, at
which point the seat becomes plain `AVAILABLE` and is broadcast to all
viewers of that event's seat map.
