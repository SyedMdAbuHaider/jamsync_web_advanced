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

// Auto-load tracks from /public/music
const getTracks = () => {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map(file => ({
        name: formatTrackName(file.replace('.mp3', '')),
        url: `/music/${file}`
      }));
  } catch (err) {
    console.error("Could not read music folder:", err);
    return [];
  }
};

// Format track names (e.g., "my-song" -> "My Song")
const formatTrackName = (filename) => {
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Current playback state
let currentState = {
  track: null,
  position: 0,
  isPlaying: false,
  lastUpdated: Date.now()
};

// Middleware
app.use(express.static(PUBLIC_DIR));

// Routes
app.get('/tracks', (req, res) => {
  res.json(getTracks());
});

// Socket.io synchronization
io.on('connection', (socket) => {
  // Send current state to new clients
  socket.emit('sync', currentState);

  // Handle playback events
  socket.on('play', (trackUrl) => {
    currentState = {
      track: trackUrl,
      position: 0,
      isPlaying: true,
      lastUpdated: Date.now()
    };
    io.emit('play', currentState); // Changed to io.emit for reliability
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

// Start server
server.listen(PORT, () => {
  const tracks = getTracks();
  console.log(`
  JamSync Server Running
  ----------------------
  Port: ${PORT}
  Tracks loaded: ${tracks.length}
  Test endpoints:
  - Tracks: http://localhost:${PORT}/tracks
  - Player: http://localhost:${PORT}
  `);
});
