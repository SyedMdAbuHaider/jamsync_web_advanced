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
  },
  pingTimeout: 30000,
  pingInterval: 15000
});

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MUSIC_DIR = path.join(PUBLIC_DIR, 'music');

// Enhanced state management
let roomState = {
  currentTrack: null,
  position: 0,
  isPlaying: false,
  lastUpdate: Date.now(),
  trackStartTime: Date.now(),
  queue: []
};

// Track loading with metadata
const getTracks = () => {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map(file => ({
        id: file,
        name: file.replace('.mp3', '').replace(/-/g, ' '),
        url: `/music/${encodeURIComponent(file)}`,
        duration: 0 // Will be updated by clients
      }));
  } catch (err) {
    console.error("Music loading error:", err);
    return [];
  }
};

app.use(express.static(PUBLIC_DIR));

app.get('/tracks', (req, res) => {
  res.json(getTracks());
});

// Calculate precise position
function getCurrentPosition() {
  if (!roomState.isPlaying) return roomState.position;
  const elapsed = (Date.now() - roomState.trackStartTime) / 1000;
  return Math.min(roomState.position + elapsed, roomState.currentTrack?.duration || Infinity);
}

// Sync all clients every second
setInterval(() => {
  io.emit('sync', {
    position: getCurrentPosition(),
    isPlaying: roomState.isPlaying,
    currentTrack: roomState.currentTrack,
    timestamp: Date.now()
  });
}, 1000);

io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Send full state on connect
  socket.emit('init', {
    tracks: getTracks(),
    currentState: {
      ...roomState,
      position: getCurrentPosition()
    },
    queue: roomState.queue
  });

  // Track duration reporting
  socket.on('duration', ({ trackId, duration }) => {
    const track = getTracks().find(t => t.id === trackId);
    if (track) track.duration = duration;
    if (roomState.currentTrack?.id === trackId) {
      roomState.currentTrack.duration = duration;
    }
  });

  // Playback control
  socket.on('play', ({ trackId }) => {
    const track = getTracks().find(t => t.id === trackId);
    if (!track) return;

    roomState = {
      ...roomState,
      currentTrack: track,
      position: 0,
      isPlaying: true,
      lastUpdate: Date.now(),
      trackStartTime: Date.now()
    };

    io.emit('play', {
      track,
      timestamp: Date.now()
    });
  });

  socket.on('pause', () => {
    roomState = {
      ...roomState,
      position: getCurrentPosition(),
      isPlaying: false,
      lastUpdate: Date.now()
    };
    io.emit('pause', {
      position: roomState.position,
      timestamp: Date.now()
    });
  });

  socket.on('seek', ({ position }) => {
    roomState = {
      ...roomState,
      position: Math.max(0, position),
      trackStartTime: Date.now(),
      lastUpdate: Date.now()
    };
    io.emit('seek', {
      position: roomState.position,
      timestamp: Date.now()
    });
  });

  socket.on('next', () => {
    if (roomState.queue.length > 0) {
      const nextTrack = roomState.queue.shift();
      socket.emit('play', {
        track: nextTrack,
        timestamp: Date.now()
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
