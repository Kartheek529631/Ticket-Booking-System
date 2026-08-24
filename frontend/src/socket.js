import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

// Single shared socket for the whole app; components join/leave event rooms.
const socket = io(SOCKET_URL, { autoConnect: true });

export default socket;
