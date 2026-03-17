'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// JamSync – Production Server (R2 Edition)
// Audio files → Cloudflare R2 (streamed directly to clients)
// Track metadata → Firebase Realtime DB /tracks
// Server → pure Socket.IO signaling, zero MP3 buffering
// ─────────────────────────────────────────────────────────────────────────────

const express     = require('express');
const http        = require('http');
const socketIo    = require('socket.io');
const path        = require('path');
const fs          = require('fs');
const admin       = require('firebase-admin');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const morgan      = require('morgan');

// ── Environment validation ────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_DATABASE_URL',
];

const missingEnv = REQUIRED_ENV.filter(v => !process.env[v]);
if (missingEnv.length) {
  console.error('[boot] Missing required environment variables:', missingEnv.join(', '));
  process.exit(1);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT || '10000', 10);
const NODE_ENV    = process.env.NODE_ENV || 'development';
const IS_PROD     = NODE_ENV === 'production';
const PUBLIC_DIR  = path.join(__dirname, 'public');
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

// ── Firebase Admin ────────────────────────────────────────────────────────────

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db         = admin.database();
const getRoomRef = (code) => db.ref(`rooms/${code}`);
const tracksRef  = db.ref('tracks');

// ── Express setup ─────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(express.json({ limit: '100kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests – slow down.' },
});
app.use('/api/', apiLimiter);

// Static files (frontend only — audio is served from R2, not here)
app.use(express.static(PUBLIC_DIR, {
  maxAge: IS_PROD ? '7d' : 0,
  etag: true,
}));

// ── Playlist persistence ──────────────────────────────────────────────────────

const PLAYLIST_FILE     = path.join(__dirname, 'playlists.json');
const DEFAULT_PLAYLISTS = { default: [], favorites: [] };

function loadPlaylists() {
  try {
    if (!fs.existsSync(PLAYLIST_FILE)) {
      fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(DEFAULT_PLAYLISTS, null, 2));
    }
    return JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));
  } catch (err) {
    console.error('[playlists] Load error:', err.message);
    return { ...DEFAULT_PLAYLISTS };
  }
}

function savePlaylists(p) {
  try {
    fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(p, null, 2));
  } catch (err) {
    console.error('[playlists] Save error:', err.message);
  }
}

let playlists = loadPlaylists();

// ── Track loading from Firebase ───────────────────────────────────────────────
//
// Track schema in Firebase Realtime DB at /tracks:
// {
//   "track_0": {
//     "id": "track_0",
//     "name": "Song Title",
//     "artist": "Artist Name",
//     "album": "Album Name",
//     "duration": 240,
//     "url": "https://pub-xxxx.r2.dev/music/song.mp3"
//   },
//   ...
// }
//
// To add tracks, use the Firebase Console or the /api/admin/tracks POST endpoint below.

let tracks = [];

async function loadTracksFromFirebase() {
  try {
    const snap = await tracksRef.once('value');
    if (!snap.exists()) {
      console.warn('[tracks] No tracks found in Firebase at /tracks. Add tracks via the admin API.');
      return [];
    }
    const data   = snap.val();
    const result = Object.values(data)
      .filter(t => t && t.url)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    console.log(`[tracks] Loaded ${result.length} track(s) from Firebase`);
    return result;
  } catch (err) {
    console.error('[tracks] Firebase load error:', err.message);
    return [];
  }
}

(async () => {
  tracks = await loadTracksFromFirebase();
})();

// Live-sync tracks from Firebase (any admin update reflects immediately)
tracksRef.on('value', (snap) => {
  if (!snap.exists()) return;
  const data   = snap.val();
  const result = Object.values(data)
    .filter(t => t && t.url)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  tracks = result;
  console.log(`[tracks] Live-synced ${tracks.length} track(s) from Firebase`);
});

// ── Room helpers ──────────────────────────────────────────────────────────────

function generateRoomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

function isValidRoomCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{4,8}$/.test(code);
}

async function getRoomState(roomCode) {
  const snap = await getRoomRef(roomCode).once('value');
  return snap.exists() ? snap.val() : null;
}

