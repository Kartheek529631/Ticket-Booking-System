const router = require('express').Router();
const ctrl = require('../controllers/venue.controller');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

router.post('/', requireAuth, requireRole('ADMIN'), ctrl.createVenue);
router.get('/', optionalAuth, ctrl.listVenues);
router.get('/:id', ctrl.getVenue);

module.exports = router;
