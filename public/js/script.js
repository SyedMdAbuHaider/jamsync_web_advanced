'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// JamSync Client — app.js
//
// IMPORTANT: This file does NOT create its own socket.io connection.
// The authenticated socket is created by the Firebase auth module in index.html
// and passed in via window.initializeApp(socket).
// ─────────────────────────────────────────────────────────────────────────────

// ── State management ──────────────────────────────────────────────────────────

const AppState = (() => {
  let _tracks          = [];
  let _filteredTracks  = [];
  let _currentTrack    = null;
  let _playlists       = {};
  let _isPlaying       = false;
  let _isInteracting   = false;
  let _volume          = parseFloat(localStorage.getItem('jamSync_volume') ?? '1');
  let _repeatMode      = localStorage.getItem('jamSync_repeat') || 'none'; // 'none'|'one'|'all'
  let _shuffleEnabled  = localStorage.getItem('jamSync_shuffle') === 'true';
  let _shuffledQueue   = [];
  let _likedTracks     = new Set(JSON.parse(localStorage.getItem('jamSync_liked') || '[]'));
  let _syncThreshold   = 0.5; // seconds drift before hard-sync
  let _lastSyncAt      = 0;

  return {
    /* getters */
    getTracks:        ()         => _tracks,
    getFilteredTracks: ()        => _filteredTracks,
    getCurrentTrack:  ()         => _currentTrack,
    getPlaylists:     ()         => _playlists,
    isPlaying:        ()         => _isPlaying,
    isInteracting:    ()         => _isInteracting,
    getVolume:        ()         => _volume,
    getRepeatMode:    ()         => _repeatMode,
    isShuffleEnabled: ()         => _shuffleEnabled,
    getShuffledQueue: ()         => _shuffledQueue,
    isLiked:          (id)       => _likedTracks.has(id),

    /* setters */
    setTracks(raw) {
      _tracks = raw.map((t, i) => ({
        id:       String(t.id ?? i),
        name:     t.name     || 'Unknown Track',
        artist:   t.artist   || 'JamSync Artist',
        album:    t.album    || '',
        url:      t.url,
        duration: t.duration || 0,
        albumArt: t.albumArt || AppUtils.randomEmoji(),
        likes:    t.likes    || Math.floor(Math.random() * 500) + 50,
      }));
    },

    setFilteredTracks(v) { _filteredTracks = [...v]; },
    setCurrentTrack(v)   { _currentTrack   = v; },
    setPlaylists(v)      { _playlists      = { ...v }; },
    setIsPlaying(v)      { _isPlaying      = !!v; },

    setInteracting(duration = 600) {
      _isInteracting = true;
      clearTimeout(AppState._interactTimer);
      AppState._interactTimer = setTimeout(() => { _isInteracting = false; }, duration);
    },

    setVolume(v) {
      _volume = Math.max(0, Math.min(1, v));
      localStorage.setItem('jamSync_volume', _volume);
    },

    setRepeatMode(mode) {
      if (['none', 'one', 'all'].includes(mode)) {
        _repeatMode = mode;
        localStorage.setItem('jamSync_repeat', mode);
      }
    },

    setShuffleEnabled(v) {
      _shuffleEnabled = !!v;
      localStorage.setItem('jamSync_shuffle', v);
      _shuffledQueue = v ? AppUtils.shuffle([..._tracks]) : [];
    },

    toggleLike(id) {
      if (_likedTracks.has(id)) {
        _likedTracks.delete(id);
      } else {
        _likedTracks.add(id);
      }
      localStorage.setItem('jamSync_liked', JSON.stringify([..._likedTracks]));
      return _likedTracks.has(id);
    },

    shouldSync(serverPos) {
      const audio = DOM.audio;
      if (!audio || _isInteracting) return false;
      const drift = Math.abs(audio.currentTime - serverPos);
      const age   = Date.now() - _lastSyncAt;
      return drift > _syncThreshold && age > 1000;
    },

    markSynced() { _lastSyncAt = Date.now(); },
  };
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

const AppUtils = {
  formatTime(sec) {
    if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  },

  randomEmoji() {
    const pool = ['📀', '🎵', '🎸', '🎹', '🎤', '🥁', '🎧', '💿', '🎺', '🎻'];
    return pool[Math.floor(Math.random() * pool.length)];
  },

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  getNextTrack(currentId) {
    const tracks     = AppState.getTracks();
    const repeat     = AppState.getRepeatMode();
    const shuffle    = AppState.isShuffleEnabled();
    const queue      = AppState.getShuffledQueue();

    if (!tracks.length) return null;
    if (repeat === 'one') return tracks.find(t => t.id === currentId) || null;

    const pool  = (shuffle && queue.length) ? queue : tracks;
    const idx   = pool.findIndex(t => t.id === currentId);
    const next  = (idx === -1) ? 0 : idx + 1;

    if (repeat === 'all' || shuffle) return pool[next % pool.length];
    return pool[next] || null;
  },

  getPrevTrack(currentId) {
    const tracks  = AppState.getTracks();
    const shuffle = AppState.isShuffleEnabled();
    const queue   = AppState.getShuffledQueue();
    if (!tracks.length) return null;

    const pool = (shuffle && queue.length) ? queue : tracks;
    const idx  = pool.findIndex(t => t.id === currentId);
    const prev = (idx <= 0) ? pool.length - 1 : idx - 1;
    return pool[prev] || null;
  },

  updateMediaSession(track, playing) {
    if (!('mediaSession' in navigator)) return;
    if (!track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  track.name,
        artist: track.artist || 'JamSync',
        album:  track.album  || 'JamSync',
      });
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {}
  },
};

// ── DOM cache ─────────────────────────────────────────────────────────────────

const DOM = {
  audio:           document.getElementById('audioPlayer'),
  progressBar:     document.getElementById('songProgress'),
  progressWrap:    document.querySelector('.progress-bar'),
  currentTime:     document.getElementById('currentTime'),
  totalTime:       document.getElementById('totalTime'),
  playPauseBtn:    document.getElementById('playPauseBtn'),
  nextBtn:         document.getElementById('nextBtn'),
  prevBtn:         document.getElementById('prevBtn'),
  shuffleBtn:      document.getElementById('shuffleBtn'),
  repeatBtn:       document.getElementById('repeatBtn'),
  likeBtn:         document.getElementById('likeBtn'),
  volumeSlider:    document.getElementById('volumeSlider'),
  volumeIcon:      document.getElementById('volumeIcon'),
  searchInput:     document.getElementById('searchInput'),
  musicList:       document.getElementById('musicList'),
  addToPlaylist:   document.getElementById('addToPlaylist'),
  playlistSelect:  document.getElementById('playlistSelect'),
  trackName:       document.getElementById('currentTrackName'),
  artistName:      document.getElementById('currentArtist'),
  albumArt:        document.getElementById('playerAlbumArt'),
  mobileNP:        document.querySelector('#nowPlayingMobile span'),
  trackCount:      document.getElementById('trackCount'),
  audioError:      document.getElementById('audioError'),
};

// ── UI Renderer ───────────────────────────────────────────────────────────────

const UI = (() => {
  let activeEl = null;

  function renderTrackList(list) {
    const frag = document.createDocumentFragment();
    const cur  = AppState.getCurrentTrack();
    const playing = AppState.isPlaying();

    list.forEach((track, i) => {
      const el = document.createElement('div');
      el.className  = 'track';
      el.dataset.id = track.id;

      const isCurrent = cur?.id === track.id;
      if (isCurrent) {
        el.classList.add('active');
        if (playing) el.classList.add('playing');
        activeEl = el;
      }

      el.innerHTML = `
        <div class="track-idx">
          <span class="track-num">${i + 1}</span>
          <div class="track-wave">
            <span class="bar"></span><span class="bar"></span>
            <span class="bar"></span><span class="bar"></span>
          </div>
        </div>
        <div class="track-thumb">${track.albumArt}</div>
        <div class="track-info">
          <div class="track-title">${escHtml(track.name)}</div>
          <div class="track-meta">
            <span>${escHtml(track.artist)}</span>
            <span class="dur">${track.duration ? AppUtils.formatTime(track.duration) : '--:--'}</span>
          </div>
        </div>
        <div class="track-likes">
          <i class="${AppState.isLiked(track.id) ? 'fas' : 'far'} fa-heart"></i>
          <span>${track.likes || 0}</span>
        </div>`;

      frag.appendChild(el);
    });

    DOM.musicList.innerHTML = '';
    DOM.musicList.appendChild(frag);
    if (DOM.trackCount) DOM.trackCount.textContent = list.length;
  }

  function updateNowPlaying() {
    const t = AppState.getCurrentTrack();
    if (t) {
      if (DOM.trackName)  DOM.trackName.textContent  = t.name;
      if (DOM.artistName) DOM.artistName.textContent = t.artist || 'JamSync';
      if (DOM.albumArt)   DOM.albumArt.textContent   = t.albumArt || '🎵';
      if (DOM.mobileNP)   DOM.mobileNP.textContent   = t.name;
      updateLikeBtn(t.id);
    } else {
      if (DOM.trackName)  DOM.trackName.textContent  = 'Not Playing';
      if (DOM.artistName) DOM.artistName.textContent = 'Select a track';
      if (DOM.albumArt)   DOM.albumArt.textContent   = '🎵';
      if (DOM.mobileNP)   DOM.mobileNP.textContent   = 'Select a track';
    }
  }

  function updateActiveTrack() {
    if (activeEl) activeEl.classList.remove('active', 'playing');
    const cur = AppState.getCurrentTrack();
    if (!cur) return;
    activeEl = document.querySelector(`.track[data-id="${cur.id}"]`);
    if (activeEl) {
      activeEl.classList.add('active');
      if (AppState.isPlaying()) activeEl.classList.add('playing');
    }
  }

  function updatePlayPause(playing) {
    if (!DOM.playPauseBtn) return;
    DOM.playPauseBtn.innerHTML = playing
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play" style="margin-left:2px"></i>';
  }

  function updateProgress() {
    const a = DOM.audio;
    if (!a?.duration) return;
    const pct = (a.currentTime / a.duration) * 100;
    if (DOM.progressBar)  DOM.progressBar.style.width = `${pct}%`;
    if (DOM.currentTime)  DOM.currentTime.textContent = AppUtils.formatTime(a.currentTime);
  }

  function updateTotalTime(dur) {
    if (DOM.totalTime) DOM.totalTime.textContent = AppUtils.formatTime(dur);
  }

  function updateVolume(v) {
    if (DOM.volumeSlider) DOM.volumeSlider.value = v;
    if (DOM.volumeIcon) {
      DOM.volumeIcon.className = v === 0 ? 'fas fa-volume-off'
                               : v < 0.5 ? 'fas fa-volume-low'
                               : 'fas fa-volume-high';
    }
  }

  function updateShuffle(on) {
    if (DOM.shuffleBtn) {
      DOM.shuffleBtn.classList.toggle('active', on);
      DOM.shuffleBtn.setAttribute('aria-pressed', on);
    }
  }

  function updateRepeat(mode) {
    if (!DOM.repeatBtn) return;
    const icon = DOM.repeatBtn.querySelector('i');
    const active = mode !== 'none';
    DOM.repeatBtn.classList.toggle('active', active);
    DOM.repeatBtn.setAttribute('aria-pressed', active);
    if (icon) {
      icon.className = mode === 'one' ? 'fas fa-1 fa-repeat' : 'fas fa-repeat';
      // note: fa-repeat-1 may not exist in all FA versions
      icon.className = 'fas fa-repeat';
      DOM.repeatBtn.title = `Repeat: ${mode}`;
      DOM.repeatBtn.querySelector('i').style.color = active ? '' : '';
    }
  }

  function updateLikeBtn(trackId) {
    if (!DOM.likeBtn) return;
    const liked = AppState.isLiked(trackId);
    const icon  = DOM.likeBtn.querySelector('i');
    if (icon) icon.className = liked ? 'fas fa-heart' : 'far fa-heart';
    DOM.likeBtn.setAttribute('aria-pressed', liked);
  }

  function updatePlaylistDropdown() {
    if (!DOM.playlistSelect) return;
    const names = Object.keys(AppState.getPlaylists());
    DOM.playlistSelect.innerHTML = names.map(n =>
      `<option value="${escHtml(n)}">${escHtml(n.charAt(0).toUpperCase() + n.slice(1))}</option>`
    ).join('');
  }

  function showError(msg) {
    if (!DOM.audioError) return;
    if (!msg) { DOM.audioError.style.display = 'none'; return; }
    DOM.audioError.style.display = 'inline-flex';
    DOM.audioError.innerHTML = `<i class="fas fa-circle-exclamation" style="font-size:.7rem"></i> ${escHtml(msg)}`;
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    renderTrackList, updateNowPlaying, updateActiveTrack,
    updatePlayPause, updateProgress, updateTotalTime,
    updateVolume, updateShuffle, updateRepeat, updateLikeBtn,
    updatePlaylistDropdown, showError,
  };
})();

// ── Audio Manager ─────────────────────────────────────────────────────────────

const Audio = (() => {
  function init() {
    const a = DOM.audio;
    if (!a) return;

    a.volume = AppState.getVolume();

    a.addEventListener('timeupdate',    onTimeUpdate);
    a.addEventListener('play',          onPlay);
    a.addEventListener('pause',         onPause);
    a.addEventListener('ended',         onEnded);
    a.addEventListener('error',         onError);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('waiting',       () => UI.showError('Buffering…'));
    a.addEventListener('canplay',       () => UI.showError(null));
    a.addEventListener('stalled',       () => UI.showError('Stalled – check connection'));
  }

  function onTimeUpdate() {
    UI.updateProgress();
  }

  function onPlay() {
    AppState.setIsPlaying(true);
    UI.updatePlayPause(true);
    UI.updateActiveTrack();
    AppUtils.updateMediaSession(AppState.getCurrentTrack(), true);
    DOM.albumArt?.classList.add('playing-glow');
  }

  function onPause() {
    AppState.setIsPlaying(false);
    UI.updatePlayPause(false);
    UI.updateActiveTrack();
    AppUtils.updateMediaSession(AppState.getCurrentTrack(), false);
    DOM.albumArt?.classList.remove('playing-glow');
  }

  function onEnded() {
    DOM.albumArt?.classList.remove('playing-glow');
    const cur    = AppState.getCurrentTrack();
    const repeat = AppState.getRepeatMode();

    if (repeat === 'one' && cur) {
      Sock.play(cur.id);
      return;
    }
    const next = AppUtils.getNextTrack(cur?.id);
    if (next) {
      Sock.play(next.id);
    } else {
      Sock.trackEnded();
    }
  }

  function onError(e) {
    const code = DOM.audio?.error?.code;
    const msgs = { 1:'Aborted', 2:'Network error', 3:'Decode error', 4:'Format not supported' };
    UI.showError(`Playback error: ${msgs[code] || 'Unknown'}`);
    console.error('[audio] error code', code, e);

    // Auto-advance after error
    setTimeout(() => {
      const next = AppUtils.getNextTrack(AppState.getCurrentTrack()?.id);
      if (next) Sock.play(next.id);
    }, 1500);
  }

  function onMeta() {
    const a = DOM.audio;
    const t = AppState.getCurrentTrack();
    if (!a || !t) return;
    UI.updateTotalTime(a.duration);
    Sock.duration(t.id, a.duration);
  }

  function loadTrack(track, position = 0, play = false) {
    const a = DOM.audio;
    if (!a || !track?.url) return;

    AppState.setCurrentTrack(track);
    window.__currentTrackId = track.id; // expose for legacy inline script

    a.src = track.url;
    a.load();

    UI.updateNowPlaying();
    UI.updateActiveTrack();

    a.addEventListener('loadedmetadata', function handler() {
      a.removeEventListener('loadedmetadata', handler);
      a.currentTime = Math.max(0, position);
      if (play) a.play().catch(err => console.warn('[audio] autoplay blocked:', err.message));
    }, { once: true });
  }

  function seek(pos) {
    const a = DOM.audio;
    if (!a?.duration) return;
    a.currentTime = Math.max(0, Math.min(pos, a.duration));
  }

  function setVolume(v) {
    const a = DOM.audio;
    if (!a) return;
    AppState.setVolume(v);
    a.volume = AppState.getVolume();
    UI.updateVolume(AppState.getVolume());
  }

  function togglePlay() {
    const a   = DOM.audio;
    const cur = AppState.getCurrentTrack();
    const tracks = AppState.getTracks();

    if (!cur) {
      if (tracks.length) Sock.play(tracks[0].id);
      return;
    }

    AppState.setInteracting();
    if (a.paused) {
      Sock.play(cur.id);
      a.play().catch(err => console.warn('[audio] play blocked:', err.message));
    } else {
      Sock.pause();
      a.pause();
    }
  }

  return { init, loadTrack, seek, setVolume, togglePlay };
})();

// ── Socket communication ──────────────────────────────────────────────────────

// `socket` is injected by initializeApp()
let _socket = null;

const Sock = {
  play(trackId)          { _socket?.emit('play',          { trackId }); },
  pause()                { _socket?.emit('pause'); },
  next()                 { _socket?.emit('next'); },
  previous()             { _socket?.emit('previous'); },
  seek(pos)              { _socket?.emit('seek',          { position: pos }); },
  duration(id, dur)      { _socket?.emit('duration',      { trackId: id, duration: dur }); },
  trackEnded()           { _socket?.emit('track-ended'); },
  addToPlaylist(name,id) { _socket?.emit('add-to-playlist', { playlistName: name, trackId: id }); },

  // ── Listeners ──────────────────────────────────────────────────────────────
  init(socket) {
    _socket = socket;

    socket.on('init', ({ tracks: serverTracks, playlists: serverPlaylists, currentState }) => {
      AppState.setTracks(serverTracks || []);
      AppState.setFilteredTracks(AppState.getTracks());
      AppState.setPlaylists(serverPlaylists || {});

      UI.renderTrackList(AppState.getFilteredTracks());
      UI.updatePlaylistDropdown();

      if (currentState?.currentTrack) {
        Audio.loadTrack(
          currentState.currentTrack,
          currentState.position  || 0,
          currentState.isPlaying || false,
        );
      }

      // Show empty-state message if no tracks
      if (!AppState.getTracks().length) {
        DOM.musicList.innerHTML = `
          <div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:.85rem;line-height:1.7">
            <div style="font-size:2.5rem;margin-bottom:12px">🎵</div>
            No tracks found.<br>
            Upload MP3s to R2, then run <code style="color:var(--lime)">upload-tracks.js</code> to sync Firebase.
          </div>`;
        if (DOM.trackCount) DOM.trackCount.textContent = '0';
      }
    });

    socket.on('track-changed', ({ track, position, isPlaying }) => {
      Audio.loadTrack(track, position, isPlaying);
    });

    socket.on('pause', ({ position }) => {
      if (AppState.isInteracting()) return;
      const a = DOM.audio;
      if (!a) return;
      a.currentTime = position;
      a.pause();
    });

    socket.on('seek', ({ position }) => {
      if (AppState.isInteracting()) return;
      Audio.seek(position);
    });

    socket.on('sync', ({ position, isPlaying, currentTrack }) => {
      // Reconcile track if different
      const cur = AppState.getCurrentTrack();
      if (currentTrack && cur?.id !== currentTrack.id) {
        Audio.loadTrack(currentTrack, position, isPlaying);
        return;
      }

      if (!AppState.shouldSync(position)) return;
      const a = DOM.audio;
      if (!a) return;

      a.currentTime = position;
      if (isPlaying && a.paused)  a.play().catch(() => {});
      if (!isPlaying && !a.paused) a.pause();
      AppState.markSynced();
    });

    socket.on('playlist-updated', ({ playlistName, playlists }) => {
      AppState.setPlaylists(playlists);
      UI.updatePlaylistDropdown();
      const cur = AppState.getCurrentTrack();
      if (cur) {
        // Toast notification
        showToast(`"${cur.name}" added to ${playlistName}`);
      }
    });

    socket.on('room-error', ({ message }) => {
      console.warn('[room] error:', message);
    });
  },
};

// ── Toast notification ────────────────────────────────────────────────────────

function showToast(msg, duration = 2800) {
  let toast = document.getElementById('jsToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'jsToast';
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);
      background:var(--ink3);border:1px solid var(--lime);border-radius:40px;
      padding:10px 22px;font-size:.8rem;color:var(--lime);
      font-family:'Space Mono',monospace;letter-spacing:.05em;
      opacity:0;transition:opacity .2s,transform .2s;z-index:9999;pointer-events:none;
      white-space:nowrap;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(16px)';
  }, duration);
}

