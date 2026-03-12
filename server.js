'use strict';
// for re commit in the render
// for re commit in the render

// ─────────────────────────────────────────────────────────────────────────────
// JamSync – Production Server
// ─────────────────────────────────────────────────────────────────────────────

const express    = require('express');
const http       = require('http');
const socketIo   = require('socket.io');
const path       = require('path');
const fs         = require('fs');
const admin      = require('firebase-admin');
const helmet     = require('helmet');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');
const morgan     = require('morgan');
const { parseBuffer } = require('music-metadata');

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

// ── Constants ────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT || '10000', 10);
const NODE_ENV    = process.env.NODE_ENV || 'development';
const IS_PROD     = NODE_ENV === 'production';
const PUBLIC_DIR  = path.join(__dirname, 'public');
const MUSIC_DIR   = path.join(PUBLIC_DIR, 'music');
const PLAYLIST_FILE = path.join(__dirname, 'playlists.json');
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // auto-delete stale rooms after 2h

// ── Firebase Admin ────────────────────────────────────────────────────────────

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
const getRoomRef = (code) => db.ref(`rooms/${code}`);

// ── Express setup ─────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

// Security headers (relaxed for Firebase SDK + Socket.IO CDN resources)
app.use(helmet({
  contentSecurityPolicy: false, // managed separately; disable default to avoid breaking Firebase SDK
  crossOriginEmbedderPolicy: false,
}));

// Gzip compression
app.use(compression());

// HTTP logging
app.use(morgan(IS_PROD ? 'combined' : 'dev'));

// JSON body parsing (for REST endpoints)
app.use(express.json({ limit: '100kb' }));

// Global API rate limiter (100 req / 15 min per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests – slow down.' },
});
app.use('/api/', apiLimiter);

// Static files (music + frontend)
app.use(express.static(PUBLIC_DIR, {
  maxAge: IS_PROD ? '7d' : 0,
  etag:   true,
}));

// ── Music directory bootstrap ─────────────────────────────────────────────────

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  console.warn('[music] Created missing music directory at', MUSIC_DIR);
}

// ── Playlist persistence ──────────────────────────────────────────────────────

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

function savePlaylists(playlists) {
  try {
    fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(playlists, null, 2));
  } catch (err) {
    console.error('[playlists] Save error:', err.message);
  }
}

let playlists = loadPlaylists();

// ── Track loading with ID3 metadata ──────────────────────────────────────────

async function loadTrackMetadata(filePath, index) {
  const fileName = path.basename(filePath);
  const base = {
    id:       String(index),
    name:     fileName.replace(/\.mp3$/i, '').replace(/[_-]+/g, ' ').trim(),
    artist:   'Unknown Artist',
    album:    '',
    duration: 0,
    url:      `/music/${encodeURIComponent(fileName)}`,
  };

  try {
    const buffer = fs.readFileSync(filePath);
    const meta   = await parseBuffer(buffer, { mimeType: 'audio/mpeg' }, { duration: false, skipCovers: true });
    const { common, format } = meta;
    return {
      ...base,
      name:     common.title  || base.name,
      artist:   common.artist || base.artist,
      album:    common.album  || '',
      duration: Math.round(format.duration || 0),
    };
  } catch {
    return base; // fall back to file-name parsing if metadata read fails
  }
}

async function getTracks() {
  let files = [];
  try {
    files = fs.readdirSync(MUSIC_DIR)
      .filter(f => /\.mp3$/i.test(f))
      .sort()
      .map(f => path.join(MUSIC_DIR, f));
  } catch (err) {
    console.error('[tracks] Could not read music directory:', err.message);
    return [];
  }

  if (!files.length) {
    console.warn('[tracks] No .mp3 files found in', MUSIC_DIR);
    return [];
  }

  const results = await Promise.all(files.map((f, i) => loadTrackMetadata(f, i)));
  console.log(`[tracks] Loaded ${results.length} track(s)`);
  return results;
}

// Cache tracks in memory (re-scan on HUP signal)
let tracks = [];

(async () => {
  tracks = await getTracks();
})();

process.on('SIGHUP', async () => {
  console.log('[tracks] SIGHUP received – rescanning music directory');
  tracks = await getTracks();
});

// ── Room code generator ───────────────────────────────────────────────────────

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(len = 6) {
  return Array.from({ length: len }, () =>
    ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]
  ).join('');
}

function isValidRoomCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{4,8}$/.test(code);
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

// Auth middleware – verify Firebase ID token on every connection
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

// In-memory maps
const socketRoomMap  = {};  // socketId → roomCode
const roomListeners  = {};  // socketId → { roomCode, unsubscribeFn }

// ── Room helpers ──────────────────────────────────────────────────────────────

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

async function cleanupEmptyRoom(roomCode) {
  const clients = io.sockets.adapter.rooms.get(roomCode);
  if (!clients || clients.size === 0) {
    await getRoomRef(roomCode).remove();
    console.log(`[room] ${roomCode} deleted – empty`);
  }
}

async function leaveCurrentRoom(socket) {
  const roomCode = socketRoomMap[socket.id];
  if (!roomCode) return;

  socket.leave(roomCode);
  delete socketRoomMap[socket.id];

  const entry = roomListeners[socket.id];
  if (entry) {
    getRoomRef(entry.roomCode).off('value', entry.listener);
    delete roomListeners[socket.id];
  }

  setTimeout(() => cleanupEmptyRoom(roomCode), 500);
}

