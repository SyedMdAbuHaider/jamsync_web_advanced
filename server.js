const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MUSIC_DIR = path.join(PUBLIC_DIR, 'music');

// Global playback state
let currentState = {
  track: null,
  position: 0,
  isPlaying: false,
  lastUpdated: Date.now()
};

// Auto-load tracks
const getTracks = () => {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map(file => ({
        name: file.replace('.mp3', '').replace(/-/g, ' '),
        url: `/music/${encodeURIComponent(file)}`
      }));
  } catch (err) {
    console.error("Music folder error:", err);
    return [];
  }
};

// Middleware
app.use(express.static(PUBLIC_DIR));

// Routes
app.get('/tracks', (req, res) => {
  res.json(getTracks());
});

// Socket.io
io.on('connection', (socket) => {
  // Send current state to new clients
  socket.emit('sync', currentState);

  // Playback events
  socket.on('play', (trackUrl) => {
    currentState = {
      track: trackUrl,
      position: 0,
      isPlaying: true,
      lastUpdated: Date.now()
    };
    io.emit('play', currentState);
  });

  socket.on('pause', (position) => {
    currentState = {
      ...currentState,
      position,
      isPlaying: false,
      lastUpdated: Date.now()
    };
    io.emit('pause', currentState);
  });

  socket.on('seek', (position) => {
    currentState.position = position;
    currentState.lastUpdated = Date.now();
    io.emit('seek', position);
  });
});

server.listen(PORT, () => {
  console.log(`
  JamSync Server Running
  ----------------------
  Port: ${PORT}
  Tracks: ${getTracks().length} loaded
  URL: http://localhost:${PORT}
  `);
});
