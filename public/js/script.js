const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
const progressBar = document.getElementById('songProgress');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const playPauseBtn = document.getElementById('playPauseBtn');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const searchInput = document.getElementById('searchInput');
const musicList = document.getElementById('musicList');
const addToPlaylistBtn = document.getElementById('addToPlaylist');
const playlistSelect = document.getElementById('playlistSelect');

// State management
let tracks = [];
let filteredTracks = [];
let currentTrack = null;
let isUserInteracting = false;
let playlists = {};

// Initialize
socket.on('init', ({ tracks: serverTracks, playlists: serverPlaylists, currentState }) => {
  tracks = serverTracks;
  filteredTracks = [...tracks];
  playlists = serverPlaylists;
  renderTrackList(filteredTracks);
  updatePlaylistDropdown();
  
  if (currentState.currentTrack) {
    loadTrack(currentState.currentTrack, currentState.position, currentState.isPlaying);
  }
});

// Update playlist dropdown
function updatePlaylistDropdown() {
  playlistSelect.innerHTML = '';
  Object.keys(playlists).forEach(playlistName => {
    const option = document.createElement('option');
    option.value = playlistName;
    option.textContent = playlistName.charAt(0).toUpperCase() + playlistName.slice(1);
    playlistSelect.appendChild(option);
  });
}

// Track loading (updated for immediate response)
function loadTrack(track, position = 0, shouldPlay = false) {
  currentTrack = track;
  audioPlayer.src = track.url;
  
  // Immediate UI update
  updateUI();
  renderTrackList(filteredTracks);
  
  audioPlayer.onloadedmetadata = () => {
    socket.emit('duration', {
      trackId: track.id,
      duration: audioPlayer.duration
    });
    
    totalTimeEl.textContent = formatTime(audioPlayer.duration);
    audioPlayer.currentTime = position;
    
    if (shouldPlay) {
      audioPlayer.play()
        .then(() => {
          updatePlayState(true);
          document.querySelector(`.track[data-id="${track.id}"]`)?.classList.add('playing');
        })
        .catch(e => console.log("Play error:", e));
    }
  };
}

// Search functionality
searchInput.addEventListener('input', (e) => {
  const searchTerm = e.target.value.toLowerCase().trim();
  
  if (searchTerm === '') {
    filteredTracks = [...tracks];
  } else {
    filteredTracks = tracks.filter(track => 
      track.name.toLowerCase().includes(searchTerm)
    );
  }
  
  renderTrackList(filteredTracks);
});

// Track list rendering (updated for better highlighting)
function renderTrackList(trackList) {
  musicList.innerHTML = '';
  
  trackList.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track';
    if (currentTrack?.id === track.id) {
      trackEl.classList.add('active');
      if (!audioPlayer.paused) {
        trackEl.classList.add('playing');
      }
    }
    trackEl.dataset.id = track.id;
    trackEl.innerHTML = `
      <div class="track-info">
        <div class="track-title">${track.name}</div>
        <div class="track-meta">
          <span class="track-duration">${track.duration ? formatTime(track.duration) : '--:--'}</span>
          <span class="track-likes"><i class="far fa-heart"></i> 0</span>
        </div>
      </div>
    `;
    musicList.appendChild(trackEl);
  });
}

// Track click handler (updated for immediate response)
musicList.addEventListener('click', (e) => {
  const trackEl = e.target.closest('.track');
  if (!trackEl) return;
  
  const trackId = trackEl.dataset.id;
  const track = tracks.find(t => t.id === trackId);
  if (!track) return;
  
  isUserInteracting = true;
  
  // Immediate UI update
  currentTrack = track;
  updateUI();
  renderTrackList(filteredTracks);
  
  socket.emit('play', { trackId: track.id });
  setTimeout(() => isUserInteracting = false, 500);
});

// Playlist UI handlers
addToPlaylistBtn.addEventListener('click', () => {
  if (!currentTrack) return;
  const playlistName = playlistSelect.value;
  
  socket.emit('add-to-playlist', {
    playlistName,
    trackId: currentTrack.id
  });
});

