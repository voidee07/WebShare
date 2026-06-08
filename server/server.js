// server.js - Signalling server for WebRTC P2P file transfer
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'https://web-share-cyan.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Health check endpoint (keeps Render free tier from sleeping)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Serve static client files (when built)
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', (roomId) => {
    socket.join(roomId);
    // Store roomId on socket for later use
    socket.roomId = roomId;
    const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
    console.log(`[JOIN] ${socket.id} joined room ${roomId} (${clients.size} client(s))`);
    // Notify other peers in the room
    socket.to(roomId).emit('peer-joined', socket.id);
  });

  // CRITICAL: Relay signaling messages (SDP offers/answers, ICE candidates) between peers
  socket.on('signal', ({ roomId, data }) => {
    console.log(`[SIGNAL] from ${socket.id} to room ${roomId}`, data.sdp ? 'SDP' : 'ICE');
    socket.to(roomId).emit('signal', { from: socket.id, data });
  });

  socket.on('leave', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('peer-left', socket.id);
    console.log(`[LEAVE] ${socket.id} left room ${roomId}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] ${socket.id}: ${reason}`);
    socket.rooms.forEach((roomId) => {
      if (roomId !== socket.id) {
        socket.to(roomId).emit('peer-left', socket.id);
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signalling server listening on port ${PORT}`);
});
