const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

// Initialize app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuration
const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DRIVE_FOLDER_ID = '1SfzWcO3mDSoQYHwSRVBdyt57T3YaroSc';

// Track state
let playbackState = {
  currentTrack: null,
  position: 0,
  isPlaying: false,
  lastUpdated: Date.now()
};

let cachedTracks = [];

// Middleware
app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// Load tracks from Google Drive
async function refreshTracks() {
  try {
    const response = await axios.get(
      `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );

    const regex = /\["([^"]+\.(mp3|wav|ogg|m4a))","([^"]+)",\d+,\d+/g;
    const matches = [...response.data.matchAll(regex)];
    
    cachedTracks = matches.map(match => ({
      name: match[1].replace(/\.[^/.]+$/, ''),
      id: match[3],
      url: `https://drive.google.com/uc?export=download&id=${match[3]}`
    }));

    console.log(`Loaded ${cachedTracks.length} tracks from Drive`);
  } catch (err) {
    console.error('Drive refresh failed:', err.message);
    cachedTracks = [{
      name: "Demo Track (Add files to Drive)",
      url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
    }];
  }
}

// Routes
app.get('/tracks', (req, res) => {
  res.json(cachedTracks);
});

// Socket.io synchronization
io.on('connection', (socket) => {
  // Send current state to new clients
  socket.emit('sync', playbackState);

  // Handle playback events
  socket.on('play', (trackUrl) => {
    playbackState = {
      currentTrack: trackUrl,
      position: 0,
      isPlaying: true,
      lastUpdated: Date.now()
    };
    socket.broadcast.emit('play', playbackState);
  });

  socket.on('pause', (position) => {
    playbackState = {
      ...playbackState,
      position,
      isPlaying: false,
      lastUpdated: Date.now()
    };
    socket.broadcast.emit('pause', playbackState);
  });

  socket.on('seek', (position) => {
    playbackState.position = position;
    playbackState.lastUpdated = Date.now();
    socket.broadcast.emit('seek', position);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Initialize and start server
async function startServer() {
  // First load of tracks
  await refreshTracks();
  
  // Auto-refresh every 6 hours
  setInterval(refreshTracks, 6 * 60 * 60 * 1000);

  // Start server
  server.listen(PORT, () => {
    console.log(`
    JamSync Server Running
    ----------------------
    Port: ${PORT}
    Tracks loaded: ${cachedTracks.length}
    Drive folder: https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}
    `);
  });
}

startServer().catch(err => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