socket.on('playlist-updated', ({ playlistName, playlists: updatedPlaylists }) => {
  playlists = updatedPlaylists;
  alert(`"${currentTrack.name}" added to ${playlistName} playlist!`);
});

// Sync handlers
socket.on('track-changed', ({ track, position, isPlaying }) => {
  loadTrack(track, position, isPlaying);
});

socket.on('pause', ({ position }) => {
  if (isUserInteracting) return;
  audioPlayer.currentTime = position;
  audioPlayer.pause();
  updatePlayState(false);
  document.querySelector('.track.playing')?.classList.remove('playing');
});

socket.on('seek', ({ position }) => {
  if (isUserInteracting) return;
  audioPlayer.currentTime = position;
});

socket.on('sync', ({ position, isPlaying }) => {
  if (isUserInteracting) return;
  
  if (Math.abs(audioPlayer.currentTime - position) > 0.5) {
    audioPlayer.currentTime = position;
  }
  
  if (isPlaying && audioPlayer.paused) {
    audioPlayer.play()
      .then(() => {
        updatePlayState(true);
        if (currentTrack) {
          document.querySelector(`.track[data-id="${currentTrack.id}"]`)?.classList.add('playing');
        }
      })
      .catch(e => console.log("Sync play error:", e));
  } else if (!isPlaying && !audioPlayer.paused) {
    audioPlayer.pause();
    updatePlayState(false);
    document.querySelector('.track.playing')?.classList.remove('playing');
  }
});

// Player controls
playPauseBtn.addEventListener('click', () => {
  isUserInteracting = true;
  
  if (audioPlayer.paused) {
    socket.emit('play', { trackId: currentTrack.id });
    audioPlayer.play()
      .then(() => {
        updatePlayState(true);
        if (currentTrack) {
          document.querySelector(`.track[data-id="${currentTrack.id}"]`)?.classList.add('playing');
        }
      })
      .catch(e => console.log("Play error:", e));
  } else {
    socket.emit('pause');
    audioPlayer.pause();
    updatePlayState(false);
    document.querySelector('.track.playing')?.classList.remove('playing');
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

// UI updates
function updatePlayState(isPlaying) {
  playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
}

function updateUI() {
  if (currentTrack) {
    document.getElementById('currentTrackName').textContent = currentTrack.name;
    document.getElementById('currentArtist').textContent = 'JamSync';
    document.getElementById('nowPlayingMobile').textContent = currentTrack.name;
  }
  renderTrackList(filteredTracks);
}

// Helper function
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Player events
audioPlayer.addEventListener('timeupdate', () => {
  const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100 || 0;
  progressBar.style.width = `${progress}%`;
  currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
});

audioPlayer.addEventListener('play', () => {
  if (currentTrack) {
    document.querySelector(`.track[data-id="${currentTrack.id}"]`)?.classList.add('playing');
  }
});

audioPlayer.addEventListener('pause', () => {
  document.querySelector('.track.playing')?.classList.remove('playing');
});

audioPlayer.addEventListener('ended', () => {
  document.querySelector('.track.playing')?.classList.remove('playing');
  socket.emit('track-ended');
});

progressBar.parentElement.addEventListener('click', (e) => {
  if (!currentTrack) return;
  
  const percent = e.offsetX / e.target.clientWidth;
  const seekTime = percent * audioPlayer.duration;
  
  isUserInteracting = true;
  const wasPlaying = !audioPlayer.paused;
  
  if (wasPlaying) {
    audioPlayer.pause();
  }
  
  audioPlayer.currentTime = seekTime;
  
  socket.emit('seek', { position: seekTime });
  
  setTimeout(() => {
    isUserInteracting = false;
    if (wasPlaying) {
      audioPlayer.play().catch(e => console.log("Play error:", e));
    }
  }, 500);
});
