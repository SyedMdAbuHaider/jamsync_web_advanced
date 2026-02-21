const socket = io();

// ============================================================================
// CORE STATE MANAGEMENT (Ready for module separation)
// ============================================================================

const AppState = (() => {
  // Private state
  let _tracks = [];
  let _filteredTracks = [];
  let _currentTrack = null;
  let _playlists = {};
  let _isPlaying = false;
  let _isUserInteracting = false;
  let _volume = 1.0;
  let _repeatMode = 'none'; // 'none', 'one', 'all'
  let _shuffleEnabled = false;
  let _shuffledQueue = [];
  let _likedTracks = new Set(); // Local storage for liked tracks
  let _preloadedAudio = null;
  let _syncDriftThreshold = 0.5;
  let _lastSyncTime = 0;
  let _uiUpdatePending = false;

  // Public API
  return {
    // Getters
    getTracks: () => _tracks,
    getFilteredTracks: () => _filteredTracks,
    getCurrentTrack: () => _currentTrack,
    getPlaylists: () => _playlists,
    isPlaying: () => _isPlaying,
    isUserInteracting: () => _isUserInteracting,
    getVolume: () => _volume,
    getRepeatMode: () => _repeatMode,
    isShuffleEnabled: () => _shuffleEnabled,
    isLiked: (trackId) => _likedTracks.has(trackId),
    getShuffledQueue: () => _shuffledQueue,

    // Setters with change detection
    setTracks: (newTracks) => {
      _tracks = newTracks.map(track => ({
        ...track,
        artist: track.artist || 'JamSync Artist',
        albumArt: track.albumArt || AppUtils.getRandomAlbumArt(),
        likes: track.likes || Math.floor(Math.random() * 500) + 100,
        duration: track.duration || 180
      }));
    },

    setFilteredTracks: (newFilteredTracks) => {
      _filteredTracks = [...newFilteredTracks];
    },

    setCurrentTrack: (track) => {
      _currentTrack = track;
    },

    setPlaylists: (newPlaylists) => {
      _playlists = { ...newPlaylists };
    },

    setIsPlaying: (playing) => {
      _isPlaying = playing;
    },

    setIsUserInteracting: (interacting, duration = 500) => {
      _isUserInteracting = interacting;
      if (interacting) {
        setTimeout(() => {
          _isUserInteracting = false;
        }, duration);
      }
    },

    setVolume: (volume) => {
      _volume = Math.max(0, Math.min(1, volume));
    },

    setRepeatMode: (mode) => {
      if (['none', 'one', 'all'].includes(mode)) {
        _repeatMode = mode;
      }
    },

    setShuffleEnabled: (enabled) => {
      _shuffleEnabled = enabled;
      if (enabled && _tracks.length > 0) {
        _shuffledQueue = AppUtils.shuffleArray([..._tracks]);
      } else {
        _shuffledQueue = [];
      }
    },

    toggleLike: (trackId) => {
      if (_likedTracks.has(trackId)) {
        _likedTracks.delete(trackId);
        return false;
      } else {
        _likedTracks.add(trackId);
        return true;
      }
    },

    setPreloadedAudio: (audio) => {
      _preloadedAudio = audio;
    },

    updateSyncTime: () => {
      _lastSyncTime = Date.now();
    },

    shouldSync: (position) => {
      return !_isUserInteracting && 
             Math.abs(audioPlayer.currentTime - position) > _syncDriftThreshold &&
             (Date.now() - _lastSyncTime) > 1000; // Throttle sync
    }
  };
})();

// ============================================================================
// UTILITY FUNCTIONS (Ready for module separation)
// ============================================================================

