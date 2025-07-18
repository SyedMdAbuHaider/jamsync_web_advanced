const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
const progressBar = document.getElementById('songProgress');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');

// State management
let tracks = [];
let currentTrack = null;
let isUserInteracting = false;
let lastServerUpdate = 0;
let seekTimeout = null;
let wasPlayingBeforeSeek = false;

// Initialize
socket.on('init', ({ tracks: serverTracks, currentState }) => {
  tracks = serverTracks;
  renderTrackList();
  
  if (currentState.currentTrack) {
    loadTrack(currentState.currentTrack, currentState.position, currentState.isPlaying);
  }
});

// Instant track loading
function loadTrack(track, position = 0, shouldPlay = false) {
  currentTrack = track;
  audioPlayer.src = track.url;
  
  audioPlayer.onloadedmetadata = () => {
    socket.emit('duration', {
      trackId: track.id,
      duration: audioPlayer.duration
    });
    
    totalTimeEl.textContent = formatTime(audioPlayer.duration);
    audioPlayer.currentTime = position;
    
    if (shouldPlay) {
      audioPlayer.play()
        .then(() => updatePlayState(true))
        .catch(e => console.log("Play error:", e));
    }
  };
  
  audioPlayer.onerror = () => {
    console.error("Error loading track:", track.url);
  };
}

// Sync handlers
socket.on('play', ({ track, timestamp }) => {
  if (isUserInteracting) return;
  
  loadTrack(track, 0, true);
  updateUI();
});

socket.on('pause', ({ position, timestamp }) => {
  if (isUserInteracting) return;
  
  audioPlayer.currentTime = position;
  audioPlayer.pause();
  updatePlayState(false);
});

socket.on('seek', ({ position, timestamp }) => {
  if (isUserInteracting) return;
  
  clearTimeout(seekTimeout);
  audioPlayer.currentTime = position;
});

socket.on('sync', ({ position, isPlaying, currentTrack, timestamp }) => {
  // Only sync if significantly out of sync (>500ms)
  if (Math.abs(audioPlayer.currentTime - position) > 0.5 && !isUserInteracting) {
    audioPlayer.currentTime = position;
  }
  
  // Sync play/pause state
  if (isPlaying && audioPlayer.paused && !isUserInteracting) {
    audioPlayer.play().catch(e => console.log("Sync play error:", e));
  } else if (!isPlaying && !audioPlayer.paused && !isUserInteracting) {
    audioPlayer.pause();
  }
});

// Player event handlers
audioPlayer.addEventListener('timeupdate', () => {
  const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100 || 0;
  progressBar.style.width = `${progress}%`;
  currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
});

audioPlayer.addEventListener('ended', () => {
  socket.emit('next');
});

progressBar.parentElement.addEventListener('click', (e) => {
  if (!currentTrack) return;
  
  const percent = e.offsetX / e.target.clientWidth;
  const seekTime = percent * audioPlayer.duration;
  
  wasPlayingBeforeSeek = !audioPlayer.paused;
  isUserInteracting = true;
  
  clearTimeout(seekTimeout);
  audioPlayer.currentTime = seekTime;
  
  socket.emit('seek', {
    position: seekTime
  });
  
  seekTimeout = setTimeout(() => {
    isUserInteracting = false;
    if (wasPlayingBeforeSeek) {
      audioPlayer.play().catch(e => console.log("Play error:", e));
    }
  }, 500);
});

// Control functions
function updatePlayState(isPlaying) {
  const playPauseBtn = document.getElementById('playPauseBtn');
  playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
}

function updateUI() {
  if (currentTrack) {
    document.getElementById('currentTrackName').textContent = currentTrack.name;
    document.getElementById('currentArtist').textContent = 'JamSync';
    document.getElementById('nowPlayingMobile').textContent = currentTrack.name;
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// UI event handlers
document.getElementById('playPauseBtn').addEventListener('click', () => {
  isUserInteracting = true;
  
  if (audioPlayer.paused) {
    socket.emit('play', {
      trackId: currentTrack.id
    });
    audioPlayer.play()
      .then(() => updatePlayState(true))
      .catch(e => console.log("Play error:", e));
  } else {
    socket.emit('pause');
    audioPlayer.pause();
    updatePlayState(false);
  }
  
  setTimeout(() => isUserInteracting = false, 500);
});

// Track list rendering
function renderTrackList() {
  const musicList = document.getElementById('musicList');
  musicList.innerHTML = '';
  
  tracks.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track';
    trackEl.innerHTML = `
      <div class="track-info">
        <div class="track-title">${track.name}</div>
      </div>
    `;
    trackEl.addEventListener('click', () => {
      socket.emit('play', {
        trackId: track.id
      });
    });
    musicList.appendChild(trackEl);
  });
}
