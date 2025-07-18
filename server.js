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
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MUSIC_DIR = path.join(PUBLIC_DIR, 'music');

// Enhanced state with timing control
let state = {
  currentTrack: null,
  position: 0,
  isPlaying: false,
  lastUpdate: Date.now(),
  playbackRate: 1.0
};

// Track loading with caching
let trackCache = null;
const getTracks = () => {
  if (trackCache) return trackCache;
  
  try {
    trackCache = fs.readdirSync(MUSIC_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map(file => ({
        id: file,
        name: file.replace('.mp3', '').replace(/-/g, ' '),
        url: `/music/${encodeURIComponent(file)}`
      }));
    return trackCache;
  } catch (err) {
    console.error("Music loading error:", err);
    return [];
  }
};

app.use(express.static(PUBLIC_DIR));

app.get('/tracks', (req, res) => {
  res.json(getTracks());
});

// Synchronization heartbeat
setInterval(() => {
  io.emit('heartbeat', {
    timestamp: Date.now(),
    position: calculateCurrentPosition(),
    isPlaying: state.isPlaying
  });
}, 1000);

function calculateCurrentPosition() {
  if (!state.isPlaying) return state.position;
  const elapsed = (Date.now() - state.lastUpdate) / 1000;
  return Math.max(0, state.position + (elapsed * state.playbackRate));
}

io.on('connection', (socket) => {
  // Send full state immediately
  socket.emit('init', {
    tracks: getTracks(),
    currentState: {
      ...state,
      position: calculateCurrentPosition()
    }
  });

  // Playback control with timing synchronization
  socket.on('play', ({ trackId, atPosition }) => {
    const track = getTracks().find(t => t.id === trackId);
    if (!track) return;

    state = {
      currentTrack: trackId,
      position: atPosition || 0,
      isPlaying: true,
      lastUpdate: Date.now(),
      playbackRate: 1.0
    };

    io.emit('play', {
      track,
      position: atPosition || 0,
      timestamp: Date.now()
    });
  });

  socket.on('pause', ({ atPosition }) => {
    state = {
      ...state,
      position: atPosition,
      isPlaying: false,
      lastUpdate: Date.now()
    };
    io.emit('pause', {
      position: atPosition,
      timestamp: Date.now()
    });
  });

  socket.on('seek', ({ toPosition }) => {
    state = {
      ...state,
      position: toPosition,
      lastUpdate: Date.now()
    };
    io.emit('seek', {
      position: toPosition,
      timestamp: Date.now()
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
