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

// Set up directories - IMPORTANT: Use absolute paths
const publicDir = path.join(__dirname, "public");
const musicDir = path.join(__dirname, "music");

// Create directories if they don't exist
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
if (!fs.existsSync(musicDir)) {
  fs.mkdirSync(musicDir, { recursive: true });
  console.log(`Created music directory at: ${musicDir}`);
}

// Middleware
app.use(express.static(publicDir));
app.use("/music", express.static(musicDir));

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/tracks", async (req, res) => {
  try {
    const files = await fs.promises.readdir(musicDir);
    const audioFiles = files.filter(file => 
      file.match(/\.(mp3|wav|ogg|m4a|flac)$/i)
    );
    
    if (audioFiles.length === 0) {
      console.warn(`No music files found in ${musicDir}`);
      console.warn(`Current directory: ${__dirname}`);
    }
    
    res.json(audioFiles);
  } catch (err) {
    console.error("Error reading music directory:", err);
    res.status(500).json({ error: "Error reading music directory" });
  }
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

  socket.on('play', (track) => {
    currentState = {
      track,
      currentTime: 0,
      isPlaying: true,
      lastUpdated: Date.now()
    };
    socket.broadcast.emit('play', currentState);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Serving music from: ${musicDir}`);
  console.log(`Public files from: ${publicDir}`);
});
