const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);

// Environment variable validation BEFORE Firebase initialization
const requiredEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_DATABASE_URL'
];

requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    throw new Error("Missing Firebase environment variables");
  }
});

// Initialize Firebase Admin SDK
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  databaseURL: process.env.FIREBASE_DATABASE_URL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();
function getRoomRef(roomCode) {
    return db.ref(`rooms/${roomCode}`);
}

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  
  if (!token) {
    return next(new Error('Authentication token missing'));
  }
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    socket.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    next(new Error('Invalid authentication token'));
  }
});

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MUSIC_DIR = path.join(PUBLIC_DIR, 'music');
const PLAYLIST_FILE = path.join(__dirname, 'playlists.json');

// Initialize playlists file if it doesn't exist
if (!fs.existsSync(PLAYLIST_FILE)) {
  fs.writeFileSync(PLAYLIST_FILE, JSON.stringify({
    'default': [],
    'favorites': []
  }));
}

// Load playlists
const loadPlaylists = () => {
  try {
    return JSON.parse(fs.readFileSync(PLAYLIST_FILE));
  } catch (err) {
    console.error("Error loading playlists:", err);
    return { 'default': [], 'favorites': [] };
  }
};

// Save playlists
const savePlaylists = (playlists) => {
  fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(playlists, null, 2));
};

let playlists = loadPlaylists();

// Multi-room architecture
// socketRoomMap: socket.id -> roomCode
const socketRoomMap = {};

// Generate a unique room code
function generateRoomCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Load tracks with proper error handling
const getTracks = () => {
  try {
    const files = fs.readdirSync(MUSIC_DIR)
      .filter(file => file.endsWith('.mp3'))
      .map((file, index) => ({
        id: index.toString(),
        name: file.replace('.mp3', '').replace(/_/g, ' '),
        url: `/music/${encodeURIComponent(file)}`,
        duration: 0
      }));
    return files;
  } catch (err) {
    console.error("Failed to load tracks:", err);
    return [];
  }
};

const tracks = getTracks();

// Play next track in queue for a specific room
async function playNextTrack(roomCode) {
  const snapshot = await getRoomRef(roomCode).once('value');
  const room = snapshot.val();
  if (!room) return;
  
  let newQueue;
  if (room.queue.length === 0) {
    newQueue = [...tracks];
  } else {
    newQueue = room.queue;
  }
  
  const currentTrack = newQueue.shift();
  
  await getRoomRef(roomCode).update({
    currentTrack: currentTrack,
    position: 0,
    isPlaying: true,
    lastUpdate: Date.now(),
    queue: newQueue
  });
  
  io.to(roomCode).emit('track-changed', {
    track: currentTrack,
    position: 0,
    isPlaying: true,
    timestamp: Date.now()
  });
}

// Clean up empty rooms
async function cleanupEmptyRoom(roomCode) {
  // Check if room exists in Socket.IO adapter and has no clients
  const clients = io.sockets.adapter.rooms.get(roomCode);
  if (!clients || clients.size === 0) {
    await getRoomRef(roomCode).remove();
    console.log(`Room ${roomCode} deleted - no clients remaining`);
  }
}

const roomListeners = {};

app.use(express.static(PUBLIC_DIR));

app.get('/tracks', (req, res) => {
  res.json(tracks);
});

