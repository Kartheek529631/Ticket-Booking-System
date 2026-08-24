const router = require('express').Router();
const ctrl = require('../controllers/waitlist.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

// Customer's own waitlist entries across all events.
router.get('/my', requireAuth, requireRole('CUSTOMER'), ctrl.myWaitlist);

module.exports = router;
