const QRCode = require('qrcode');

/**
 * Generates a QR code for a booking. The QR encodes a compact JSON payload
 * containing the booking reference (the value a gate scanner / organiser
 * would look up in the DB to validate the ticket).
 */
async function generateBookingQr(bookingRef, extra = {}) {
  const payload = JSON.stringify({ ref: bookingRef, ...extra });
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 300,
  });
  return dataUrl; // "data:image/png;base64,...."
}

module.exports = { generateBookingQr };
