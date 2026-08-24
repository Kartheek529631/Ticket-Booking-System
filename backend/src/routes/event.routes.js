const router = require('express').Router();
const ctrl = require('../controllers/event.controller');
const bookingCtrl = require('../controllers/booking.controller');
const waitlistCtrl = require('../controllers/waitlist.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/', requireAuth, requireRole('ORGANISER'), ctrl.createEvent);
router.get('/', ctrl.listEvents);
router.get('/:id', ctrl.getEvent);
router.get('/:id/seats', ctrl.getEventSeats);
router.get('/:id/summary', requireAuth, requireRole('ORGANISER'), ctrl.getEventSummary);

// Seat hold lifecycle (checkout flow) — scoped to one event's seat map.
router.post('/:id/hold', requireAuth, requireRole('CUSTOMER'), bookingCtrl.holdSeats);
router.delete('/:id/hold', requireAuth, requireRole('CUSTOMER'), bookingCtrl.releaseSeats);

// Waitlist for a sold-out category on this event.
router.post('/:id/waitlist', requireAuth, requireRole('CUSTOMER'), waitlistCtrl.joinWaitlist);
router.get('/:id/waitlist', requireAuth, requireRole('ORGANISER'), waitlistCtrl.eventWaitlist);

module.exports = router;