// ── Event handlers ────────────────────────────────────────────────────────────

function attachEventHandlers() {
  // Track click
  DOM.musicList?.addEventListener('click', (e) => {
    const el = e.target.closest('.track');
    if (!el) return;
    const track = AppState.getTracks().find(t => t.id === el.dataset.id);
    if (!track) return;

    AppState.setInteracting();
    AppState.setCurrentTrack(track);
    UI.updateNowPlaying();
    UI.updateActiveTrack();
    Sock.play(track.id);
  });

  // Play / Pause
  DOM.playPauseBtn?.addEventListener('click', Audio.togglePlay);

  // Next / Previous
  DOM.nextBtn?.addEventListener('click', () => {
    AppState.setInteracting();
    Sock.next();
  });
  DOM.prevBtn?.addEventListener('click', () => {
    AppState.setInteracting();
    Sock.previous();
  });

  // Shuffle
  DOM.shuffleBtn?.addEventListener('click', () => {
    const on = !AppState.isShuffleEnabled();
    AppState.setShuffleEnabled(on);
    UI.updateShuffle(on);
  });

  // Repeat
  DOM.repeatBtn?.addEventListener('click', () => {
    const modes = ['none', 'one', 'all'];
    const next  = modes[(modes.indexOf(AppState.getRepeatMode()) + 1) % modes.length];
    AppState.setRepeatMode(next);
    UI.updateRepeat(next);
    showToast(`Repeat: ${next}`);
  });

  // Like
  DOM.likeBtn?.addEventListener('click', () => {
    const cur = AppState.getCurrentTrack();
    if (!cur) return;
    const liked = AppState.toggleLike(cur.id);
    UI.updateLikeBtn(cur.id);
    showToast(liked ? '❤️ Liked' : '🤍 Unliked');
  });

  // Volume slider
  DOM.volumeSlider?.addEventListener('input', (e) => {
    Audio.setVolume(parseFloat(e.target.value));
  });

  // Volume icon (mute toggle)
  DOM.volumeIcon?.addEventListener('click', () => {
    const cur = AppState.getVolume();
    DOM.volumeIcon._prevVol = DOM.volumeIcon._prevVol || 1;
    if (cur > 0) {
      DOM.volumeIcon._prevVol = cur;
      Audio.setVolume(0);
    } else {
      Audio.setVolume(DOM.volumeIcon._prevVol);
    }
    if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();
  });

  // Progress bar (click to seek)
  DOM.progressWrap?.addEventListener('click', (e) => {
    const a = DOM.audio;
    if (!AppState.getCurrentTrack() || !a?.duration) return;
    const rect = DOM.progressWrap.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pos  = pct * a.duration;
    AppState.setInteracting();
    Audio.seek(pos);
    Sock.seek(pos);
  });

  // Progress bar (drag to seek)
  let dragging = false;
  DOM.progressWrap?.addEventListener('mousedown', (e) => {
    dragging = true;
    DOM.progressWrap.classList.add('dragging');
    seekFromEvent(e);
  });
  window.addEventListener('mousemove', (e) => { if (dragging) seekFromEvent(e); });
  window.addEventListener('mouseup',   () => {
    if (dragging) { dragging = false; DOM.progressWrap?.classList.remove('dragging'); }
  });
  DOM.progressWrap?.addEventListener('touchstart', (e) => {
    dragging = true;
    seekFromEvent(e.touches[0]);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (dragging) seekFromEvent(e.touches[0]);
  }, { passive: true });
  window.addEventListener('touchend', () => { dragging = false; });

  function seekFromEvent(e) {
    const a    = DOM.audio;
    const wrap = DOM.progressWrap;
    if (!wrap || !a?.duration) return;
    const rect = wrap.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pos  = pct * a.duration;
    AppState.setInteracting(800);
    Audio.seek(pos);
    if (DOM.progressBar) DOM.progressBar.style.width = `${pct * 100}%`;
    if (DOM.currentTime) DOM.currentTime.textContent = AppUtils.formatTime(pos);
    // Throttle seek events to server
    clearTimeout(seekFromEvent._t);
    seekFromEvent._t = setTimeout(() => Sock.seek(pos), 200);
  }

  // Playlist add
  DOM.addToPlaylist?.addEventListener('click', () => {
    const cur  = AppState.getCurrentTrack();
    const name = DOM.playlistSelect?.value;
    if (!cur || !name) return;
    Sock.addToPlaylist(name, cur.id);
  });

  // Search (debounced)
  DOM.searchInput?.addEventListener('input', AppUtils.debounce((e) => {
    const q     = e.target.value.toLowerCase().trim();
    const all   = AppState.getTracks();
    const found = q ? all.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album && t.album.toLowerCase().includes(q))
    ) : [...all];
    AppState.setFilteredTracks(found);
    UI.renderTrackList(found);
  }, 250));

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    switch (e.key) {
      case ' ':          e.preventDefault(); Audio.togglePlay();     break;
      case 'ArrowRight': e.preventDefault(); Sock.next();            break;
      case 'ArrowLeft':  e.preventDefault(); Sock.previous();        break;
      case 'm': case 'M': e.preventDefault(); DOM.volumeIcon?.click(); break;
      case 'ArrowUp':
        e.preventDefault();
        Audio.setVolume(Math.min(1, AppState.getVolume() + 0.1));
        if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();
        break;
      case 'ArrowDown':
        e.preventDefault();
        Audio.setVolume(Math.max(0, AppState.getVolume() - 0.1));
        if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();
        break;
    }
  });

  // Media Session API action handlers
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',         () => { Sock.play(AppState.getCurrentTrack()?.id); });
    navigator.mediaSession.setActionHandler('pause',        () => Sock.pause());
    navigator.mediaSession.setActionHandler('nexttrack',    () => Sock.next());
    navigator.mediaSession.setActionHandler('previoustrack', () => Sock.previous());
  }
}

