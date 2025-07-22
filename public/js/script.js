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

// Track loading
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

// Track list rendering
function renderTrackList(trackList) {
  musicList.innerHTML = '';
  
  trackList.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = `track ${currentTrack?.id === track.id ? 'active' : ''}`;
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
    trackEl.addEventListener('click', () => {
      isUserInteracting = true;
      socket.emit('play', { trackId: track.id });
      setTimeout(() => isUserInteracting = false, 500);
    });
    musicList.appendChild(trackEl);
  });
}

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

// ... [rest of the existing socket handlers and player controls remain the same] ...

// Helper function
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// ... [rest of the existing code remains the same] ...