async function playNextTrack(roomCode) {
  const room = await getRoomState(roomCode);
  if (!room) return;

  const queue = room.queue?.length ? [...room.queue] : [...tracks];
  const next  = queue.shift();
  if (!next) return;

  await getRoomRef(roomCode).update({
    currentTrack: next,
    position:     0,
    isPlaying:    true,
    lastUpdate:   Date.now(),
    queue,
  });

  io.to(roomCode).emit('track-changed', {
    track:     next,
    position:  0,
    isPlaying: true,
    timestamp: Date.now(),
  });
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────

const io = socketIo(server, {
  cors: {
    origin: IS_PROD ? process.env.ALLOWED_ORIGIN || false : '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingTimeout:  20000,
  pingInterval: 25000,
});

// Auth middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication token missing'));
  try {
    socket.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (err) {
    console.warn('[socket] Token verify failed:', err.code);
    next(new Error('Invalid authentication token'));
  }
});

const socketRoomMap = {};
const roomListeners = {};

async function leaveCurrentRoom(socket) {
  const roomCode = socketRoomMap[socket.id];
  if (!roomCode) return;

  socket.leave(roomCode);
  delete socketRoomMap[socket.id];

  if (roomListeners[socket.id]) {
    getRoomRef(roomListeners[socket.id].roomCode)
      .off('value', roomListeners[socket.id].listener);
    delete roomListeners[socket.id];
  }

  try {
    const room = await getRoomState(roomCode);
    if (room?.host === socket.user?.uid) {
      const clients = io.sockets.adapter.rooms.get(roomCode);
      if (!clients || clients.size === 0) {
        await getRoomRef(roomCode).update({ isPlaying: false });
      }
    }
  } catch {}
}

io.on('connection', (socket) => {
  console.log(`[socket] ${socket.id} connected (${socket.user.uid})`);

  // ─ Create room ───────────────────────────────────────────────────────────────
  socket.on('create-room', async () => {
    try {
      let code;
      let attempts = 0;
      do {
        code = generateRoomCode();
        const existing = await getRoomState(code);
        if (!existing) break;
      } while (++attempts < 5);

      const firstTrack = tracks[0] || null;

      await getRoomRef(code).set({
        host:         socket.user.uid,
        createdAt:    Date.now(),
        lastUpdate:   Date.now(),
        currentTrack: firstTrack,
        position:     0,
        isPlaying:    false,
        queue:        tracks.slice(1),
      });

      await leaveCurrentRoom(socket);
      socket.join(code);
      socketRoomMap[socket.id] = code;

      socket.emit('room-created', {
        code,
        tracks,
        playlists,
        currentState: {
          currentTrack: firstTrack,
          position:     0,
          isPlaying:    false,
          lastUpdate:   Date.now(),
          queue:        tracks.slice(1),
        },
      });

      console.log(`[room] ${socket.user.uid} created ${code}`);
    } catch (err) {
      console.error('[room] create error:', err);
      socket.emit('room-error', { message: 'Failed to create room.' });
    }
  });

  // ─ Join room ─────────────────────────────────────────────────────────────────
  socket.on('join-room', async ({ code } = {}) => {
    try {
      const upperCode = (code || '').toUpperCase().trim();
      if (!isValidRoomCode(upperCode)) {
        socket.emit('room-error', { message: 'Invalid room code format.' });
        return;
      }

      const room = await getRoomState(upperCode);
      if (!room) {
        socket.emit('room-error', { message: 'Room not found.' });
        return;
      }

      await leaveCurrentRoom(socket);
      socket.join(upperCode);
      socketRoomMap[socket.id] = upperCode;

      socket.emit('init', {
        tracks,
        playlists,
        currentState: {
          currentTrack: room.currentTrack,
          position:     room.position,
          isPlaying:    room.isPlaying,
          lastUpdate:   room.lastUpdate,
          queue:        room.queue,
        },
      });

      const listener = getRoomRef(upperCode).on('value', (snap) => {
        const r = snap.val();
        if (!r) return;
        const elapsed = r.isPlaying ? (Date.now() - r.lastUpdate) / 1000 : 0;
        socket.emit('sync', {
          position:     r.position + elapsed,
          isPlaying:    r.isPlaying,
          currentTrack: r.currentTrack,
          timestamp:    Date.now(),
        });
      });

      roomListeners[socket.id] = { roomCode: upperCode, listener };
      console.log(`[room] ${socket.user.uid} joined ${upperCode}`);
    } catch (err) {
      console.error('[room] join error:', err);
      socket.emit('room-error', { message: 'Failed to join room.' });
    }
  });

  // ─ Host-only helper ───────────────────────────────────────────────────────────
  async function requireHost(cb) {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    const room = await getRoomState(roomCode);
    if (!room || room.host !== socket.user.uid) return;
    await cb(roomCode, room);
  }

  // ─ Playback (host-only) ───────────────────────────────────────────────────────
  socket.on('play', async ({ trackId } = {}) => {
    await requireHost(async (roomCode) => {
      const track = tracks.find(t => t.id === String(trackId));
      if (!track) return;
      await getRoomRef(roomCode).update({
        currentTrack: track,
        position:     0,
        isPlaying:    true,
        lastUpdate:   Date.now(),
      });
      io.to(roomCode).emit('track-changed', {
        track,
        position:  0,
        isPlaying: true,
        timestamp: Date.now(),
      });
    });
  });

  socket.on('pause', async () => {
    await requireHost(async (roomCode, room) => {
      const elapsed  = room.isPlaying ? (Date.now() - room.lastUpdate) / 1000 : 0;
      const position = room.position + elapsed;
      await getRoomRef(roomCode).update({ position, isPlaying: false, lastUpdate: Date.now() });
      io.to(roomCode).emit('pause', { position, timestamp: Date.now() });
    });
  });

  socket.on('seek', async ({ position } = {}) => {
    await requireHost(async (roomCode) => {
      const safePos = Math.max(0, Number(position) || 0);
      await getRoomRef(roomCode).update({ position: safePos, lastUpdate: Date.now() });
      io.to(roomCode).emit('seek', { position: safePos, timestamp: Date.now() });
    });
  });

  socket.on('next', async () => {
    await requireHost(async (roomCode) => { await playNextTrack(roomCode); });
  });

  socket.on('previous', async () => {
    await requireHost(async (roomCode, room) => {
      const currentIdx = tracks.findIndex(t => t.id === room.currentTrack?.id);
      const prevTrack  = tracks[(currentIdx - 1 + tracks.length) % tracks.length];
      if (!prevTrack) return;
      await getRoomRef(roomCode).update({
        currentTrack: prevTrack,
        position:     0,
        isPlaying:    true,
        lastUpdate:   Date.now(),
      });
      io.to(roomCode).emit('track-changed', {
        track: prevTrack, position: 0, isPlaying: true, timestamp: Date.now(),
      });
    });
  });

  socket.on('track-ended', async () => {
    await requireHost(async (roomCode) => { await playNextTrack(roomCode); });
  });

  socket.on('duration', ({ trackId, duration } = {}) => {
    const track = tracks.find(t => t.id === String(trackId));
    if (track && typeof duration === 'number' && duration > 0) {
      track.duration = Math.round(duration);
    }
  });

  socket.on('add-to-playlist', ({ playlistName, trackId } = {}) => {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    const name  = String(playlistName || '').trim().slice(0, 64);
    const track = tracks.find(t => t.id === String(trackId));
    if (!name || !track) return;
    if (!playlists[name]) playlists[name] = [];
    if (!playlists[name].some(t => t.id === track.id)) {
      playlists[name].push(track);
      savePlaylists(playlists);
      io.to(roomCode).emit('playlist-updated', { playlistName: name, playlists });
    }
  });

  socket.on('disconnect', async (reason) => {
    console.log(`[socket] ${socket.id} disconnected (${reason})`);
    await leaveCurrentRoom(socket);
  });
});

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/tracks', (_req, res) => {
  res.json({ count: tracks.length, tracks });
});