// ── Socket connection ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[socket] ${socket.id} connected (uid: ${socket.user.uid})`);

  // ─ Create room ──────────────────────────────────────────────────────────────
  socket.on('create-room', async () => {
    try {
      await leaveCurrentRoom(socket);

      // Find a unique room code
      let roomCode;
      let attempts = 0;
      do {
        roomCode = generateRoomCode();
        const snap = await getRoomRef(roomCode).once('value');
        if (!snap.exists()) break;
      } while (++attempts < 20);

      if (attempts >= 20) {
        socket.emit('room-error', { message: 'Could not generate unique room. Try again.' });
        return;
      }

      await getRoomRef(roomCode).set({
        host:         socket.user.uid,
        hostEmail:    socket.user.email || null,
        currentTrack: null,
        position:     0,
        isPlaying:    false,
        lastUpdate:   Date.now(),
        createdAt:    Date.now(),
        queue:        [...tracks],
      });

      socket.join(roomCode);
      socketRoomMap[socket.id] = roomCode;

      socket.emit('room-created', { roomCode });
      socket.emit('init', {
        tracks,
        playlists,
        currentState: {
          currentTrack: null,
          position:     0,
          isPlaying:    false,
          lastUpdate:   Date.now(),
          queue:        [...tracks],
        },
      });

      console.log(`[room] ${roomCode} created by ${socket.user.uid}`);
    } catch (err) {
      console.error('[room] create error:', err);
      socket.emit('room-error', { message: 'Failed to create room.' });
    }
  });

  // ─ Join room ────────────────────────────────────────────────────────────────
  socket.on('join-room', async ({ roomCode } = {}) => {
    try {
      const code = (roomCode || '').toString().trim().toUpperCase();
      if (!isValidRoomCode(code)) {
        socket.emit('room-error', { message: 'Invalid room code format.' });
        return;
      }

      const room = await getRoomState(code);
      if (!room) {
        socket.emit('room-error', { message: 'Room not found.' });
        return;
      }

      await leaveCurrentRoom(socket);

      socket.join(code);
      socketRoomMap[socket.id] = code;

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

      // Subscribe to real-time state changes for this socket
      const listener = getRoomRef(code).on('value', (snap) => {
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

      roomListeners[socket.id] = { roomCode: code, listener };

      console.log(`[room] ${socket.id} (${socket.user.uid}) joined ${code}`);
    } catch (err) {
      console.error('[room] join error:', err);
      socket.emit('room-error', { message: 'Failed to join room.' });
    }
  });

  // ─ Host-only playback helper ─────────────────────────────────────────────────
  async function requireHost(cb) {
    const roomCode = socketRoomMap[socket.id];
    if (!roomCode) return;
    const room = await getRoomState(roomCode);
    if (!room || room.host !== socket.user.uid) return;
    await cb(roomCode, room);
  }

  // ─ Playback events (host-only) ───────────────────────────────────────────────
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
      const elapsed   = room.isPlaying ? (Date.now() - room.lastUpdate) / 1000 : 0;
      const position  = room.position + elapsed;

      await getRoomRef(roomCode).update({
        position,
        isPlaying:  false,
        lastUpdate: Date.now(),
      });

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
    await requireHost(async (roomCode) => {
      await playNextTrack(roomCode);
    });
  });

  socket.on('previous', async () => {
    await requireHost(async (roomCode, room) => {
      const currentId  = room.currentTrack?.id;
      const currentIdx = tracks.findIndex(t => t.id === currentId);
      const prevTrack  = tracks[(currentIdx - 1 + tracks.length) % tracks.length];
      if (!prevTrack) return;

      await getRoomRef(roomCode).update({
        currentTrack: prevTrack,
        position:     0,
        isPlaying:    true,
        lastUpdate:   Date.now(),
      });

      io.to(roomCode).emit('track-changed', {
        track:     prevTrack,
        position:  0,
        isPlaying: true,
        timestamp: Date.now(),
      });
    });
  });

  socket.on('track-ended', async () => {
    await requireHost(async (roomCode) => {
      await playNextTrack(roomCode);
    });
  });

  // ─ Duration reporting (any client) ──────────────────────────────────────────
  socket.on('duration', ({ trackId, duration } = {}) => {
    const track = tracks.find(t => t.id === String(trackId));
    if (track && typeof duration === 'number' && duration > 0) {
      track.duration = Math.round(duration);
    }
  });

  // ─ Playlist management (any authenticated user) ───────────────────────────
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

  // ─ Disconnect ────────────────────────────────────────────────────────────────
  socket.on('disconnect', async (reason) => {
    console.log(`[socket] ${socket.id} disconnected (${reason})`);
    await leaveCurrentRoom(socket);
  });
});

// ── REST API endpoints ────────────────────────────────────────────────────────

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

// Legacy (keep backwards-compat with old client fetches)
app.get('/tracks',    (_req, res) => res.json(tracks));
app.get('/playlists', (_req, res) => res.json(playlists));

// 404 catch-all (SPA fallback)
app.use((_req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[http] Unhandled error:', err);
  res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message });
});

// ── Stale-room cleanup (every 30 min) ────────────────────────────────────────

setInterval(async () => {
  try {
    const snap = await db.ref('rooms').once('value');
    const rooms = snap.val() || {};
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
  console.log(`[shutdown] ${signal} received – shutting down`);
  server.close(async () => {
    try {
      await admin.app().delete();
    } catch {}
    console.log('[shutdown] Clean exit');
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
  console.log(`[boot] JamSync running on http://localhost:${PORT} (${NODE_ENV})`);
  console.log(`[boot] Music dir: ${MUSIC_DIR}`);
  console.log(`[boot] Tracks loaded: ${tracks.length} (may still be scanning)`);
});
