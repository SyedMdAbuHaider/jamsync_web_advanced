const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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

// Your actual Google Drive tracks
const driveTracks = [
  {
    name: "Track 1",
    url: "https://drive.google.com/uc?export=download&id=1E66VxIpHX5kN2xX6pOENa7mkbuLDyFKX"
  },
  {
    name: "Track 2",
    url: "https://drive.google.com/uc?export=download&id=1aoN0gO-wgzCYqPRIHO766LqbCgscPhpa"
  },
  {
    name: "Track 3",
    url: "https://drive.google.com/uc?export=download&id=18vJfQyNK-mAWOs4ENQGI0OPdRivC6BnW"
  }
];

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
  res.json(driveTracks);
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
    socket.broadcast.emit('play', currentState);
  });

  socket.on('pause', (position) => {
    currentState = {
      ...currentState,
      position,
      isPlaying: false,
      lastUpdated: Date.now()
    };
    socket.broadcast.emit('pause', currentState);
  });

  socket.on('seek', (position) => {
    currentState.position = position;
    currentState.lastUpdated = Date.now();
    socket.broadcast.emit('seek', position);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`
  JamSync Server Running
  ----------------------
  Port: ${PORT}
  Tracks loaded: ${driveTracks.length}
  Test endpoints:
  - Tracks: http://localhost:${PORT}/tracks
  - Player: http://localhost:${PORT}
  `);
});