app.get('/playlists', (req, res) => {
  res.json(playlists);
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} (User: ${socket.user?.uid || 'unknown'})`);

  // ===== ROOM MANAGEMENT =====
  
  // Create a new room
  socket.on('create-room', async () => {
    // IMPROVED: Leave any existing room first to prevent ghost membership
    const oldRoom = socketRoomMap[socket.id];
    if (oldRoom) {
      socket.leave(oldRoom);
      cleanupEmptyRoom(oldRoom);
    }
    
    let roomCode;
    // Generate unique room code
    do {
      roomCode = generateRoomCode();
      const snapshot = await getRoomRef(roomCode).once('value');
      if (!snapshot.exists()) {
        break;
      }
    } while (true);
    
    // Initialize room state in Firebase with user uid as host
    await getRoomRef(roomCode).set({
      host: socket.user.uid,
      currentTrack: null,
      position: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      queue: [...tracks] // Start with all tracks in queue
    });
    
    // Join socket to room
    socket.join(roomCode);
    socketRoomMap[socket.id] = roomCode;
    
    // Notify creator
    socket.emit('room-created', { roomCode });
    
    // Send initial state to the room creator
    const snapshot = await getRoomRef(roomCode).once('value');
    const roomData = snapshot.val();
    socket.emit('init', {
      tracks,
      playlists,
      currentState: {
        currentTrack: roomData.currentTrack,
        position: roomData.position,
        isPlaying: roomData.isPlaying,
        lastUpdate: roomData.lastUpdate,
        queue: roomData.queue,
        currentTrackIndex: 0 // Kept for compatibility
      }
    });
    
    console.log(`Room created: ${roomCode} by user ${socket.user.uid}`);
  });
  
  // Join an existing room
  socket.on('join-room', async ({ roomCode }) => {
    // Validate room exists in Firebase
    const snapshot = await getRoomRef(roomCode).once('value');
    if (!snapshot.exists()) {
      // IMPROVED: Changed from 'error' to 'room-error' to avoid reserved event name
      socket.emit('room-error', { message: 'Room not found' });
      return;
    }
    
    // IMPROVED: Leave any existing room first to prevent ghost membership
    const oldRoom = socketRoomMap[socket.id];
    if (oldRoom) {
      socket.leave(oldRoom);
      cleanupEmptyRoom(oldRoom);
    }
    
    // Join socket to room
    socket.join(roomCode);
    socketRoomMap[socket.id] = roomCode;
    
    // Send initial state to this user only
    const roomData = snapshot.val();
    socket.emit('init', {
      tracks,
      playlists,
      currentState: {
        currentTrack: roomData.currentTrack,
        position: roomData.position,
        isPlaying: roomData.isPlaying,
        lastUpdate: roomData.lastUpdate,
        queue: roomData.queue,
        currentTrackIndex: 0 // Kept for compatibility
      }
    });
    
    console.log(`Socket ${socket.id} (User: ${socket.user.uid}) joined room: ${roomCode}`);
    
    // Set up real-time sync for this room
    const roomRef = getRoomRef(roomCode);
    const listener = roomRef.on('value', (snapshot) => {
      const room = snapshot.val();
      if (!room) return;

      const elapsed = room.isPlaying
        ? (Date.now() - room.lastUpdate) / 1000
        : 0;

      const currentPosition = room.position + elapsed;

      io.to(roomCode).emit('sync', {
        position: currentPosition,
        isPlaying: room.isPlaying,
        currentTrack: room.currentTrack,
        timestamp: Date.now()
      });
    });
    
    roomListeners[socket.id] = { roomCode, listener };
  });

  // ===== EXISTING EVENTS (Now room-scoped with host protection using uid) =====
  
  // Track duration reporting (NO host protection - anyone can report duration)
  socket.on('duration', ({ trackId, duration }) => {
    const track = tracks.find(t => t.id === trackId);
    if (track) track.duration = duration;
  });

  // Playback control (WITH host protection)
  socket.on('play', async ({ trackId }) => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    const snapshot = await getRoomRef(roomCode).once('value');
    const roomData = snapshot.val();
    if (!roomData) return;
    
    // IMPROVED: Host-only protection using uid
    if (roomData.host !== socket.user.uid) return;
    
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    await getRoomRef(roomCode).update({
      currentTrack: track,
      position: 0,
      isPlaying: true,
      lastUpdate: Date.now()
    });

    io.to(roomCode).emit('track-changed', {
      track,
      position: 0,
      isPlaying: true,
      timestamp: Date.now()
    });
  });

  socket.on('pause', async () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    const snapshot = await getRoomRef(roomCode).once('value');
    const roomData = snapshot.val();
    if (!roomData) return;
    
    // IMPROVED: Host-only protection using uid
    if (roomData.host !== socket.user.uid) return;
    
    await getRoomRef(roomCode).update({
      position: roomData.position,
      isPlaying: false,
      lastUpdate: Date.now()
    });
    
    io.to(roomCode).emit('pause', {
      position: roomData.position,
      timestamp: Date.now()
    });
  });

  socket.on('seek', async ({ position }) => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    const snapshot = await getRoomRef(roomCode).once('value');
    const roomData = snapshot.val();
    if (!roomData) return;
    
    // IMPROVED: Host-only protection using uid
    if (roomData.host !== socket.user.uid) return;
    
    await getRoomRef(roomCode).update({
      position: Math.max(0, position),
      lastUpdate: Date.now()
    });
    
    io.to(roomCode).emit('seek', {
      position: Math.max(0, position),
      timestamp: Date.now()
    });
  });

  // Navigation controls (WITH host protection)
  socket.on('next', async () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    const snapshot = await getRoomRef(roomCode).once('value');
    const roomData = snapshot.val();
    if (!roomData) return;
    
    // IMPROVED: Host-only protection using uid
    if (roomData.host !== socket.user.uid) return;
    
    await playNextTrack(roomCode);
  });

  socket.on('previous', async () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    const snapshot = await getRoomRef(roomCode).once('value');
    const roomData = snapshot.val();
    if (!roomData) return;
    
    // IMPROVED: Host-only protection using uid
    if (roomData.host !== socket.user.uid) return;
    
    const prevIndex = (tracks.findIndex(t => t.id === roomData.currentTrack?.id) - 1 + tracks.length) % tracks.length;
    const track = tracks[prevIndex];
    
    await getRoomRef(roomCode).update({
      currentTrack: track,
      position: 0,
      isPlaying: true,
      lastUpdate: Date.now()
    });
    
    io.to(roomCode).emit('track-changed', {
      track,
      position: 0,
      isPlaying: true,
      timestamp: Date.now()
    });
  });

  // Track ended (WITH host protection)
  socket.on('track-ended', async () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    const snapshot = await getRoomRef(roomCode).once('value');
    const roomData = snapshot.val();
    if (!roomData) return;
    
    // IMPROVED: Host-only protection using uid
    if (roomData.host !== socket.user.uid) return;
    
    await playNextTrack(roomCode);
  });

  // Playlist management (still global, but room-scoped broadcast) - NO host protection
  socket.on('add-to-playlist', ({ playlistName, trackId }) => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    if (!playlists[playlistName]) {
      playlists[playlistName] = [];
    }
    
    if (!playlists[playlistName].some(t => t.id === trackId)) {
      playlists[playlistName].push(track);
      savePlaylists(playlists);
      
      // Broadcast playlist update to everyone in the room
      io.to(roomCode).emit('playlist-updated', { playlistName, playlists });
    }
  });

  // ===== CLEANUP ON DISCONNECT =====
  socket.on('disconnect', () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    
    // Remove socket from mapping
    delete socketRoomMap[socket.id];
    
    const listenerEntry = roomListeners[socket.id];
    if (listenerEntry) {
        getRoomRef(listenerEntry.roomCode).off('value', listenerEntry.listener);
        delete roomListeners[socket.id];
    }
    
    console.log(`Socket ${socket.id} (User: ${socket.user?.uid || 'unknown'}) disconnected from room ${roomCode}`);
    
    // Check if room is now empty and clean up
    cleanupEmptyRoom(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
