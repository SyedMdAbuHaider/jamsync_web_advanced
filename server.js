const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Set up directories
const publicDir = path.join(__dirname, "public");
const musicDir = path.join(__dirname, "music");

// Create directories if they don't exist
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir);

// Middleware
app.use(express.static(publicDir));
app.use("/music", express.static(musicDir));

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/tracks", (req, res) => {
  fs.readdir(musicDir, (err, files) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error reading music directory");
    }
    res.json(files.filter(file => file.match(/\.(mp3|wav|ogg|m4a)$/i)));
  });
});

// Track current playback state
let currentState = {
  track: null,
  currentTime: 0,
  isPlaying: false,
  lastUpdated: Date.now()
};

// Socket.io
io.on("connection", socket => {
  console.log(`New client connected: ${socket.id}`);

  // Send current state to newly connected client
  socket.emit('sync', currentState);

  // Handle play/pause/sync events
  socket.on('play', (track) => {
    currentState = {
      track,
      currentTime: 0,
      isPlaying: true,
      lastUpdated: Date.now()
    };
    socket.broadcast.emit('play', currentState);
  });

  socket.on('pause', (time) => {
    currentState = {
      ...currentState,
      currentTime: time,
      isPlaying: false,
      lastUpdated: Date.now()
    };
    socket.broadcast.emit('pause', currentState);
  });

  socket.on('sync', (state) => {
    // Only update if this is newer information
    if (state.lastUpdated > currentState.lastUpdated) {
      currentState = state;
      socket.broadcast.emit('sync', currentState);
    }
  });

  socket.on('seek', (time) => {
    currentState = {
      ...currentState,
      currentTime: time,
      lastUpdated: Date.now()
    };
    socket.broadcast.emit('seek', currentState);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Periodically update all clients with current state
setInterval(() => {
  if (currentState.track) {
    io.emit('sync', currentState);
  }
}, 3000); // Sync every 3 seconds

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
