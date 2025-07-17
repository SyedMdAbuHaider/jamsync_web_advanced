const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs").promises; // Using promises for better performance

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with leaner settings
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET"]
  },
  transports: ['websocket'], // Force WebSocket only for better performance
  pingInterval: 10000,       // Reduce ping frequency
  pingTimeout: 5000          // Faster timeout detection
});

// Cache music files list
let cachedTracks = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 30000; // 30 seconds cache

// Set up directories using absolute paths
const publicDir = path.resolve(__dirname, "public");
const musicDir = path.resolve(__dirname, "music");

// Pre-create directories on startup
(async () => {
  try {
    await fs.mkdir(publicDir, { recursive: true });
    await fs.mkdir(musicDir, { recursive: true });
    console.log(`Directories ready. Music directory: ${musicDir}`);
    
    // Initial cache load
    cachedTracks = await getMusicFiles();
    lastCacheUpdate = Date.now();
  } catch (err) {
    console.error("Startup error:", err);
  }
})();

// Optimized middleware
app.use(express.static(publicDir, {
  maxAge: '1d',          // Cache static files for 1 day
  immutable: true        // Tell browsers files won't change
}));

app.use("/music", express.static(musicDir, {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.mp3') || path.endsWith('.wav')) {
      res.set('Accept-Ranges', 'bytes'); // Enable streaming
    }
  }
}));

// Helper function to get music files with caching
async function getMusicFiles() {
  const now = Date.now();
  if (now - lastCacheUpdate < CACHE_TTL) {
    return cachedTracks;
  }

  try {
    const files = await fs.readdir(musicDir);
    const audioFiles = files.filter(file => 
      /\.(mp3|wav|ogg|m4a|flac)$/i.test(file)
    );
    cachedTracks = audioFiles;
    lastCacheUpdate = now;
    return audioFiles;
  } catch (err) {
    console.error("Error reading music directory:", err);
    return [];
  }
}

// Optimized routes
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/tracks", async (req, res) => {
  try {
    const tracks = await getMusicFiles();
    res.json(tracks);
  } catch (err) {
    console.error("Tracks endpoint error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Lightweight Socket.IO handling
io.on("connection", (socket) => {
  socket.emit("ready", { status: "connected" });

  socket.on("disconnect", () => {
    socket.removeAllListeners();
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).send("Server error");
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Music directory: ${musicDir}`);
});
