const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
const musicList = document.getElementById('musicList');
const playPauseBtn = document.getElementById('playPauseBtn');

// State management
let tracks = [];
let currentTrack = null;
let isUserAction = false;
let lastSyncTime = 0;
let syncTimer = null;

// Initialize
socket.on('init', ({ tracks: serverTracks, currentState }) => {
  tracks = serverTracks;
  renderTrackList();
  
  if (currentState.currentTrack) {
    const track = tracks.find(t => t.id === currentState.currentTrack);
    if (track) {
      currentTrack = track;
      audioPlayer.src = track.url;
      audioPlayer.currentTime = currentState.position;
      
      if (currentState.isPlaying) {
        audioPlayer.play().catch(e => console.log("Autoplay blocked:", e));
      }
      updateUI();
    }
  }
});

// Instant track switching
function playTrack(track) {
  isUserAction = true;
  currentTrack = track;
  audioPlayer.src = track.url;
  audioPlayer.currentTime = 0;
  
  socket.emit('play', {
    trackId: track.id,
    atPosition: 0
  });
  
  audioPlayer.play()
    .then(() => {
      playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
      updateUI();
    })
    .catch(e => console.log("Play error:", e))
    .finally(() => {
      isUserAction = false;
    });
}

// Precise sync handlers
socket.on('play', ({ track, position, timestamp }) => {
  if (isUserAction) return;
  
  clearTimeout(syncTimer);
  const now = Date.now();
  const latency = Math.max(0, now - timestamp);
  const targetTime = position + (latency / 1000);
  
  // Smooth sync with prediction
  if (currentTrack?.id !== track.id) {
    currentTrack = track;
    audioPlayer.src = track.url;
  }
  
  syncTimer = setTimeout(() => {
    audioPlayer.currentTime = targetTime;
    audioPlayer.play()
      .then(() => {
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        updateUI();
      });
  }, 100); // Small delay for network stabilization
});

socket.on('pause', ({ position, timestamp }) => {
  if (isUserAction) return;
  
  clearTimeout(syncTimer);
  const now = Date.now();
  const latency = now - timestamp;
  const targetTime = position + (latency / 1000);
  
  syncTimer = setTimeout(() => {
    audioPlayer.currentTime = targetTime;
    audioPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  }, 100);
});

socket.on('seek', ({ position }) => {
  if (!isUserAction) {
    audioPlayer.currentTime = position;
  }
});

// Heartbeat for continuous sync
socket.on('heartbeat', ({ position, isPlaying }) => {
  if (isUserAction || Date.now() - lastSyncTime < 500) return;
  
  lastSyncTime = Date.now();
  const currentPos = audioPlayer.currentTime;
  
  // Only adjust if significantly out of sync
  if (Math.abs(currentPos - position) > 0.3) {
    audioPlayer.currentTime = position;
  }
  
  // Sync play/pause state
  if (isPlaying && audioPlayer.paused) {
    audioPlayer.play().catch(e => console.log("Sync play error:", e));
  } else if (!isPlaying && !audioPlayer.paused) {
    audioPlayer.pause();
  }
});

// UI controls
playPauseBtn.addEventListener('click', () => {
  isUserAction = true;
  
  if (audioPlayer.paused) {
    socket.emit('play', {
      trackId: currentTrack.id,
      atPosition: audioPlayer.currentTime
    });
    audioPlayer.play()
      .then(() => playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>')
      .catch(e => console.log("Play error:", e));
  } else {
    socket.emit('pause', {
      atPosition: audioPlayer.currentTime
    });
    audioPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  }
  
  setTimeout(() => isUserAction = false, 500);
});

// Track list rendering
function renderTrackList() {
  musicList.innerHTML = '';
  tracks.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track';
    trackEl.innerHTML = `
      <div class="track-info">
        <div class="track-title">${track.name}</div>
      </div>
    `;
    trackEl.addEventListener('click', () => playTrack(track));
    musicList.appendChild(trackEl);
  });
}

function updateUI() {
  // Update now playing info, progress bars, etc.
  // (Keep your existing UI update code)
}

// Initialize
audioPlayer.addEventListener('play', () => {
  if (!isUserAction) return;
  playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
});

audioPlayer.addEventListener('pause', () => {
  if (!isUserAction) return;
  playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
});
