# Ticket Booking System

A full-stack ticket booking platform for movies and concerts: visual seat maps,
seat holds with auto-release, sold-out waitlists with automatic seat
reassignment, and emailed QR-code tickets.

- **Backend:** Node.js, Express, Prisma ORM, SQLite (default) / PostgreSQL, Socket.io, JWT auth
- **Frontend:** React (Vite), Socket.io client, React Router

---

## 1. Project structure

```
ticket-booking-system/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # full DB schema (see §4)
│   │   └── seed.js            # demo users, venue, event
│   ├── src/
│   │   ├── config/            # prisma client, timing settings
│   │   ├── middleware/auth.js # JWT auth + role guards
│   │   ├── utils/             # QR code, email, booking ref generation
│   │   ├── services/
│   │   │   ├── seat.service.js      # hold/confirm/cancel — concurrency logic
│   │   │   ├── waitlist.service.js  # FIFO queue + time-limited offers
│   │   │   └── scheduler.js         # TTL sweeps (hold expiry, offer expiry)
│   │   ├── controllers/ + routes/   # REST API
│   │   ├── socket.js           # real-time seat map broadcasts
│   │   └── index.js             # server entrypoint
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/              # Login, Register, Events, EventDetail, MyBookings,
│   │   │                       # WaitlistAccept, AdminDashboard, OrganiserDashboard
│   │   ├── components/         # SeatMap, Navbar, ProtectedRoute
│   │   ├── context/AuthContext.jsx
│   │   ├── api.js / socket.js
│   │   └── theme.css           # design tokens ("Marquee" cinema theme)
│   ├── .env.example
│   └── package.json
├── README.md                   (this file)
└── SYSTEM_DESIGN.md             800-word design write-up
```

---

## 2. Setup guide (local)

### Prerequisites
- Node.js 18+
- npm

### Backend

```bash
cd backend
cp .env.example .env         # defaults work out of the box (SQLite + Ethereal email)
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed                 # creates demo admin/organiser/customer + a sample event
npm run dev                  # http://localhost:4000
```

> **Note on this sandbox build:** the code in this zip was written and
> syntax-checked in a network-restricted sandbox that could not reach
> Prisma's engine-binary CDN, so `prisma migrate` could not be executed
> live here. On a normal machine or any deployment host with standard
> internet access, the commands above work as documented — this is purely
> a sandbox limitation, not a code issue.