// ── App entry point (called by auth module in index.html) ─────────────────────

window.initializeApp = function(socket) {
  console.log('[app] Initializing with authenticated socket', socket.id);

  // Wire socket listeners
  Sock.init(socket);

  // Initialize audio engine
  Audio.init();

  // Restore persisted UI state
  UI.updateVolume(AppState.getVolume());
  UI.updateRepeat(AppState.getRepeatMode());
  UI.updateShuffle(AppState.isShuffleEnabled());
  if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();

  // Attach all user interaction handlers
  attachEventHandlers();

  console.log('[app] Ready');
};'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// JamSync Client — app.js
//
// IMPORTANT: This file does NOT create its own socket.io connection.
// The authenticated socket is created by the Firebase auth module in index.html
// and passed in via window.initializeApp(socket).
// ─────────────────────────────────────────────────────────────────────────────

// ── State management ──────────────────────────────────────────────────────────

const AppState = (() => {
  let _tracks          = [];
  let _filteredTracks  = [];
  let _currentTrack    = null;
  let _playlists       = {};
  let _isPlaying       = false;
  let _isInteracting   = false;
  let _volume          = parseFloat(localStorage.getItem('jamSync_volume') ?? '1');
  let _repeatMode      = localStorage.getItem('jamSync_repeat') || 'none'; // 'none'|'one'|'all'
  let _shuffleEnabled  = localStorage.getItem('jamSync_shuffle') === 'true';
  let _shuffledQueue   = [];
  let _likedTracks     = new Set(JSON.parse(localStorage.getItem('jamSync_liked') || '[]'));
  let _syncThreshold   = 0.5; // seconds drift before hard-sync
  let _lastSyncAt      = 0;

  return {
    /* getters */
    getTracks:        ()         => _tracks,
    getFilteredTracks: ()        => _filteredTracks,
    getCurrentTrack:  ()         => _currentTrack,
    getPlaylists:     ()         => _playlists,
    isPlaying:        ()         => _isPlaying,
    isInteracting:    ()         => _isInteracting,
    getVolume:        ()         => _volume,
    getRepeatMode:    ()         => _repeatMode,
    isShuffleEnabled: ()         => _shuffleEnabled,
    getShuffledQueue: ()         => _shuffledQueue,
    isLiked:          (id)       => _likedTracks.has(id),

    /* setters */
    setTracks(raw) {
      _tracks = raw.map((t, i) => ({
        id:       String(t.id ?? i),
        name:     t.name     || 'Unknown Track',
        artist:   t.artist   || 'JamSync Artist',
        album:    t.album    || '',
        url:      t.url,
        duration: t.duration || 0,
        albumArt: t.albumArt || AppUtils.randomEmoji(),
        likes:    t.likes    || Math.floor(Math.random() * 500) + 50,
      }));
    },

    setFilteredTracks(v) { _filteredTracks = [...v]; },
    setCurrentTrack(v)   { _currentTrack   = v; },
    setPlaylists(v)      { _playlists      = { ...v }; },
    setIsPlaying(v)      { _isPlaying      = !!v; },

    setInteracting(duration = 600) {
      _isInteracting = true;
      clearTimeout(AppState._interactTimer);
      AppState._interactTimer = setTimeout(() => { _isInteracting = false; }, duration);
    },

    setVolume(v) {
      _volume = Math.max(0, Math.min(1, v));
      localStorage.setItem('jamSync_volume', _volume);
    },

    setRepeatMode(mode) {
      if (['none', 'one', 'all'].includes(mode)) {
        _repeatMode = mode;
        localStorage.setItem('jamSync_repeat', mode);
      }
    },

    setShuffleEnabled(v) {
      _shuffleEnabled = !!v;
      localStorage.setItem('jamSync_shuffle', v);
      _shuffledQueue = v ? AppUtils.shuffle([..._tracks]) : [];
    },

    toggleLike(id) {
      if (_likedTracks.has(id)) {
        _likedTracks.delete(id);
      } else {
        _likedTracks.add(id);
      }
      localStorage.setItem('jamSync_liked', JSON.stringify([..._likedTracks]));
      return _likedTracks.has(id);
    },

    shouldSync(serverPos) {
      const audio = DOM.audio;
      if (!audio || _isInteracting) return false;
      const drift = Math.abs(audio.currentTime - serverPos);
      const age   = Date.now() - _lastSyncAt;
      return drift > _syncThreshold && age > 1000;
    },

    markSynced() { _lastSyncAt = Date.now(); },
  };
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

const AppUtils = {
  formatTime(sec) {
    if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  },

  randomEmoji() {
    const pool = ['📀', '🎵', '🎸', '🎹', '🎤', '🥁', '🎧', '💿', '🎺', '🎻'];
    return pool[Math.floor(Math.random() * pool.length)];
  },

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  getNextTrack(currentId) {
    const tracks     = AppState.getTracks();
    const repeat     = AppState.getRepeatMode();
    const shuffle    = AppState.isShuffleEnabled();
    const queue      = AppState.getShuffledQueue();

    if (!tracks.length) return null;
    if (repeat === 'one') return tracks.find(t => t.id === currentId) || null;

    const pool  = (shuffle && queue.length) ? queue : tracks;
    const idx   = pool.findIndex(t => t.id === currentId);
    const next  = (idx === -1) ? 0 : idx + 1;

    if (repeat === 'all' || shuffle) return pool[next % pool.length];
    return pool[next] || null;
  },

  getPrevTrack(currentId) {
    const tracks  = AppState.getTracks();
    const shuffle = AppState.isShuffleEnabled();
    const queue   = AppState.getShuffledQueue();
    if (!tracks.length) return null;

    const pool = (shuffle && queue.length) ? queue : tracks;
    const idx  = pool.findIndex(t => t.id === currentId);
    const prev = (idx <= 0) ? pool.length - 1 : idx - 1;
    return pool[prev] || null;
  },

  updateMediaSession(track, playing) {
    if (!('mediaSession' in navigator)) return;
    if (!track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  track.name,
        artist: track.artist || 'JamSync',
        album:  track.album  || 'JamSync',
      });
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {}
  },
};

// ── DOM cache ─────────────────────────────────────────────────────────────────

const DOM = {
  audio:           document.getElementById('audioPlayer'),
  progressBar:     document.getElementById('songProgress'),
  progressWrap:    document.querySelector('.progress-bar'),
  currentTime:     document.getElementById('currentTime'),
  totalTime:       document.getElementById('totalTime'),
  playPauseBtn:    document.getElementById('playPauseBtn'),
  nextBtn:         document.getElementById('nextBtn'),
  prevBtn:         document.getElementById('prevBtn'),
  shuffleBtn:      document.getElementById('shuffleBtn'),
  repeatBtn:       document.getElementById('repeatBtn'),
  likeBtn:         document.getElementById('likeBtn'),
  volumeSlider:    document.getElementById('volumeSlider'),
  volumeIcon:      document.getElementById('volumeIcon'),
  searchInput:     document.getElementById('searchInput'),
  musicList:       document.getElementById('musicList'),
  addToPlaylist:   document.getElementById('addToPlaylist'),
  playlistSelect:  document.getElementById('playlistSelect'),
  trackName:       document.getElementById('currentTrackName'),
  artistName:      document.getElementById('currentArtist'),
  albumArt:        document.getElementById('playerAlbumArt'),
  mobileNP:        document.querySelector('#nowPlayingMobile span'),
  trackCount:      document.getElementById('trackCount'),
  audioError:      document.getElementById('audioError'),
};

// ── UI Renderer ───────────────────────────────────────────────────────────────

const UI = (() => {
  let activeEl = null;

  function renderTrackList(list) {
    const frag = document.createDocumentFragment();
    const cur  = AppState.getCurrentTrack();
    const playing = AppState.isPlaying();

    list.forEach((track, i) => {
      const el = document.createElement('div');
      el.className  = 'track';
      el.dataset.id = track.id;

      const isCurrent = cur?.id === track.id;
      if (isCurrent) {
        el.classList.add('active');
        if (playing) el.classList.add('playing');
        activeEl = el;
      }

      el.innerHTML = `
        <div class="track-idx">
          <span class="track-num">${i + 1}</span>
          <div class="track-wave">
            <span class="bar"></span><span class="bar"></span>
            <span class="bar"></span><span class="bar"></span>
          </div>
        </div>
        <div class="track-thumb">${track.albumArt}</div>
        <div class="track-info">
          <div class="track-title">${escHtml(track.name)}</div>
          <div class="track-meta">
            <span>${escHtml(track.artist)}</span>
            <span class="dur">${track.duration ? AppUtils.formatTime(track.duration) : '--:--'}</span>
          </div>
        </div>
        <div class="track-likes">
          <i class="${AppState.isLiked(track.id) ? 'fas' : 'far'} fa-heart"></i>
          <span>${track.likes || 0}</span>
        </div>`;

      frag.appendChild(el);
    });

    DOM.musicList.innerHTML = '';
    DOM.musicList.appendChild(frag);
    if (DOM.trackCount) DOM.trackCount.textContent = list.length;
  }

  function updateNowPlaying() {
    const t = AppState.getCurrentTrack();
    if (t) {
      if (DOM.trackName)  DOM.trackName.textContent  = t.name;
      if (DOM.artistName) DOM.artistName.textContent = t.artist || 'JamSync';
      if (DOM.albumArt)   DOM.albumArt.textContent   = t.albumArt || '🎵';
      if (DOM.mobileNP)   DOM.mobileNP.textContent   = t.name;
      updateLikeBtn(t.id);
    } else {
      if (DOM.trackName)  DOM.trackName.textContent  = 'Not Playing';
      if (DOM.artistName) DOM.artistName.textContent = 'Select a track';
      if (DOM.albumArt)   DOM.albumArt.textContent   = '🎵';
      if (DOM.mobileNP)   DOM.mobileNP.textContent   = 'Select a track';
    }
  }

  function updateActiveTrack() {
    if (activeEl) activeEl.classList.remove('active', 'playing');
    const cur = AppState.getCurrentTrack();
    if (!cur) return;
    activeEl = document.querySelector(`.track[data-id="${cur.id}"]`);
    if (activeEl) {
      activeEl.classList.add('active');
      if (AppState.isPlaying()) activeEl.classList.add('playing');
    }
  }

  function updatePlayPause(playing) {
    if (!DOM.playPauseBtn) return;
    DOM.playPauseBtn.innerHTML = playing
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play" style="margin-left:2px"></i>';
  }

  function updateProgress() {
    const a = DOM.audio;
    if (!a?.duration) return;
    const pct = (a.currentTime / a.duration) * 100;
    if (DOM.progressBar)  DOM.progressBar.style.width = `${pct}%`;
    if (DOM.currentTime)  DOM.currentTime.textContent = AppUtils.formatTime(a.currentTime);
  }

  function updateTotalTime(dur) {
    if (DOM.totalTime) DOM.totalTime.textContent = AppUtils.formatTime(dur);
  }

  function updateVolume(v) {
    if (DOM.volumeSlider) DOM.volumeSlider.value = v;
    if (DOM.volumeIcon) {
      DOM.volumeIcon.className = v === 0 ? 'fas fa-volume-off'
                               : v < 0.5 ? 'fas fa-volume-low'
                               : 'fas fa-volume-high';
    }
  }

  function updateShuffle(on) {
    if (DOM.shuffleBtn) {
      DOM.shuffleBtn.classList.toggle('active', on);
      DOM.shuffleBtn.setAttribute('aria-pressed', on);
    }
  }

  function updateRepeat(mode) {
    if (!DOM.repeatBtn) return;
    const icon = DOM.repeatBtn.querySelector('i');
    const active = mode !== 'none';
    DOM.repeatBtn.classList.toggle('active', active);
    DOM.repeatBtn.setAttribute('aria-pressed', active);
    if (icon) {
      icon.className = mode === 'one' ? 'fas fa-1 fa-repeat' : 'fas fa-repeat';
      // note: fa-repeat-1 may not exist in all FA versions
      icon.className = 'fas fa-repeat';
      DOM.repeatBtn.title = `Repeat: ${mode}`;
      DOM.repeatBtn.querySelector('i').style.color = active ? '' : '';
    }
  }

  function updateLikeBtn(trackId) {
    if (!DOM.likeBtn) return;
    const liked = AppState.isLiked(trackId);
    const icon  = DOM.likeBtn.querySelector('i');
    if (icon) icon.className = liked ? 'fas fa-heart' : 'far fa-heart';
    DOM.likeBtn.setAttribute('aria-pressed', liked);
  }

  function updatePlaylistDropdown() {
    if (!DOM.playlistSelect) return;
    const names = Object.keys(AppState.getPlaylists());
    DOM.playlistSelect.innerHTML = names.map(n =>
      `<option value="${escHtml(n)}">${escHtml(n.charAt(0).toUpperCase() + n.slice(1))}</option>`
    ).join('');
  }

  function showError(msg) {
    if (!DOM.audioError) return;
    if (!msg) { DOM.audioError.style.display = 'none'; return; }
    DOM.audioError.style.display = 'inline-flex';
    DOM.audioError.innerHTML = `<i class="fas fa-circle-exclamation" style="font-size:.7rem"></i> ${escHtml(msg)}`;
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    renderTrackList, updateNowPlaying, updateActiveTrack,
    updatePlayPause, updateProgress, updateTotalTime,
    updateVolume, updateShuffle, updateRepeat, updateLikeBtn,
    updatePlaylistDropdown, showError,
  };
})();

// ── Audio Manager ─────────────────────────────────────────────────────────────

const Audio = (() => {
  function init() {
    const a = DOM.audio;
    if (!a) return;

    a.volume = AppState.getVolume();

    a.addEventListener('timeupdate',    onTimeUpdate);
    a.addEventListener('play',          onPlay);
    a.addEventListener('pause',         onPause);
    a.addEventListener('ended',         onEnded);
    a.addEventListener('error',         onError);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('waiting',       () => UI.showError('Buffering…'));
    a.addEventListener('canplay',       () => UI.showError(null));
    a.addEventListener('stalled',       () => UI.showError('Stalled – check connection'));
  }

  function onTimeUpdate() {
    UI.updateProgress();
  }

  function onPlay() {
    AppState.setIsPlaying(true);
    UI.updatePlayPause(true);
    UI.updateActiveTrack();
    AppUtils.updateMediaSession(AppState.getCurrentTrack(), true);
    DOM.albumArt?.classList.add('playing-glow');
  }

  function onPause() {
    AppState.setIsPlaying(false);
    UI.updatePlayPause(false);
    UI.updateActiveTrack();
    AppUtils.updateMediaSession(AppState.getCurrentTrack(), false);
    DOM.albumArt?.classList.remove('playing-glow');
  }

  function onEnded() {
    DOM.albumArt?.classList.remove('playing-glow');
    const cur    = AppState.getCurrentTrack();
    const repeat = AppState.getRepeatMode();

    if (repeat === 'one' && cur) {
      Sock.play(cur.id);
      return;
    }
    const next = AppUtils.getNextTrack(cur?.id);
    if (next) {
      Sock.play(next.id);
    } else {
      Sock.trackEnded();
    }
  }

  function onError(e) {
    const code = DOM.audio?.error?.code;
    const msgs = { 1:'Aborted', 2:'Network error', 3:'Decode error', 4:'Format not supported' };
    UI.showError(`Playback error: ${msgs[code] || 'Unknown'}`);
    console.error('[audio] error code', code, e);

    // Auto-advance after error
    setTimeout(() => {
      const next = AppUtils.getNextTrack(AppState.getCurrentTrack()?.id);
      if (next) Sock.play(next.id);
    }, 1500);
  }

  function onMeta() {
    const a = DOM.audio;
    const t = AppState.getCurrentTrack();
    if (!a || !t) return;
    UI.updateTotalTime(a.duration);
    Sock.duration(t.id, a.duration);
  }

  function loadTrack(track, position = 0, play = false) {
    const a = DOM.audio;
    if (!a || !track?.url) return;

    AppState.setCurrentTrack(track);
    window.__currentTrackId = track.id; // expose for legacy inline script

    a.src = track.url;
    a.load();

    UI.updateNowPlaying();
    UI.updateActiveTrack();

    a.addEventListener('loadedmetadata', function handler() {
      a.removeEventListener('loadedmetadata', handler);
      a.currentTime = Math.max(0, position);
      if (play) a.play().catch(err => console.warn('[audio] autoplay blocked:', err.message));
    }, { once: true });
  }

  function seek(pos) {
    const a = DOM.audio;
    if (!a?.duration) return;
    a.currentTime = Math.max(0, Math.min(pos, a.duration));
  }

  function setVolume(v) {
    const a = DOM.audio;
    if (!a) return;
    AppState.setVolume(v);
    a.volume = AppState.getVolume();
    UI.updateVolume(AppState.getVolume());
  }

  function togglePlay() {
    const a   = DOM.audio;
    const cur = AppState.getCurrentTrack();
    const tracks = AppState.getTracks();

    if (!cur) {
      if (tracks.length) Sock.play(tracks[0].id);
      return;
    }

    AppState.setInteracting();
    if (a.paused) {
      Sock.play(cur.id);
      a.play().catch(err => console.warn('[audio] play blocked:', err.message));
    } else {
      Sock.pause();
      a.pause();
    }
  }

  return { init, loadTrack, seek, setVolume, togglePlay };
})();

// ── Socket communication ──────────────────────────────────────────────────────

// `socket` is injected by initializeApp()
let _socket = null;

const Sock = {
  play(trackId)          { _socket?.emit('play',          { trackId }); },
  pause()                { _socket?.emit('pause'); },
  next()                 { _socket?.emit('next'); },
  previous()             { _socket?.emit('previous'); },
  seek(pos)              { _socket?.emit('seek',          { position: pos }); },
  duration(id, dur)      { _socket?.emit('duration',      { trackId: id, duration: dur }); },
  trackEnded()           { _socket?.emit('track-ended'); },
  addToPlaylist(name,id) { _socket?.emit('add-to-playlist', { playlistName: name, trackId: id }); },

  // ── Listeners ──────────────────────────────────────────────────────────────
  init(socket) {
    _socket = socket;

    socket.on('init', ({ tracks: serverTracks, playlists: serverPlaylists, currentState }) => {
      AppState.setTracks(serverTracks || []);
      AppState.setFilteredTracks(AppState.getTracks());
      AppState.setPlaylists(serverPlaylists || {});

      UI.renderTrackList(AppState.getFilteredTracks());
      UI.updatePlaylistDropdown();

      if (currentState?.currentTrack) {
        Audio.loadTrack(
          currentState.currentTrack,
          currentState.position  || 0,
          currentState.isPlaying || false,
        );
      }

      // Show empty-state message if no tracks
      if (!AppState.getTracks().length) {
        DOM.musicList.innerHTML = `
          <div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:.85rem;line-height:1.7">
            <div style="font-size:2.5rem;margin-bottom:12px">🎵</div>
            No tracks found.<br>
            Add <code style="color:var(--lime)">.mp3</code> files to the <code style="color:var(--lime)">public/music/</code> folder on the server.
          </div>`;
        if (DOM.trackCount) DOM.trackCount.textContent = '0';
      }
    });

    socket.on('track-changed', ({ track, position, isPlaying }) => {
      Audio.loadTrack(track, position, isPlaying);
    });

    socket.on('pause', ({ position }) => {
      if (AppState.isInteracting()) return;
      const a = DOM.audio;
      if (!a) return;
      a.currentTime = position;
      a.pause();
    });

    socket.on('seek', ({ position }) => {
      if (AppState.isInteracting()) return;
      Audio.seek(position);
    });

    socket.on('sync', ({ position, isPlaying, currentTrack }) => {
      // Reconcile track if different
      const cur = AppState.getCurrentTrack();
      if (currentTrack && cur?.id !== currentTrack.id) {
        Audio.loadTrack(currentTrack, position, isPlaying);
        return;
      }

      if (!AppState.shouldSync(position)) return;
      const a = DOM.audio;
      if (!a) return;

      a.currentTime = position;
      if (isPlaying && a.paused)  a.play().catch(() => {});
      if (!isPlaying && !a.paused) a.pause();
      AppState.markSynced();
    });

    socket.on('playlist-updated', ({ playlistName, playlists }) => {
      AppState.setPlaylists(playlists);
      UI.updatePlaylistDropdown();
      const cur = AppState.getCurrentTrack();
      if (cur) {
        // Toast notification
        showToast(`"${cur.name}" added to ${playlistName}`);
      }
    });

    socket.on('room-error', ({ message }) => {
      console.warn('[room] error:', message);
    });
  },
};

// ── Toast notification ────────────────────────────────────────────────────────

function showToast(msg, duration = 2800) {
  let toast = document.getElementById('jsToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'jsToast';
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);
      background:var(--ink3);border:1px solid var(--lime);border-radius:40px;
      padding:10px 22px;font-size:.8rem;color:var(--lime);
      font-family:'Space Mono',monospace;letter-spacing:.05em;
      opacity:0;transition:opacity .2s,transform .2s;z-index:9999;pointer-events:none;
      white-space:nowrap;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(16px)';
  }, duration);
}

