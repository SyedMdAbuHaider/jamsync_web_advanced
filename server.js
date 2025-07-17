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

// Socket.io
io.on("connection", socket => {
  socket.on("play", track => {
    socket.broadcast.emit("play", track);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
