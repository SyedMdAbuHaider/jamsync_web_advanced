const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuration
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MUSIC_DIR = path.join(__dirname, 'music');

// Ensure directories exist
async function initializeDirectories() {
  try {
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    await fs.mkdir(MUSIC_DIR, { recursive: true });
    console.log(`Directories verified:
    - Public: ${PUBLIC_DIR}
    - Music: ${MUSIC_DIR}`);
  } catch (err) {
    console.error('Directory initialization failed:', err);
    process.exit(1);
  }
}

// Get music files with error handling
async function getMusicFiles() {
  try {
    const files = await fs.readdir(MUSIC_DIR);
    return files.filter(file => /\.(mp3|wav|ogg|m4a|flac)$/i.test(file));
  } catch (err) {
    console.error('Error reading music directory:', err);
    return [];
  }
}

// Middleware
app.use(express.static(PUBLIC_DIR));
app.use('/music', express.static(MUSIC_DIR));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/tracks', async (req, res) => {
  const tracks = await getMusicFiles();
  
  if (tracks.length === 0) {
    console.warn('No music files found. Please add files to:', MUSIC_DIR);
    // Create a dummy file for testing if none exist
    const testFilePath = path.join(MUSIC_DIR, 'test.mp3');
    try {
      await fs.writeFile(testFilePath, '');
      console.log('Created test.mp3 for debugging');
      tracks.push('test.mp3');
    } catch (err) {
      console.error('Could not create test file:', err);
    }
  }
  
  res.json(tracks);
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Startup
async function startServer() {
  await initializeDirectories();
  
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log(`- Main app: http://localhost:${PORT}`);
    console.log(`- Tracks API: http://localhost:${PORT}/tracks`);
    console.log(`- Music files: http://localhost:${PORT}/music/[filename]`);
  });
}

startServer().catch(err => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
