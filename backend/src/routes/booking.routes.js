const router = require('express').Router();
const ctrl = require('../controllers/booking.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/', requireAuth, requireRole('CUSTOMER'), ctrl.createBooking);
router.get('/', requireAuth, requireRole('CUSTOMER'), ctrl.myBookings);
router.post('/:id/cancel', requireAuth, requireRole('CUSTOMER'), ctrl.cancelBooking);
router.post('/waitlist-offer/:id/accept', requireAuth, requireRole('CUSTOMER'), ctrl.acceptWaitlistOffer);

module.exports = router;
