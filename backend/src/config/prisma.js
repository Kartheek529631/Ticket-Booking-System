const { PrismaClient } = require('@prisma/client');

// Single shared Prisma instance across the app.
const prisma = new PrismaClient();

module.exports = prisma;
