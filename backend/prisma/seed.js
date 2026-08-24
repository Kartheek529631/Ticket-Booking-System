const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: { name: 'Venue Admin', email: 'admin@demo.com', password, role: 'ADMIN' },
  });

  const organiser = await prisma.user.upsert({
    where: { email: 'organiser@demo.com' },
    update: {},
    create: { name: 'Demo Organiser', email: 'organiser@demo.com', password, role: 'ORGANISER' },
  });

  await prisma.user.upsert({
    where: { email: 'customer@demo.com' },
    update: {},
    create: { name: 'Demo Customer', email: 'customer@demo.com', password, role: 'CUSTOMER' },
  });

  let venue = await prisma.venue.findFirst({ where: { name: 'Grand Cinema Hall' } });
  if (!venue) {
    const rows = [
      { row: 'A', numbers: [1, 2, 3, 4, 5, 6], category: 'Premium' },
      { row: 'B', numbers: [1, 2, 3, 4, 5, 6], category: 'Premium' },
      { row: 'C', numbers: [1, 2, 3, 4, 5, 6, 7, 8], category: 'Standard' },
      { row: 'D', numbers: [1, 2, 3, 4, 5, 6, 7, 8], category: 'Standard' },
    ];
    const seatsToCreate = [];
    for (const r of rows) {
      for (const n of r.numbers) {
        seatsToCreate.push({ row: r.row, number: n, category: r.category, label: `${r.row}${n}` });
      }
    }
    venue = await prisma.venue.create({
      data: {
        name: 'Grand Cinema Hall',
        address: '123 Movie Lane, Vijayawada',
        adminId: admin.id,
        seats: { create: seatsToCreate },
      },
      include: { seats: true },
    });
  }

  const existingEvent = await prisma.event.findFirst({ where: { title: 'Interstellar — Special Screening' } });
  if (!existingEvent) {
    const venueWithSeats = await prisma.venue.findUnique({ where: { id: venue.id }, include: { seats: true } });
    await prisma.event.create({
      data: {
        title: 'Interstellar — Special Screening',
        type: 'MOVIE',
        description: 'A special big-screen re-release.',
        date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        organiserId: organiser.id,
        venueId: venue.id,
        pricing: { create: [{ category: 'Premium', price: 450 }, { category: 'Standard', price: 250 }] },
        eventSeats: { create: venueWithSeats.seats.map((s) => ({ seatId: s.id, status: 'AVAILABLE' })) },
      },
    });
  }

  console.log('Seed complete. Demo logins (password: password123):');
  console.log('  admin@demo.com     (ADMIN)');
  console.log('  organiser@demo.com (ORGANISER)');
  console.log('  customer@demo.com  (CUSTOMER)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
