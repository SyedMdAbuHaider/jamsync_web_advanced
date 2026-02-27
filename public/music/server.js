const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

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
// rooms: roomCode -> room state
// socketRoomMap: socket.id -> roomCode
const rooms = {};
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
function playNextTrack(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  
  if (room.queue.length === 0) {
    room.queue = [...tracks]; // Replenish queue
  }
  
  room.currentTrack = room.queue.shift();
  room.position = 0;
  room.isPlaying = true;
  room.lastUpdate = Date.now();
  
  io.to(roomCode).emit('track-changed', {
    track: room.currentTrack,
    position: 0,
    isPlaying: true,
    timestamp: Date.now()
  });
}

// Calculate current position for a specific room
function getCurrentPosition(room) {
  if (!room.isPlaying) return room.position;
  const elapsed = (Date.now() - room.lastUpdate) / 1000;
  return Math.min(room.position + elapsed, room.currentTrack?.duration || Infinity);
}

// Clean up empty rooms
function cleanupEmptyRoom(roomCode) {
  // Check if room exists in Socket.IO adapter and has no clients
  const clients = io.sockets.adapter.rooms.get(roomCode);
  if (!clients || clients.size === 0) {
    delete rooms[roomCode];
    console.log(`Room ${roomCode} deleted - no clients remaining`);
    console.log(`Active rooms: ${Object.keys(rooms).length}`); // IMPROVED: Added room count logging
  }
}

// Sync all rooms every second
setInterval(() => {
  // Loop through all active rooms
  Object.keys(rooms).forEach(roomCode => {
    const room = rooms[roomCode];
    if (!room) return;
    
    io.to(roomCode).emit('sync', {
      position: getCurrentPosition(room),
      isPlaying: room.isPlaying,
      currentTrack: room.currentTrack,
      timestamp: Date.now()
    });
  });
}, 1000);

app.use(express.static(PUBLIC_DIR));

app.get('/tracks', (req, res) => {
  res.json(tracks);
});

app.get('/playlists', (req, res) => {
  res.json(playlists);
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // ===== ROOM MANAGEMENT =====
  
  // Create a new room
  socket.on('create-room', () => {
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
    } while (rooms[roomCode]);
    
    // Initialize room state
    rooms[roomCode] = {
      currentTrack: null,
      position: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      queue: [...tracks], // Start with all tracks in queue
      host: socket.id
    };
    
    // Join socket to room
    socket.join(roomCode);
    socketRoomMap[socket.id] = roomCode;
    
    // Notify creator
    socket.emit('room-created', { roomCode });
    console.log(`Room created: ${roomCode} by ${socket.id}`);
  });
  
  // Join an existing room
  socket.on('join-room', ({ roomCode }) => {
    // Validate room exists
    if (!rooms[roomCode]) {
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
    socket.emit('init', {
      tracks,
      playlists,
      currentState: {
        currentTrack: rooms[roomCode].currentTrack,
        position: getCurrentPosition(rooms[roomCode]),
        isPlaying: rooms[roomCode].isPlaying,
        lastUpdate: rooms[roomCode].lastUpdate,
        queue: rooms[roomCode].queue,
        currentTrackIndex: 0 // Kept for compatibility
      }
    });
    
    console.log(`Socket ${socket.id} joined room: ${roomCode}`);
  });

  // ===== EXISTING EVENTS (Now room-scoped with host protection) =====
  
  // Track duration reporting (NO host protection - anyone can report duration)
  socket.on('duration', ({ trackId, duration }) => {
    const track = tracks.find(t => t.id === trackId);
    if (track) track.duration = duration;
  });

  // Playback control (WITH host protection)
  socket.on('play', ({ trackId }) => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode || !rooms[roomCode]) return;
    
    // IMPROVED: Host-only protection
    if (rooms[roomCode].host !== socket.id) return;
    
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    rooms[roomCode] = {
      ...rooms[roomCode],
      currentTrack: track,
      position: 0,
      isPlaying: true,
      lastUpdate: Date.now()
    };

    io.to(roomCode).emit('track-changed', {
      track,
      position: 0,
      isPlaying: true,
      timestamp: Date.now()
    });
  });

  socket.on('pause', () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode || !rooms[roomCode]) return;
    
    // IMPROVED: Host-only protection
    if (rooms[roomCode].host !== socket.id) return;
    
    rooms[roomCode] = {
      ...rooms[roomCode],
      position: getCurrentPosition(rooms[roomCode]),
      isPlaying: false,
      lastUpdate: Date.now()
    };
    
    io.to(roomCode).emit('pause', {
      position: rooms[roomCode].position,
      timestamp: Date.now()
    });
  });

  socket.on('seek', ({ position }) => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode || !rooms[roomCode]) return;
    
    // IMPROVED: Host-only protection
    if (rooms[roomCode].host !== socket.id) return;
    
    rooms[roomCode] = {
      ...rooms[roomCode],
      position: Math.max(0, position),
      lastUpdate: Date.now()
    };
    
    io.to(roomCode).emit('seek', {
      position: rooms[roomCode].position,
      timestamp: Date.now()
    });
  });

  // Navigation controls (WITH host protection)
  socket.on('next', () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode || !rooms[roomCode]) return;
    
    // IMPROVED: Host-only protection
    if (rooms[roomCode].host !== socket.id) return;
    
    playNextTrack(roomCode);
  });

  socket.on('previous', () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode || !rooms[roomCode]) return;
    
    // IMPROVED: Host-only protection
    if (rooms[roomCode].host !== socket.id) return;
    
    const prevIndex = (tracks.findIndex(t => t.id === rooms[roomCode].currentTrack?.id) - 1 + tracks.length) % tracks.length;
    const track = tracks[prevIndex];
    
    rooms[roomCode] = {
      ...rooms[roomCode],
      currentTrack: track,
      position: 0,
      isPlaying: true,
      lastUpdate: Date.now()
    };
    
    io.to(roomCode).emit('track-changed', {
      track,
      position: 0,
      isPlaying: true,
      timestamp: Date.now()
    });
  });

  // Track ended (WITH host protection)
  socket.on('track-ended', () => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode || !rooms[roomCode]) return;
    
    // IMPROVED: Host-only protection
    if (rooms[roomCode].host !== socket.id) return;
    
    playNextTrack(roomCode);
  });

  // Playlist management (still global, but room-scoped broadcast) - NO host protection
  socket.on('add-to-playlist', ({ playlistName, trackId }) => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode || !rooms[roomCode]) return;
    
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
    
    console.log(`Socket ${socket.id} disconnected from room ${roomCode}`);
    
    // Check if room is now empty and clean up
    cleanupEmptyRoom(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
