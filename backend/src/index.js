require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');

const { initSocket } = require('./socket');
const { startSchedulers } = require('./services/scheduler');

const authRoutes = require('./routes/auth.routes');
const venueRoutes = require('./routes/venue.routes');
const eventRoutes = require('./routes/event.routes');
const bookingRoutes = require('./routes/booking.routes');
const waitlistRoutes = require('./routes/waitlist.routes');

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/bookings', bookingRoutes); // also hosts /api/bookings/events/:id/hold
app.use('/api/waitlist', waitlistRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
initSocket(server);
startSchedulers();

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Ticket Booking API listening on port ${PORT}`));
