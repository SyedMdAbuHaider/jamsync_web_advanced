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
    methods: ["GET"]
  }
});

// Configuration
const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MUSIC_DIR = path.join(__dirname, 'music');

// Verify music files exist
async function verifyMusicFiles() {
  try {
    const files = await fs.readdir(MUSIC_DIR);
    const audioFiles = files.filter(file => 
      /\.(mp3|wav|ogg|m4a|flac)$/i.test(file)
    );
    
    console.log('Found music files:', audioFiles);
    
    if (audioFiles.length === 0) {
      console.warn('No music files found in /music directory');
      console.warn('Please ensure:');
      console.warn('1. Your music files are committed to GitHub');
      console.warn('2. Files are in the /music folder');
      console.warn('3. File extensions are .mp3, .wav, .ogg, .m4a, or .flac');
      
      // Create a test file for debugging
      const testFile = path.join(MUSIC_DIR, 'test.mp3');
      await fs.writeFile(testFile, '');
      console.log('Created test.mp3 for debugging');
      return ['test.mp3'];
    }
    
    return audioFiles;
  } catch (err) {
    console.error('Error verifying music files:', err);
    return [];
  }
}

// Initialize server
async function initializeServer() {
  try {
    // Middleware
    app.use(express.static(PUBLIC_DIR));
    app.use('/music', express.static(MUSIC_DIR, {
      setHeaders: (res, path) => {
        res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      }
    }));

    // Routes
    app.get('/', (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });

    app.get('/tracks', async (req, res) => {
      const tracks = await verifyMusicFiles();
      res.json(tracks);
    });

    // Socket.io
    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
      
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });

    // Start server
    server.listen(PORT, () => {
      console.log(`
      ====================================
      JamSync Server Running
      Port: ${PORT}
      Music Directory: ${MUSIC_DIR}
      Public Directory: ${PUBLIC_DIR}
      
      Important Notes for GitHub Deployment:
      1. Music files must be committed to GitHub
      2. Files must be in /music directory
      3. Supported formats: .mp3, .wav, .ogg, .m4a, .flac
      
      Test your endpoints:
      - Tracks list: http://localhost:${PORT}/tracks
      - Music files: http://localhost:${PORT}/music/[filename]
      ====================================
      `);
    });

  } catch (err) {
    console.error('Server initialization failed:', err);
    process.exit(1);
  }
}

// Start the server
initializeServer();