app.get('/api/playlists', (_req, res) => {
  res.json(playlists);
});

app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    env:       NODE_ENV,
    tracks:    tracks.length,
    uptime:    Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Admin: add a track (stores metadata in Firebase, URL points to R2)
// POST /api/admin/tracks
// Body: { id, name, artist, album, duration, url }
// Protect this with a secret header in production (ADMIN_SECRET env var)
app.post('/api/admin/tracks', (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id, name, artist, album, duration, url } = req.body;
  if (!id || !name || !url) {
    return res.status(400).json({ error: 'id, name, and url are required' });
  }

  const track = {
    id:       String(id),
    name:     String(name).trim(),
    artist:   String(artist || 'Unknown Artist').trim(),
    album:    String(album || '').trim(),
    duration: Number(duration) || 0,
    url:      String(url).trim(),
  };

  tracksRef.child(track.id).set(track, (err) => {
    if (err) {
      console.error('[admin] Track save error:', err.message);
      return res.status(500).json({ error: 'Failed to save track' });
    }
    res.status(201).json({ success: true, track });
  });
});

// Admin: delete a track
app.delete('/api/admin/tracks/:id', (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  tracksRef.child(req.params.id).remove((err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete track' });
    res.json({ success: true });
  });
});

// Legacy compat
app.get('/tracks',    (_req, res) => res.json(tracks));
app.get('/playlists', (_req, res) => res.json(playlists));

// SPA fallback
app.use((_req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('[http] Unhandled error:', err);
  res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message });
});

// ── Stale-room cleanup (every 30 min) ────────────────────────────────────────

setInterval(async () => {
  try {
    const snap   = await db.ref('rooms').once('value');
    const rooms  = snap.val() || {};
    const cutoff = Date.now() - ROOM_TTL_MS;
    const stale  = Object.entries(rooms)
      .filter(([, r]) => r.lastUpdate < cutoff)
      .map(([code]) => code);

    for (const code of stale) {
      const clients = io.sockets.adapter.rooms.get(code);
      if (!clients || clients.size === 0) {
        await getRoomRef(code).remove();
        console.log(`[cleanup] Removed stale room ${code}`);
      }
    }
  } catch (err) {
    console.error('[cleanup] Error:', err.message);
  }
}, 30 * 60 * 1000);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} received`);
  tracksRef.off(); // detach Firebase listener
  server.close(async () => {
    try { await admin.app().delete(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException',  (err) => console.error('[uncaught]',  err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[boot] JamSync (R2 Edition) running on http://localhost:${PORT} (${NODE_ENV})`);
  console.log(`[boot] Tracks loaded: ${tracks.length} (may still be syncing from Firebase)`);
});