const AppUtils = {
  formatTime(seconds) {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  },

  getRandomAlbumArt() {
    const emojis = ['📀', '🎵', '🎸', '🎹', '🎤', '🥁', '🎧', '💿'];
    return emojis[Math.floor(Math.random() * emojis.length)];
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  },

  getNextTrack(currentTrackId, tracks, repeatMode, shuffleEnabled, shuffledQueue) {
    if (!tracks.length) return null;
    
    if (repeatMode === 'one') return tracks.find(t => t.id === currentTrackId);
    
    if (shuffleEnabled && shuffledQueue.length) {
      const currentIndex = shuffledQueue.findIndex(t => t.id === currentTrackId);
      if (currentIndex === -1) return shuffledQueue[0];
      return shuffledQueue[(currentIndex + 1) % shuffledQueue.length];
    }
    
    const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
    if (currentIndex === -1) return tracks[0];
    
    if (repeatMode === 'all') {
      return tracks[(currentIndex + 1) % tracks.length];
    }
    
    return tracks[currentIndex + 1] || null;
  },

  getPreviousTrack(currentTrackId, tracks, shuffleEnabled, shuffledQueue) {
    if (!tracks.length) return null;
    
    if (shuffleEnabled && shuffledQueue.length) {
      const currentIndex = shuffledQueue.findIndex(t => t.id === currentTrackId);
      if (currentIndex <= 0) return shuffledQueue[shuffledQueue.length - 1];
      return shuffledQueue[currentIndex - 1];
    }
    
    const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
    if (currentIndex <= 0) return tracks[tracks.length - 1];
    return tracks[currentIndex - 1];
  },

  preloadTrack(track) {
    if (!track?.url) return null;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = track.url;
    return audio;
  },

  // Media Session API support
  updateMediaSession(track, isPlaying) {
    if (!('mediaSession' in navigator)) return;
    
    if (track) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: track.artist || 'JamSync Artist',
        album: 'JamSync',
        artwork: track.albumArt ? [{ src: track.albumArt, sizes: '96x96', type: 'image/png' }] : []
      });
      
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  },

  handleAudioError(error, fallbackTrack = null) {
    console.error('Audio error:', error);
    
    if (fallbackTrack) {
      setTimeout(() => {
        SocketManager.emitPlay({ trackId: fallbackTrack.id });
      }, 1000);
    }
    
    // Show user-friendly error (could be expanded)
    const errorEl = document.getElementById('audioError');
    if (errorEl) {
      errorEl.textContent = 'Playback error. Trying next track...';
      errorEl.style.display = 'block';
      setTimeout(() => {
        errorEl.style.display = 'none';
      }, 3000);
    }
  }
};

// ============================================================================
// DOM ELEMENTS CACHE (Optimized queries)
// ============================================================================

