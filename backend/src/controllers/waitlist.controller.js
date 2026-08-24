const prisma = require('../config/prisma');
const waitlistService = require('../services/waitlist.service');

async function joinWaitlist(req, res) {
  const eventId = Number(req.params.id);
  const { category } = req.body;
  if (!category) return res.status(400).json({ error: 'category is required' });

  try {
    const entry = await waitlistService.joinWaitlist(eventId, req.user.id, category);
    res.status(201).json(entry);
  } catch (err) {
    if (err.name === 'WaitlistError') return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to join waitlist' });
  }
}

async function myWaitlist(req, res) {
  const entries = await prisma.waitlist.findMany({
    where: { userId: req.user.id },
    include: { event: { include: { venue: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(entries);
}

async function eventWaitlist(req, res) {
  // Organiser-facing view of queue depth per category for their event.
  const eventId = Number(req.params.id);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.organiserId !== req.user.id) return res.status(403).json({ error: 'Not your event' });

  const entries = await prisma.waitlist.findMany({ where: { eventId }, include: { user: { select: { name: true, email: true } } } });
  res.json(entries);
}

module.exports = { joinWaitlist, myWaitlist, eventWaitlist };
