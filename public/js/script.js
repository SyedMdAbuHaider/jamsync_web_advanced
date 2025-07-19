const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
const progressBar = document.getElementById('songProgress');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const playPauseBtn = document.getElementById('playPauseBtn');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');

// State management
let tracks = [];
let currentTrack = null;
let isUserInteracting = false;
let wasPlayingBeforeAction = false;

// Initialize
socket.on('init', ({ tracks: serverTracks, currentState }) => {
  tracks = serverTracks;
  renderTrackList();
  
  if (currentState.currentTrack) {
    loadTrack(currentState.currentTrack, currentState.position, currentState.isPlaying);
  }
});

// Track loading with queue support
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
    updateUI();
  };
  
  audioPlayer.onerror = () => {
    console.error("Error loading track:", track.url);
  };
}

// Sync handlers
socket.on('track-changed', ({ track, position, isPlaying }) => {
  loadTrack(track, position, isPlaying);
});

socket.on('pause', ({ position }) => {
  if (isUserInteracting) return;
  audioPlayer.currentTime = position;
  audioPlayer.pause();
  updatePlayState(false);
});

socket.on('seek', ({ position }) => {
  if (isUserInteracting) return;
  audioPlayer.currentTime = position;
});

socket.on('sync', ({ position, isPlaying }) => {
  if (isUserInteracting) return;
  
  // Only adjust if significantly out of sync (>500ms)
  if (Math.abs(audioPlayer.currentTime - position) > 0.5) {
    audioPlayer.currentTime = position;
  }
  
  // Sync play/pause state
  if (isPlaying && audioPlayer.paused) {
    audioPlayer.play().catch(e => console.log("Sync play error:", e));
  } else if (!isPlaying && !audioPlayer.paused) {
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
  socket.emit('track-ended');
});

// Progress bar interaction
progressBar.parentElement.addEventListener('click', (e) => {
  if (!currentTrack) return;
  
  const percent = e.offsetX / e.target.clientWidth;
  const seekTime = percent * audioPlayer.duration;
  
  isUserInteracting = true;
  wasPlayingBeforeAction = !audioPlayer.paused;
  
  if (wasPlayingBeforeAction) {
    audioPlayer.pause();
  }
  
  audioPlayer.currentTime = seekTime;
  
  socket.emit('seek', {
    position: seekTime
  });
  
  setTimeout(() => {
    isUserInteracting = false;
    if (wasPlayingBeforeAction) {
      audioPlayer.play().catch(e => console.log("Play error:", e));
    }
  }, 500);
});

// Control functions
function updatePlayState(isPlaying) {
  playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
}

function updateUI() {
  if (currentTrack) {
    document.getElementById('currentTrackName').textContent = currentTrack.name;
    document.getElementById('currentArtist').textContent = 'JamSync';
    document.getElementById('nowPlayingMobile').textContent = currentTrack.name;
    
    // Highlight current track in list
    document.querySelectorAll('.track').forEach(el => el.classList.remove('active'));
    const currentTrackEl = document.querySelector(`.track[data-id="${currentTrack.id}"]`);
    if (currentTrackEl) currentTrackEl.classList.add('active');
  }
}

// Button handlers
playPauseBtn.addEventListener('click', () => {
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

nextBtn.addEventListener('click', () => {
  isUserInteracting = true;
  socket.emit('next');
  setTimeout(() => isUserInteracting = false, 500);
});

prevBtn.addEventListener('click', () => {
  isUserInteracting = true;
  socket.emit('previous');
  setTimeout(() => isUserInteracting = false, 500);
});

// Track list rendering
function renderTrackList() {
  const musicList = document.getElementById('musicList');
  musicList.innerHTML = '';
  
  tracks.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track';
    trackEl.dataset.id = track.id;
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

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
