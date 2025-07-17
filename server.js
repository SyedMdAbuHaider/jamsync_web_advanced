const express = require("express");
const multer = require("multer");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Ensure music directory exists
const musicDir = path.join(__dirname, "music");
if (!fs.existsSync(musicDir)) {
  fs.mkdirSync(musicDir);
}

const upload = multer({ dest: "music/" });

app.use("/music", express.static(path.join(__dirname, "music")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/js", express.static(path.join(__dirname, "public/js")));
app.use("/socket.io", express.static(path.join(__dirname, "node_modules/socket.io/client-dist")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.post("/upload", upload.single("music"), (req, res) => {
  const ext = path.extname(req.file.originalname);
  const newPath = path.join("music", req.file.originalname);
  fs.renameSync(req.file.path, newPath);
  res.sendStatus(200);
});

app.get("/tracks", (req, res) => {
  const files = fs.readdirSync("./music");
  res.json(files);
});

io.on("connection", socket => {
  socket.on("play", track => {
    socket.broadcast.emit("play", track);
  });
});

// ✅ Use environment port for Render compatibility
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