const DOM = {
  audioPlayer: document.getElementById('audioPlayer'),
  progressBar: document.getElementById('songProgress'),
  currentTimeEl: document.getElementById('currentTime'),
  totalTimeEl: document.getElementById('totalTime'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  nextBtn: document.getElementById('nextBtn'),
  prevBtn: document.getElementById('prevBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  repeatBtn: document.getElementById('repeatBtn'),
  volumeSlider: document.getElementById('volumeSlider'),
  volumeIcon: document.getElementById('volumeIcon'),
  searchInput: document.getElementById('searchInput'),
  musicList: document.getElementById('musicList'),
  addToPlaylistBtn: document.getElementById('addToPlaylist'),
  playlistSelect: document.getElementById('playlistSelect'),
  currentTrackName: document.getElementById('currentTrackName'),
  currentArtist: document.getElementById('currentArtist'),
  playerAlbumArt: document.getElementById('playerAlbumArt'),
  nowPlayingMobile: document.querySelector('#nowPlayingMobile span'),
  progressContainer: document.querySelector('.progress-bar'),
  trackCount: document.getElementById('trackCount'),
  likeBtn: document.getElementById('likeBtn'),
  volumeContainer: document.querySelector('.volume-control'),
  audioError: document.getElementById('audioError')
};

// ============================================================================
// UI RENDERER (Targeted updates only)
// ============================================================================

const UIRenderer = (() => {
  let activeTrackElement = null;
  
  function updateActiveTrackElement() {
    const currentTrack = AppState.getCurrentTrack();
    if (!currentTrack) return;
    
    // Remove active class from previous active track
    if (activeTrackElement) {
      activeTrackElement.classList.remove('active', 'playing');
    }
    
    // Find and update new active track
    activeTrackElement = document.querySelector(`.track[data-id="${currentTrack.id}"]`);
    if (activeTrackElement) {
      activeTrackElement.classList.add('active');
      if (AppState.isPlaying()) {
        activeTrackElement.classList.add('playing');
      }
    }
  }

  function renderTrackList(trackList) {
    const musicList = DOM.musicList;
    if (!musicList) return;
    
    const fragment = document.createDocumentFragment();
    const currentTrack = AppState.getCurrentTrack();
    const isPlaying = AppState.isPlaying();
    
    trackList.forEach((track, index) => {
      const trackEl = document.createElement('div');
      trackEl.className = 'track';
      if (currentTrack?.id === track.id) {
        trackEl.classList.add('active');
        if (isPlaying) {
          trackEl.classList.add('playing');
        }
        activeTrackElement = trackEl;
      }
      trackEl.dataset.id = track.id;
      
      trackEl.innerHTML = `
        <div class="track-idx">
          <span class="track-num">${index + 1}</span>
          <div class="track-wave">
            <span class="bar"></span>
            <span class="bar"></span>
            <span class="bar"></span>
            <span class="bar"></span>
          </div>
        </div>
        <div class="track-thumb">${track.albumArt || '🎵'}</div>
        <div class="track-info">
          <div class="track-title">${track.name}</div>
          <div class="track-meta">
            <span>${track.artist || 'Unknown Artist'}</span>
            <span class="dur">${track.duration ? AppUtils.formatTime(track.duration) : '--:--'}</span>
          </div>
        </div>
        <div class="track-likes">
          <i class="fa-${AppState.isLiked(track.id) ? 'solid' : 'regular'} fa-heart"></i>
          <span>${track.likes || 0}</span>
        </div>
      `;
      
      fragment.appendChild(trackEl);
    });
    
    // Batch DOM update
    musicList.innerHTML = '';
    musicList.appendChild(fragment);
    
    // Update track count
    if (DOM.trackCount) {
      DOM.trackCount.textContent = trackList.length;
    }
  }

  function updateNowPlayingUI() {
    const currentTrack = AppState.getCurrentTrack();
    
    if (currentTrack) {
      // Desktop
      if (DOM.currentTrackName) DOM.currentTrackName.textContent = currentTrack.name;
      if (DOM.currentArtist) DOM.currentArtist.textContent = currentTrack.artist || 'JamSync';
      
      // Mobile
      if (DOM.nowPlayingMobile) DOM.nowPlayingMobile.textContent = currentTrack.name;
      
      // Album art
      if (DOM.playerAlbumArt) DOM.playerAlbumArt.textContent = currentTrack.albumArt || '🎵';
      
      // Like button
      if (DOM.likeBtn) {
        const icon = DOM.likeBtn.querySelector('i');
        if (icon) {
          icon.className = AppState.isLiked(currentTrack.id) ? 'fas fa-heart' : 'far fa-heart';
        }
      }
    } else {
      if (DOM.currentTrackName) DOM.currentTrackName.textContent = 'Not Playing';
      if (DOM.currentArtist) DOM.currentArtist.textContent = 'Select a track';
      if (DOM.nowPlayingMobile) DOM.nowPlayingMobile.textContent = 'Select a track';
      if (DOM.playerAlbumArt) DOM.playerAlbumArt.textContent = '🎵';
    }
  }

  function updatePlayPauseButton(isPlaying) {
    if (DOM.playPauseBtn) {
      DOM.playPauseBtn.innerHTML = isPlaying ? 
        '<i class="fas fa-pause"></i>' : 
        '<i class="fas fa-play" style="margin-left:2px;"></i>';
    }
  }

  function updateProgressBar() {
    const audioPlayer = DOM.audioPlayer;
    if (!audioPlayer || !audioPlayer.duration) return;
    
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    if (DOM.progressBar) {
      DOM.progressBar.style.width = `${progress}%`;
    }
    if (DOM.currentTimeEl) {
      DOM.currentTimeEl.textContent = AppUtils.formatTime(audioPlayer.currentTime);
    }
  }

  function updateTotalTime(duration) {
    if (DOM.totalTimeEl) {
      DOM.totalTimeEl.textContent = AppUtils.formatTime(duration);
    }
  }

  function updatePlaylistDropdown() {
    if (!DOM.playlistSelect) return;
    
    const playlists = AppState.getPlaylists();
    DOM.playlistSelect.innerHTML = '';
    
    Object.keys(playlists).forEach(playlistName => {
      const option = document.createElement('option');
      option.value = playlistName;
      option.textContent = playlistName.charAt(0).toUpperCase() + playlistName.slice(1);
      DOM.playlistSelect.appendChild(option);
    });
  }

  function updateVolumeUI(volume) {
    if (DOM.volumeSlider) {
      DOM.volumeSlider.value = volume * 100;
    }
    if (DOM.volumeIcon) {
      if (volume === 0) {
        DOM.volumeIcon.className = 'fas fa-volume-mute';
      } else if (volume < 0.5) {
        DOM.volumeIcon.className = 'fas fa-volume-down';
      } else {
        DOM.volumeIcon.className = 'fas fa-volume-up';
      }
    }
  }

  function updateRepeatButton(mode) {
    if (!DOM.repeatBtn) return;
    
    const icon = DOM.repeatBtn.querySelector('i');
    if (icon) {
      switch(mode) {
        case 'one':
          icon.className = 'fas fa-repeat-1';
          DOM.repeatBtn.classList.add('active');
          break;
        case 'all':
          icon.className = 'fas fa-repeat';
          DOM.repeatBtn.classList.add('active');
          break;
        default:
          icon.className = 'fas fa-repeat';
          DOM.repeatBtn.classList.remove('active');
      }
    }
  }

  function updateShuffleButton(enabled) {
    if (DOM.shuffleBtn) {
      if (enabled) {
        DOM.shuffleBtn.classList.add('active');
      } else {
        DOM.shuffleBtn.classList.remove('active');
      }
    }
  }

  return {
    renderTrackList,
    updateNowPlayingUI,
    updatePlayPauseButton,
    updateProgressBar,
    updateTotalTime,
    updatePlaylistDropdown,
    updateVolumeUI,
    updateRepeatButton,
    updateShuffleButton,
    updateActiveTrackElement
  };
})();

// ============================================================================
// AUDIO PLAYER MANAGER
// ============================================================================

const AudioManager = (() => {
  function init() {
    const audioPlayer = DOM.audioPlayer;
    if (!audioPlayer) return;
    
    // Set initial volume
    audioPlayer.volume = AppState.getVolume();
    
    // Event listeners
    audioPlayer.addEventListener('timeupdate', onTimeUpdate);
    audioPlayer.addEventListener('play', onPlay);
    audioPlayer.addEventListener('pause', onPause);
    audioPlayer.addEventListener('ended', onEnded);
    audioPlayer.addEventListener('error', onError);
    audioPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
    audioPlayer.addEventListener('waiting', onWaiting);
    audioPlayer.addEventListener('canplay', onCanPlay);
  }

  function onTimeUpdate() {
    UIRenderer.updateProgressBar();
    
    // Sync with server periodically
    const audioPlayer = DOM.audioPlayer;
    if (!AppState.isUserInteracting() && 
        audioPlayer.currentTime % 5 < 0.1 && // Every ~5 seconds
        AppState.getCurrentTrack()) {
      SocketManager.emitSync(audioPlayer.currentTime, !audioPlayer.paused);
      AppState.updateSyncTime();
    }
  }

  function onPlay() {
    AppState.setIsPlaying(true);
    UIRenderer.updatePlayPauseButton(true);
    UIRenderer.updateActiveTrackElement();
    AppUtils.updateMediaSession(AppState.getCurrentTrack(), true);
    
    // Preload next track
    const currentTrack = AppState.getCurrentTrack();
    if (currentTrack) {
      const nextTrack = AppUtils.getNextTrack(
        currentTrack.id,
        AppState.getTracks(),
        AppState.getRepeatMode(),
        AppState.isShuffleEnabled(),
        AppState.getShuffledQueue()
      );
      if (nextTrack) {
        const preloaded = AppUtils.preloadTrack(nextTrack);
        AppState.setPreloadedAudio(preloaded);
      }
    }
  }

  function onPause() {
    AppState.setIsPlaying(false);
    UIRenderer.updatePlayPauseButton(false);
    UIRenderer.updateActiveTrackElement();
    AppUtils.updateMediaSession(AppState.getCurrentTrack(), false);
  }

  function onEnded() {
    const currentTrack = AppState.getCurrentTrack();
    const tracks = AppState.getTracks();
    const repeatMode = AppState.getRepeatMode();
    const shuffleEnabled = AppState.isShuffleEnabled();
    const shuffledQueue = AppState.getShuffledQueue();
    
    if (repeatMode === 'one') {
      // Replay current track
      SocketManager.emitPlay({ trackId: currentTrack.id });
    } else {
      const nextTrack = AppUtils.getNextTrack(
        currentTrack?.id,
        tracks,
        repeatMode,
        shuffleEnabled,
        shuffledQueue
      );
      
      if (nextTrack) {
        SocketManager.emitPlay({ trackId: nextTrack.id });
      } else {
        SocketManager.emitTrackEnded();
      }
    }
  }

  function onError(e) {
    const currentTrack = AppState.getCurrentTrack();
    const tracks = AppState.getTracks();
    
    // Try to play next track as fallback
    if (currentTrack) {
      const nextTrack = AppUtils.getNextTrack(
        currentTrack.id,
        tracks,
        'all',
        false,
        []
      );
      AppUtils.handleAudioError(e, nextTrack);
    }
  }

  function onLoadedMetadata() {
    const audioPlayer = DOM.audioPlayer;
    if (!audioPlayer) return;
    
    const currentTrack = AppState.getCurrentTrack();
    if (currentTrack) {
      SocketManager.emitDuration(currentTrack.id, audioPlayer.duration);
      UIRenderer.updateTotalTime(audioPlayer.duration);
    }
  }

  function onWaiting() {
    // Show buffering indicator
    if (DOM.audioError) {
      DOM.audioError.textContent = 'Buffering...';
      DOM.audioError.style.display = 'block';
    }
  }

  function onCanPlay() {
    if (DOM.audioError) {
      DOM.audioError.style.display = 'none';
    }
  }

  function loadTrack(track, position = 0, shouldPlay = false) {
    const audioPlayer = DOM.audioPlayer;
    if (!audioPlayer || !track) return;
    
    AppState.setCurrentTrack(track);
    audioPlayer.src = track.url;
    
    // Immediate UI update
    UIRenderer.updateNowPlayingUI();
    UIRenderer.updateActiveTrackElement();
    
    audioPlayer.onloadedmetadata = () => {
      audioPlayer.currentTime = position;
      UIRenderer.updateTotalTime(audioPlayer.duration);
      
      if (shouldPlay) {
        audioPlayer.play().catch(e => AppUtils.handleAudioError(e));
      }
    };
  }

  function seek(position) {
    const audioPlayer = DOM.audioPlayer;
    if (!audioPlayer || !audioPlayer.duration) return;
    
    const seekTime = Math.max(0, Math.min(position, audioPlayer.duration));
    const wasPlaying = !audioPlayer.paused;
    
    if (wasPlaying) {
      audioPlayer.pause();
    }
    
    audioPlayer.currentTime = seekTime;
    
    if (wasPlaying) {
      audioPlayer.play().catch(e => AppUtils.handleAudioError(e));
    }
  }

  function setVolume(volume) {
    const audioPlayer = DOM.audioPlayer;
    if (!audioPlayer) return;
    
    AppState.setVolume(volume);
    audioPlayer.volume = volume;
    UIRenderer.updateVolumeUI(volume);
  }

  function togglePlay() {
    const audioPlayer = DOM.audioPlayer;
    const currentTrack = AppState.getCurrentTrack();
    
    if (!currentTrack) {
      const tracks = AppState.getTracks();
      if (tracks.length > 0) {
        SocketManager.emitPlay({ trackId: tracks[0].id });
      }
      return;
    }
    
    AppState.setIsUserInteracting(true);
    
    if (audioPlayer.paused) {
      SocketManager.emitPlay({ trackId: currentTrack.id });
      audioPlayer.play().catch(e => AppUtils.handleAudioError(e));
    } else {
      SocketManager.emitPause();
      audioPlayer.pause();
    }
  }

  return {
    init,
    loadTrack,
    seek,
    setVolume,
    togglePlay
  };
})();

// ============================================================================
// SOCKET MANAGER
// ============================================================================

const SocketManager = (() => {
  function emitPlay({ trackId }) {
    socket.emit('play', { trackId });
  }

  function emitPause() {
    socket.emit('pause');
  }

  function emitNext() {
    socket.emit('next');
  }

  function emitPrevious() {
    socket.emit('previous');
  }

  function emitSeek(position) {
    socket.emit('seek', { position });
  }

  function emitSync(position, isPlaying) {
    socket.emit('sync', { position, isPlaying });
  }

  function emitDuration(trackId, duration) {
    socket.emit('duration', { trackId, duration });
  }

  function emitTrackEnded() {
    socket.emit('track-ended');
  }

  function emitAddToPlaylist(playlistName, trackId) {
    socket.emit('add-to-playlist', { playlistName, trackId });
  }

  function init() {
    // Initialize socket listeners
    socket.on('init', handleInit);
    socket.on('track-changed', handleTrackChanged);
    socket.on('pause', handlePause);
    socket.on('seek', handleSeek);
    socket.on('sync', handleSync);
    socket.on('playlist-updated', handlePlaylistUpdated);
  }

  function handleInit({ tracks: serverTracks, playlists: serverPlaylists, currentState }) {
    AppState.setTracks(serverTracks);
    AppState.setFilteredTracks(AppState.getTracks());
    AppState.setPlaylists(serverPlaylists);
    
    UIRenderer.renderTrackList(AppState.getFilteredTracks());
    UIRenderer.updatePlaylistDropdown();
    
    if (currentState?.currentTrack) {
      AudioManager.loadTrack(
        currentState.currentTrack,
        currentState.position || 0,
        currentState.isPlaying || false
      );
    }
  }

  function handleTrackChanged({ track, position, isPlaying }) {
    AudioManager.loadTrack(track, position, isPlaying);
  }

  function handlePause({ position }) {
    if (AppState.isUserInteracting()) return;
    
    const audioPlayer = DOM.audioPlayer;
    audioPlayer.currentTime = position;
    audioPlayer.pause();
  }

  function handleSeek({ position }) {
    if (AppState.isUserInteracting()) return;
    
    DOM.audioPlayer.currentTime = position;
  }

  function handleSync({ position, isPlaying }) {
    if (!AppState.shouldSync(position)) return;
    
    const audioPlayer = DOM.audioPlayer;
    audioPlayer.currentTime = position;
    
    if (isPlaying && audioPlayer.paused) {
      audioPlayer.play().catch(e => AppUtils.handleAudioError(e));
    } else if (!isPlaying && !audioPlayer.paused) {
      audioPlayer.pause();
    }
    
    AppState.updateSyncTime();
  }

  function handlePlaylistUpdated({ playlistName, playlists: updatedPlaylists }) {
    AppState.setPlaylists(updatedPlaylists);
    
    const currentTrack = AppState.getCurrentTrack();
    if (currentTrack) {
      alert(`"${currentTrack.name}" added to ${playlistName} playlist!`);
    }
  }

  return {
    init,
    emitPlay,
    emitPause,
    emitNext,
    emitPrevious,
    emitSeek,
    emitSync,
    emitDuration,
    emitTrackEnded,
    emitAddToPlaylist
  };
})();

// ============================================================================
// EVENT HANDLERS
// ============================================================================

// Search handler with debounce
if (DOM.searchInput) {
  DOM.searchInput.addEventListener('input', AppUtils.debounce((e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    const tracks = AppState.getTracks();
    
    let filtered;
    if (searchTerm === '') {
      filtered = [...tracks];
    } else {
      filtered = tracks.filter(track => 
        track.name.toLowerCase().includes(searchTerm) ||
        (track.artist && track.artist.toLowerCase().includes(searchTerm))
      );
    }
    
    AppState.setFilteredTracks(filtered);
    UIRenderer.renderTrackList(filtered);
  }, 300));
}

// Track click handler
if (DOM.musicList) {
  DOM.musicList.addEventListener('click', (e) => {
    const trackEl = e.target.closest('.track');
    if (!trackEl) return;
    
    const trackId = trackEl.dataset.id;
    const track = AppState.getTracks().find(t => t.id === trackId);
    if (!track) return;
    
    AppState.setIsUserInteracting(true);
    AppState.setCurrentTrack(track);
    
    UIRenderer.updateNowPlayingUI();
    UIRenderer.updateActiveTrackElement();
    
    SocketManager.emitPlay({ trackId: track.id });
  });
}

// Like button handler
if (DOM.likeBtn) {
  DOM.likeBtn.addEventListener('click', () => {
    const currentTrack = AppState.getCurrentTrack();
    if (!currentTrack) return;
    
    const isLiked = AppState.toggleLike(currentTrack.id);
    
    const icon = DOM.likeBtn.querySelector('i');
    if (icon) {
      icon.className = isLiked ? 'fas fa-heart' : 'far fa-heart';
    }
    
    // Update track list like icon
    const trackElement = document.querySelector(`.track[data-id="${currentTrack.id}"] .track-likes i`);
    if (trackElement) {
      trackElement.className = isLiked ? 'fas fa-heart' : 'far fa-heart';
    }
  });
}

// Playlist add handler
if (DOM.addToPlaylistBtn) {
  DOM.addToPlaylistBtn.addEventListener('click', () => {
    const currentTrack = AppState.getCurrentTrack();
    if (!currentTrack) return;
    
    const playlistName = DOM.playlistSelect?.value;
    if (playlistName) {
      SocketManager.emitAddToPlaylist(playlistName, currentTrack.id);
    }
  });
}

// Player control handlers
if (DOM.playPauseBtn) {
  DOM.playPauseBtn.addEventListener('click', AudioManager.togglePlay);
}

if (DOM.nextBtn) {
  DOM.nextBtn.addEventListener('click', () => {
    AppState.setIsUserInteracting(true);
    SocketManager.emitNext();
  });
}

if (DOM.prevBtn) {
  DOM.prevBtn.addEventListener('click', () => {
    AppState.setIsUserInteracting(true);
    SocketManager.emitPrevious();
  });
}

// Shuffle handler
if (DOM.shuffleBtn) {
  DOM.shuffleBtn.addEventListener('click', () => {
    const enabled = !AppState.isShuffleEnabled();
    AppState.setShuffleEnabled(enabled);
    UIRenderer.updateShuffleButton(enabled);
  });
}

// Repeat handler
if (DOM.repeatBtn) {
  DOM.repeatBtn.addEventListener('click', () => {
    const modes = ['none', 'one', 'all'];
    const currentMode = AppState.getRepeatMode();
    const nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
    
    AppState.setRepeatMode(nextMode);
    UIRenderer.updateRepeatButton(nextMode);
  });
}

// Volume handler
if (DOM.volumeSlider) {
  DOM.volumeSlider.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value, 10) / 100;
    AudioManager.setVolume(volume);
  });
}

