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

// Enhanced state with queue management
let roomState = {
  currentTrack: null,
  position: 0,
  isPlaying: false,
  lastUpdate: Date.now(),
  queue: [],
  currentTrackIndex: 0
};

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
roomState.queue = [...tracks]; // Initialize queue with all tracks

app.use(express.static(PUBLIC_DIR));

app.get('/tracks', (req, res) => {
  res.json(tracks);
});

app.get('/playlists', (req, res) => {
  res.json(playlists);
});

// Play next track in queue
function playNextTrack() {
  if (roomState.queue.length === 0) {
    roomState.queue = [...tracks]; // Replenish queue
  }
  
  roomState.currentTrack = roomState.queue.shift();
  roomState.position = 0;
  roomState.isPlaying = true;
  roomState.lastUpdate = Date.now();
  
  io.emit('track-changed', {
    track: roomState.currentTrack,
    position: 0,
    isPlaying: true,
    timestamp: Date.now()
  });
}

// Calculate current position
function getCurrentPosition() {
  if (!roomState.isPlaying) return roomState.position;
  const elapsed = (Date.now() - roomState.lastUpdate) / 1000;
  return Math.min(roomState.position + elapsed, roomState.currentTrack?.duration || Infinity);
}

// Sync all clients every second
setInterval(() => {
  io.emit('sync', {
    position: getCurrentPosition(),
    isPlaying: roomState.isPlaying,
    currentTrack: roomState.currentTrack,
    timestamp: Date.now()
  });
}, 1000);

io.on('connection', (socket) => {
  // Send full state on connect
  socket.emit('init', {
    tracks,
    playlists,
    currentState: {
      ...roomState,
      position: getCurrentPosition()
    }
  });

  // Track duration reporting
  socket.on('duration', ({ trackId, duration }) => {
    const track = tracks.find(t => t.id === trackId);
    if (track) track.duration = duration;
  });

  // Playback control
  socket.on('play', ({ trackId }) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    roomState = {
      ...roomState,
      currentTrack: track,
      position: 0,
      isPlaying: true,
      lastUpdate: Date.now()
    };

    io.emit('track-changed', {
      track,
      position: 0,
      isPlaying: true,
      timestamp: Date.now()
    });
  });

  socket.on('pause', () => {
    roomState = {
      ...roomState,
      position: getCurrentPosition(),
      isPlaying: false,
      lastUpdate: Date.now()
    };
    io.emit('pause', {
      position: roomState.position,
      timestamp: Date.now()
    });
  });

  socket.on('seek', ({ position }) => {
    roomState = {
      ...roomState,
      position: Math.max(0, position),
      lastUpdate: Date.now()
    };
    io.emit('seek', {
      position: roomState.position,
      timestamp: Date.now()
    });
  });

  // Navigation controls
  socket.on('next', () => {
    playNextTrack();
  });

  socket.on('previous', () => {
    const prevIndex = (tracks.findIndex(t => t.id === roomState.currentTrack?.id) - 1 + tracks.length) % tracks.length;
    const track = tracks[prevIndex];
    
    roomState = {
      ...roomState,
      currentTrack: track,
      position: 0,
      isPlaying: true,
      lastUpdate: Date.now()
    };
    
    io.emit('track-changed', {
      track,
      position: 0,
      isPlaying: true,
      timestamp: Date.now()
    });
  });

  // Track ended
  socket.on('track-ended', () => {
    playNextTrack();
  });

  // Playlist management
  socket.on('add-to-playlist', ({ playlistName, trackId }) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    if (!playlists[playlistName]) {
      playlists[playlistName] = [];
    }
    
    if (!playlists[playlistName].some(t => t.id === trackId)) {
      playlists[playlistName].push(track);
      savePlaylists(playlists);
      io.emit('playlist-updated', { playlistName, playlists });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
