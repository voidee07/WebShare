// server.js - Signalling server for WebRTC P2P file transfer
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static client files (when built)
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', (roomId) => {
    socket.join(roomId);
    const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
    console.log(`Room ${roomId} now has ${clients.size} client(s)`);
    socket.to(roomId).emit('peer-joined', socket.id);
  });

  socket.on('signal', ({ roomId, data }) => {
    socket.to(roomId).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', (reason) => {
    console.log(`Client ${socket.id} disconnected: ${reason}`);
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
