const nodemailer = require('nodemailer');

let transporterPromise = null;

/**
 * Lazily builds a nodemailer transporter.
 * - If SMTP_HOST/SMTP_USER/SMTP_PASS are set in .env, uses that real SMTP provider
 *   (Gmail App Password, Brevo, Mailtrap, SendGrid SMTP, etc. — any free tier works).
 * - Otherwise, auto-creates a free Ethereal test account so the app still runs
 *   out of the box. Ethereal doesn't deliver real mail; instead it gives a
 *   preview URL that is logged to the console for every email "sent".
 */
function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
    );
  } else {
    transporterPromise = nodemailer.createTestAccount().then((account) =>
      nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      })
    );
    console.warn(
      '[email] No SMTP_* env vars set — using an auto-generated Ethereal test inbox. ' +
        'Emails will NOT be delivered to real addresses; a preview link will be logged instead.'
    );
  }
  return transporterPromise;
}

async function sendMail({ to, subject, html, attachments }) {
  const transporter = await getTransporter();
  const from = process.env.EMAIL_FROM || 'Ticket Booking <no-reply@ticketbooking.dev>';
  const info = await transporter.sendMail({ from, to, subject, html, attachments });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[email] Preview (Ethereal, no real SMTP configured): ${previewUrl}`);
  }
  return info;
}

async function sendBookingConfirmationEmail({ to, name, event, seatLabels, bookingRef, totalAmount, qrDataUrl }) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2 style="color:#1f2937;">Booking Confirmed 🎟️</h2>
      <p>Hi ${name},</p>
      <p>Your booking for <strong>${event.title}</strong> is confirmed.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:4px 0; color:#6b7280;">Booking Ref</td><td style="text-align:right;"><strong>${bookingRef}</strong></td></tr>
        <tr><td style="padding:4px 0; color:#6b7280;">Venue</td><td style="text-align:right;">${event.venue?.name || ''}</td></tr>
        <tr><td style="padding:4px 0; color:#6b7280;">Date</td><td style="text-align:right;">${new Date(event.date).toLocaleString()}</td></tr>
        <tr><td style="padding:4px 0; color:#6b7280;">Seats</td><td style="text-align:right;">${seatLabels.join(', ')}</td></tr>
        <tr><td style="padding:4px 0; color:#6b7280;">Total</td><td style="text-align:right;"><strong>₹${totalAmount.toFixed(2)}</strong></td></tr>
      </table>
      <p>Show the QR code below at the entrance:</p>
      <img src="cid:qrcode" alt="QR Ticket" style="width:220px;height:220px;" />
      <p style="color:#9ca3af; font-size:12px; margin-top:24px;">This is an automated email from the Ticket Booking System.</p>
    </div>`;

  return sendMail({
    to,
    subject: `Your ticket for ${event.title} — ${bookingRef}`,
    html,
    attachments: [
      {
        filename: 'ticket-qr.png',
        content: qrDataUrl.split(',')[1],
        encoding: 'base64',
        cid: 'qrcode',
      },
    ],
  });
}

async function sendWaitlistOfferEmail({ to, name, event, category, offerExpiresAt, acceptUrl }) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2 style="color:#1f2937;">A seat opened up 🎉</h2>
      <p>Hi ${name},</p>
      <p>A <strong>${category}</strong> seat for <strong>${event.title}</strong> is now available for you from the waitlist.</p>
      <p>You have until <strong>${new Date(offerExpiresAt).toLocaleString()}</strong> to complete your booking, after which the seat will be offered to the next person in line.</p>
      <p style="margin: 24px 0;">
        <a href="${acceptUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Complete my booking</a>
      </p>
      <p style="color:#9ca3af; font-size:12px;">This is an automated email from the Ticket Booking System.</p>
    </div>`;

  return sendMail({ to, subject: `Seat available: ${event.title} (offer expires soon)`, html });
}

async function sendCancellationEmail({ to, name, event, bookingRef }) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2 style="color:#1f2937;">Booking Cancelled</h2>
      <p>Hi ${name},</p>
      <p>Your booking <strong>${bookingRef}</strong> for <strong>${event.title}</strong> has been cancelled.</p>
      <p style="color:#9ca3af; font-size:12px;">This is an automated email from the Ticket Booking System.</p>
    </div>`;
  return sendMail({ to, subject: `Booking cancelled — ${bookingRef}`, html });
}

module.exports = {
  sendBookingConfirmationEmail,
  sendWaitlistOfferEmail,
  sendCancellationEmail,
};
