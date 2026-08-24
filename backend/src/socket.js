const { Server } = require('socket.io');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    // Client joins a room per event to receive only relevant seat updates.
    socket.on('event:join', (eventId) => {
      socket.join(`event:${eventId}`);
    });
    socket.on('event:leave', (eventId) => {
      socket.leave(`event:${eventId}`);
    });
  });

  return io;
}

// Broadcast one or more seat status changes to everyone viewing that event's seat map.
function emitSeatUpdate(eventId, seats) {
  if (!io) return;
  io.to(`event:${eventId}`).emit('seat:update', { eventId, seats });
}

// Notify a specific event room that a waitlist offer state changed (for UI banners).
function emitWaitlistUpdate(eventId, payload) {
  if (!io) return;
  io.to(`event:${eventId}`).emit('waitlist:update', { eventId, ...payload });
}

module.exports = { initSocket, emitSeatUpdate, emitWaitlistUpdate };
