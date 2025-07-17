const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET"]
  }
});

const DRIVE_FOLDER_ID = '1SfzWcO3mDSoQYHwSRVBdyt57T3YaroSc';
let cachedTracks = [];

// Scrape Drive folder for audio files
async function refreshTracks() {
  try {
    const { data } = await axios.get(
      `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`
    );
    
    const regex = /\["([^"]+\.(mp3|wav|ogg|m4a))","([^"]+)",\d+,\d+/g;
    const matches = [...data.matchAll(regex)];
    
    cachedTracks = matches.map(match => ({
      name: match[1].replace(/\.[^/.]+$/, ''),
      id: match[3],
      url: `https://drive.google.com/uc?export=view&id=${match[3]}`
    }));
    
    console.log('Refreshed tracks:', cachedTracks.length);
  } catch (err) {
    console.error('Drive refresh failed:', err.message);
  }
}

// Auto-refresh every 6 hours
setInterval(refreshTracks, 6 * 60 * 60 * 1000);
refreshTracks(); // Initial load

// API Endpoint
app.get('/tracks', (req, res) => {
  res.json(cachedTracks.length > 0 ? cachedTracks : [
    { name: "Demo Track", url: "https://example.com/fallback.mp3" }
  ]);
});

// Sync State
let playbackState = {
  currentTrack: null,
  position: 0,
  isPlaying: false,
  lastUpdated: Date.now()
};

// Socket.io Sync
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
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server ready at http://localhost:${PORT}`);
});
