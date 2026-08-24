const { v4: uuidv4 } = require('uuid');

// Short, human-readable booking reference, e.g. "TB-9F3A2C1B"
function generateBookingRef() {
  const chunk = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `TB-${chunk}`;
}

module.exports = { generateBookingRef };
