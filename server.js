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

// Enhanced state management
let globalState = {
  track: null,
  position: 0,
  isPlaying: false,
  timestamp: Date.now(),
  trackChangeTime: 0
};

// Track loading with error handling
const getTracks = () => {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map(file => ({
        name: file.replace('.mp3', '').replace(/-/g, ' '),
        url: `/music/${encodeURIComponent(file)}`,
        duration: 0 // Will be set client-side
      }));
  } catch (err) {
    console.error("Music folder error:", err);
    return [];
  }
};

app.use(express.static(PUBLIC_DIR));

app.get('/tracks', (req, res) => {
  res.json(getTracks());
});

// Precision sync logic
io.on('connection', (socket) => {
  // Send full state immediately
  socket.emit('full-sync', {
    ...globalState,
    calculatedPosition: calculateCurrentPosition(globalState)
  });

  // Playback control
  socket.on('play', (trackUrl) => {
    globalState = {
      track: trackUrl,
      position: 0,
      isPlaying: true,
      timestamp: Date.now(),
      trackChangeTime: Date.now()
    };
    io.emit('play', {
      ...globalState,
      calculatedPosition: 0
    });
  });

  socket.on('pause', () => {
    const currentPos = calculateCurrentPosition(globalState);
    globalState = {
      ...globalState,
      position: currentPos,
      isPlaying: false,
      timestamp: Date.now()
    };
    io.emit('pause', {
      position: currentPos,
      timestamp: Date.now()
    });
  });

  socket.on('seek', (position) => {
    globalState = {
      ...globalState,
      position,
      timestamp: Date.now()
    };
    io.emit('seek', {
      position,
      timestamp: Date.now()
    });
  });

  socket.on('track-duration', ({ url, duration }) => {
    const track = getTracks().find(t => t.url === url);
    if (track) track.duration = duration;
  });
});

function calculateCurrentPosition(state) {
  if (!state.isPlaying) return state.position;
  const elapsed = (Date.now() - state.timestamp) / 1000;
  return Math.min(state.position + elapsed, getTrackDuration(state.track));
}

function getTrackDuration(url) {
  const track = getTracks().find(t => t.url === url);
  return track?.duration || 0;
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