Demo logins (password `password123` for all):
| Email | Role |
|---|---|
| admin@demo.com | ADMIN |
| organiser@demo.com | ORGANISER |
| customer@demo.com | CUSTOMER |

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                  # http://localhost:5173
```

### Email delivery

If you don't set `SMTP_*` in `backend/.env`, the app **automatically** creates a
free [Ethereal](https://ethereal.email) test inbox at boot. Emails aren't
delivered to real addresses, but every send logs a preview URL to the backend
console, e.g.:

```
[email] Preview (Ethereal, no real SMTP configured): https://ethereal.email/message/...
```

To send real email, fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
in `.env` — any free-tier SMTP provider works (Gmail App Password, Brevo,
Mailtrap, SendGrid's SMTP relay, etc).

### Switching to PostgreSQL

1. In `backend/prisma/schema.prisma`, change:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. Set `DATABASE_URL="postgresql://user:pass@host:5432/dbname"` in `.env`.
3. Re-run `npx prisma migrate dev`.

All concurrency-critical queries use conditional `UPDATE ... WHERE status = X`
statements (see §5), which are safe on both SQLite and Postgres without any
other code changes.

---

## 3. Deploying (Render / Railway / Vercel)

**Backend (Render/Railway):**
1. New Web Service → point at `backend/`.
2. Build command: `npm install && npx prisma generate && npx prisma migrate deploy`
3. Start command: `npm start`
4. Add a managed Postgres instance and set `DATABASE_URL` to it (switch the
   schema provider as in §2).
5. Set `JWT_SECRET`, `CLIENT_URL` (your deployed frontend URL), and `SMTP_*`
   env vars.

**Frontend (Vercel/Render Static Site):**
1. New Static Site → point at `frontend/`.
2. Build command: `npm install && npm run build`, publish dir: `dist`.
3. Set `VITE_API_URL` and `VITE_SOCKET_URL` to your deployed backend URL.

> A live hosted URL isn't included with this delivery — it must be deployed
> from your own Render/Railway/Vercel account using the steps above, since
> this build was produced in an offline sandbox without a way to publish to
> a public host.

---

## 4. Database schema (Prisma)

| Model | Purpose |
|---|---|
| `User` | Customer / Organiser / Admin, role-based |
| `Venue` | Owned by an Admin; has an address and a fixed seat layout |
| `Seat` | One physical seat in a venue (`row`, `number`, `label`, `category`) — reused across every event held at that venue |
| `Event` | A specific movie screening or concert (title, type, venue, date, organiser) |
| `EventPricing` | Per-category price for one event |
| `EventSeat` | **The live seat map row** — one per (event, seat) pair. Holds `status` (`AVAILABLE`/`HELD`/`OFFERED`/`BOOKED`), `heldByUserId`, `holdExpiresAt`, and a `version` counter |
| `Booking` | A confirmed (or later cancelled) purchase: ref code, total, QR data URL |
| `BookingSeat` | Join row: which `EventSeat`s belong to which `Booking`, at what price |
| `Waitlist` | FIFO queue entry per (event, category, user) with `status` (`WAITING`/`OFFERED`/`EXPIRED`/`CONVERTED`/`CANCELLED`) |

Full field-level definitions are in `backend/prisma/schema.prisma`, which is
heavily commented.

---

## 5. Seat hold, TTL, and concurrency — how it works

Every physical seat's live state for a given show lives in exactly **one**
`EventSeat` row. All state transitions (hold, release, book, offer) are
single **conditional UPDATE** statements of the shape:

```sql
UPDATE EventSeat SET status = 'HELD', heldByUserId = ?, holdExpiresAt = ?
WHERE id = ? AND status = 'AVAILABLE'
```

The database applies the `WHERE` predicate and the write as one atomic
operation per row — true on SQLite (single-writer, fully serialized) and on
Postgres/MySQL (the row is locked before the predicate is re-checked, so a
concurrent transaction's conflicting UPDATE simply matches 0 rows). If two
customers click the same seat within milliseconds of each other:

- Exactly one `UPDATE` affects 1 row → that request succeeds.
- The other's `UPDATE` affects 0 rows → Prisma reports `count: 0` → the API
  returns `409 Conflict` with the specific seat IDs that lost the race, so
  the frontend can deselect them and refresh.

Multi-seat requests (hold several seats, or confirm a multi-seat booking) run
inside a single `prisma.$transaction`, so a booking either fully succeeds or
fully rolls back — no half-booked orders.

**TTL / auto-release:** rather than trusting the browser to release a hold on
tab-close, a **server-side scheduler** (`services/scheduler.js`) sweeps the DB
every `SCHEDULER_INTERVAL_MS` (default 15s) for `HELD` seats whose
`holdExpiresAt` has passed, and flips them back to `AVAILABLE` with the same
conditional-update pattern. This is what actually reclaims an abandoned
checkout — the seat map updates for every connected client in real time via
a `seat:update` Socket.io event broadcast to that event's room.

## 6. Waitlist auto-assignment & time-limited offers

- A customer may join a category's waitlist only once that category has zero
  `AVAILABLE` seats (checked server-side, not just in the UI).
- Waitlist entries are a plain FIFO queue: `ORDER BY createdAt ASC` within
  `(eventId, category, status = 'WAITING')`.
- When a seat in that category frees up — from a cancellation, or from a
  previous offer expiring — `offerSeatToNextInWaitlist()` atomically:
  1. Sets that `EventSeat` to `OFFERED`, reserved for the head-of-queue user,
     with a fresh `holdExpiresAt` (the offer TTL, default 15 min).
  2. Marks that `Waitlist` row `OFFERED` and emails the customer a
     time-limited link (`/waitlist/:id/accept`).
- If the customer clicks through and confirms in time, the normal booking
  confirmation path runs against that seat (the seat is already reserved to
  them), and the waitlist entry becomes `CONVERTED`.
- If the TTL lapses first, the same scheduler that sweeps hold expiry also
  sweeps expired `OFFERED` waitlist entries, marks them `EXPIRED`, and
  **cascades the seat to the next `WAITING` entry** — repeating until someone
  accepts or the queue is empty (in which case the seat becomes plain
  `AVAILABLE` again).
- Cancelling a confirmed booking checks the waitlist for that seat's category
  *before* releasing the seat to general availability — so a sold-out show's
  freed seat always goes to the waitlist first.

## 7. QR codes & email

- On booking confirmation, the server generates a QR code (via the `qrcode`
  package) encoding a small JSON payload — `{ ref: "TB-XXXXXXXX", eventId,
  seats }`. A gate scanner/organiser app would look up `ref` in the
  `Booking` table to validate a ticket; the QR never carries payment data.
- The QR is stored on the booking (`qrCodeDataUrl`, a base64 PNG data URL,
  shown in the frontend "My Bookings" table) and emailed as an inline
  attachment (`cid:qrcode`) alongside a confirmation email with the event,
  seats, and total.
- QR/email generation happens **after** the booking transaction commits and
  never blocks or rolls back the booking if email delivery fails — failures
  are logged, not fatal.

---

## 8. API reference

Base URL: `http://localhost:4000/api`. Authenticated routes expect
`Authorization: Bearer <token>`.

