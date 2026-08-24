const prisma = require('../config/prisma');

// Admin creates a venue with a full seat layout in one call.
// seatLayout: [{ row: "A", numbers: [1,2,3,4,5,6,7,8], category: "Premium" }, ...]
async function createVenue(req, res) {
  const { name, address, seatLayout } = req.body;
  if (!name || !address || !Array.isArray(seatLayout) || seatLayout.length === 0) {
    return res.status(400).json({ error: 'name, address, and a non-empty seatLayout are required' });
  }

  const seatsToCreate = [];
  for (const rowDef of seatLayout) {
    const { row, numbers, category } = rowDef;
    if (!row || !Array.isArray(numbers) || !category) {
      return res.status(400).json({ error: 'Each seatLayout row needs row, numbers[], category' });
    }
    for (const number of numbers) {
      seatsToCreate.push({ row, number, category, label: `${row}${number}` });
    }
  }

  const venue = await prisma.venue.create({
    data: {
      name,
      address,
      adminId: req.user.id,
      seats: { create: seatsToCreate },
    },
    include: { seats: true },
  });

  res.status(201).json(venue);
}

async function listVenues(req, res) {
  const venues = await prisma.venue.findMany({
    where: req.user?.role === 'ADMIN' ? { adminId: req.user.id } : {},
    include: { _count: { select: { seats: true, events: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(venues);
}

async function getVenue(req, res) {
  const venue = await prisma.venue.findUnique({
    where: { id: Number(req.params.id) },
    include: { seats: true },
  });
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  res.json(venue);
}

module.exports = { createVenue, listVenues, getVenue };
