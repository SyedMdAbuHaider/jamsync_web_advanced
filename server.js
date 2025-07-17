const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

const musicDir = path.join(__dirname, "music");
if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, musicDir),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

app.post("/upload", upload.single("music"), (req, res) => {
  res.send("Uploaded");
});

app.get("/music", (req, res) => {
  fs.readdir(musicDir, (err, files) => {
    if (err) return res.status(500).send("Error reading music folder");
    const mp3s = files.filter(f => f.endsWith(".mp3"));
    res.json(mp3s);
  });
});

app.use("/music", express.static(musicDir));

app.listen(PORT, () => console.log(`JamSync running on port ${PORT}`));