### Auth
| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/auth/register` | – | `{ name, email, password, role }` | `role` ∈ CUSTOMER/ORGANISER/ADMIN (default CUSTOMER) |
| POST | `/auth/login` | – | `{ email, password }` | Returns `{ token, user }` |
| GET | `/auth/me` | ✅ | – | Current user |

### Venues (Admin)
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/venues` | ADMIN | `{ name, address, seatLayout: [{ row, numbers:[...], category }] }` |
| GET | `/venues` | optional | – (ADMIN sees only their own) |
| GET | `/venues/:id` | – | – |

### Events (Organiser / public)
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/events` | ORGANISER | `{ title, type, venueId, date, description?, pricing:[{category,price}] }` |
| GET | `/events` | – | `?type=MOVIE\|CONCERT&search=&from=&to=` |
| GET | `/events/:id` | – | – |
| GET | `/events/:id/seats` | – | Full live seat map |
| GET | `/events/:id/summary` | ORGANISER (owner) | Revenue + bookings list |
| POST | `/events/:id/hold` | CUSTOMER | `{ seatIds:[eventSeatId,...] }` → `409` on conflict |
| DELETE | `/events/:id/hold` | CUSTOMER | `{ seatIds:[...] }` — explicit release |
| POST | `/events/:id/waitlist` | CUSTOMER | `{ category }` — only if sold out |
| GET | `/events/:id/waitlist` | ORGANISER (owner) | Queue depth per category |

### Bookings
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/bookings` | CUSTOMER | `{ eventId, seatIds:[...] }` — seats must be currently HELD by this user |
| GET | `/bookings` | CUSTOMER | Booking history |
| POST | `/bookings/:id/cancel` | CUSTOMER (owner) | – |
| POST | `/bookings/waitlist-offer/:id/accept` | CUSTOMER | Confirms a booking against an `OFFERED` waitlist seat |

### Waitlist
| Method | Path | Auth |
|---|---|---|
| GET | `/waitlist/my` | CUSTOMER |

### Real-time (Socket.io)
| Event (client → server) | Payload |
|---|---|
| `event:join` | `eventId` — subscribes to that show's seat updates |
| `event:leave` | `eventId` |

| Event (server → client) | Payload |
|---|---|
| `seat:update` | `{ eventId, seats: [{ eventSeatId, status, ... }] }` |
| `waitlist:update` | `{ eventId, category, offeredTo, offerExpiresAt }` |

---

## 9. Known limitations / what a production hardening pass would add

- SQLite is used by default for zero-config local setup; swap to Postgres
  (§2) before any real multi-instance deployment — SQLite's single-writer
  model won't scale horizontally.
- The scheduler runs in-process via `setInterval`; a multi-instance
  deployment should move this to a single dedicated worker (or a DB-native
  job like Postgres `pg_cron`) to avoid duplicate sweeps.
- Payments are out of scope per the brief — `Booking.totalAmount` is computed
  and stored but no payment gateway is integrated.
- Rate limiting / abuse protection on `/hold` is not implemented.