// ── Event handlers ────────────────────────────────────────────────────────────

function attachEventHandlers() {
  // Track click
  DOM.musicList?.addEventListener('click', (e) => {
    const el = e.target.closest('.track');
    if (!el) return;
    const track = AppState.getTracks().find(t => t.id === el.dataset.id);
    if (!track) return;

    AppState.setInteracting();
    AppState.setCurrentTrack(track);
    UI.updateNowPlaying();
    UI.updateActiveTrack();
    Sock.play(track.id);
  });

  // Play / Pause
  DOM.playPauseBtn?.addEventListener('click', Audio.togglePlay);

  // Next / Previous
  DOM.nextBtn?.addEventListener('click', () => {
    AppState.setInteracting();
    Sock.next();
  });
  DOM.prevBtn?.addEventListener('click', () => {
    AppState.setInteracting();
    Sock.previous();
  });

  // Shuffle
  DOM.shuffleBtn?.addEventListener('click', () => {
    const on = !AppState.isShuffleEnabled();
    AppState.setShuffleEnabled(on);
    UI.updateShuffle(on);
  });

  // Repeat
  DOM.repeatBtn?.addEventListener('click', () => {
    const modes = ['none', 'one', 'all'];
    const next  = modes[(modes.indexOf(AppState.getRepeatMode()) + 1) % modes.length];
    AppState.setRepeatMode(next);
    UI.updateRepeat(next);
    showToast(`Repeat: ${next}`);
  });

  // Like
  DOM.likeBtn?.addEventListener('click', () => {
    const cur = AppState.getCurrentTrack();
    if (!cur) return;
    const liked = AppState.toggleLike(cur.id);
    UI.updateLikeBtn(cur.id);
    showToast(liked ? '❤️ Liked' : '🤍 Unliked');
  });

  // Volume slider
  DOM.volumeSlider?.addEventListener('input', (e) => {
    Audio.setVolume(parseFloat(e.target.value));
  });

  // Volume icon (mute toggle)
  DOM.volumeIcon?.addEventListener('click', () => {
    const cur = AppState.getVolume();
    DOM.volumeIcon._prevVol = DOM.volumeIcon._prevVol || 1;
    if (cur > 0) {
      DOM.volumeIcon._prevVol = cur;
      Audio.setVolume(0);
    } else {
      Audio.setVolume(DOM.volumeIcon._prevVol);
    }
    if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();
  });

  // Progress bar (click to seek)
  DOM.progressWrap?.addEventListener('click', (e) => {
    const a = DOM.audio;
    if (!AppState.getCurrentTrack() || !a?.duration) return;
    const rect = DOM.progressWrap.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pos  = pct * a.duration;
    AppState.setInteracting();
    Audio.seek(pos);
    Sock.seek(pos);
  });

  // Progress bar (drag to seek)
  let dragging = false;
  DOM.progressWrap?.addEventListener('mousedown', (e) => {
    dragging = true;
    DOM.progressWrap.classList.add('dragging');
    seekFromEvent(e);
  });
  window.addEventListener('mousemove', (e) => { if (dragging) seekFromEvent(e); });
  window.addEventListener('mouseup',   () => {
    if (dragging) { dragging = false; DOM.progressWrap?.classList.remove('dragging'); }
  });
  DOM.progressWrap?.addEventListener('touchstart', (e) => {
    dragging = true;
    seekFromEvent(e.touches[0]);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (dragging) seekFromEvent(e.touches[0]);
  }, { passive: true });
  window.addEventListener('touchend', () => { dragging = false; });

  function seekFromEvent(e) {
    const a    = DOM.audio;
    const wrap = DOM.progressWrap;
    if (!wrap || !a?.duration) return;
    const rect = wrap.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pos  = pct * a.duration;
    AppState.setInteracting(800);
    Audio.seek(pos);
    if (DOM.progressBar) DOM.progressBar.style.width = `${pct * 100}%`;
    if (DOM.currentTime) DOM.currentTime.textContent = AppUtils.formatTime(pos);
    // Throttle seek events to server
    clearTimeout(seekFromEvent._t);
    seekFromEvent._t = setTimeout(() => Sock.seek(pos), 200);
  }

  // Playlist add
  DOM.addToPlaylist?.addEventListener('click', () => {
    const cur  = AppState.getCurrentTrack();
    const name = DOM.playlistSelect?.value;
    if (!cur || !name) return;
    Sock.addToPlaylist(name, cur.id);
  });

  // Search (debounced)
  DOM.searchInput?.addEventListener('input', AppUtils.debounce((e) => {
    const q     = e.target.value.toLowerCase().trim();
    const all   = AppState.getTracks();
    const found = q ? all.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album && t.album.toLowerCase().includes(q))
    ) : [...all];
    AppState.setFilteredTracks(found);
    UI.renderTrackList(found);
  }, 250));

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    switch (e.key) {
      case ' ':          e.preventDefault(); Audio.togglePlay();     break;
      case 'ArrowRight': e.preventDefault(); Sock.next();            break;
      case 'ArrowLeft':  e.preventDefault(); Sock.previous();        break;
      case 'm': case 'M': e.preventDefault(); DOM.volumeIcon?.click(); break;
      case 'ArrowUp':
        e.preventDefault();
        Audio.setVolume(Math.min(1, AppState.getVolume() + 0.1));
        if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();
        break;
      case 'ArrowDown':
        e.preventDefault();
        Audio.setVolume(Math.max(0, AppState.getVolume() - 0.1));
        if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();
        break;
    }
  });

  // Media Session API action handlers
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',         () => { Sock.play(AppState.getCurrentTrack()?.id); });
    navigator.mediaSession.setActionHandler('pause',        () => Sock.pause());
    navigator.mediaSession.setActionHandler('nexttrack',    () => Sock.next());
    navigator.mediaSession.setActionHandler('previoustrack', () => Sock.previous());
  }
}

// ── App entry point (called by auth module in index.html) ─────────────────────

window.initializeApp = function(socket) {
  console.log('[app] Initializing with authenticated socket', socket.id);

  // Wire socket listeners
  Sock.init(socket);

  // Initialize audio engine
  Audio.init();

  // Restore persisted UI state
  UI.updateVolume(AppState.getVolume());
  UI.updateRepeat(AppState.getRepeatMode());
  UI.updateShuffle(AppState.isShuffleEnabled());
  if (DOM.volumeSlider) DOM.volumeSlider.value = AppState.getVolume();

  // Attach all user interaction handlers
  attachEventHandlers();

  console.log('[app] Ready');
};
