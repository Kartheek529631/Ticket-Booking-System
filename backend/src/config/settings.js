module.exports = {
  SEAT_HOLD_TTL_MS: Number(process.env.SEAT_HOLD_TTL_MS || 10 * 60 * 1000),
  WAITLIST_OFFER_TTL_MS: Number(process.env.WAITLIST_OFFER_TTL_MS || 15 * 60 * 1000),
  SCHEDULER_INTERVAL_MS: Number(process.env.SCHEDULER_INTERVAL_MS || 15 * 1000),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
};