if (DOM.volumeIcon) {
  DOM.volumeIcon.addEventListener('click', () => {
    const currentVolume = AppState.getVolume();
    AudioManager.setVolume(currentVolume > 0 ? 0 : 1);
  });
}

// Progress bar handler
if (DOM.progressContainer) {
  DOM.progressContainer.addEventListener('click', (e) => {
    const audioPlayer = DOM.audioPlayer;
    if (!AppState.getCurrentTrack() || !audioPlayer?.duration) return;
    
    const rect = DOM.progressContainer.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const seekTime = percent * audioPlayer.duration;
    
    AppState.setIsUserInteracting(true);
    AudioManager.seek(seekTime);
    SocketManager.emitSeek(seekTime);
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeApp() {
  // Initialize managers
  AudioManager.init();
  SocketManager.init();
  
  // Set initial UI states
  UIRenderer.updateVolumeUI(AppState.getVolume());
  UIRenderer.updateRepeatButton(AppState.getRepeatMode());
  UIRenderer.updateShuffleButton(AppState.isShuffleEnabled());
  
  // Add sample data fallback
  setTimeout(() => {
    if (AppState.getTracks().length === 0) {
      console.log('No tracks received from server, loading sample data');
      const sampleTracks = [
        {
          id: '1',
          name: 'Bohemian Rhapsody',
          artist: 'Queen',
          url: '/audio/bohemian-rhapsody.mp3',
          duration: 355,
          albumArt: '🎸',
          likes: 1234
        },
        {
          id: '2',
          name: 'Stairway to Heaven',
          artist: 'Led Zeppelin',
          url: '/audio/stairway-to-heaven.mp3',
          duration: 482,
          albumArt: '🎸',
          likes: 987
        },
        {
          id: '3',
          name: 'Imagine',
          artist: 'John Lennon',
          url: '/audio/imagine.mp3',
          duration: 183,
          albumArt: '🎹',
          likes: 756
        }
      ];
      
      AppState.setTracks(sampleTracks);
      AppState.setFilteredTracks(sampleTracks);
      UIRenderer.renderTrackList(sampleTracks);
    }
  }, 2000);
}

// Start the app
initializeApp();
