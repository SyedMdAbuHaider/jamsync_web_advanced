const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
const musicList = document.getElementById('musicList');
const currentTrackName = document.getElementById('currentTrackName');
const currentArtist = document.getElementById('currentArtist');
const playPauseBtn = document.getElementById('playPauseBtn');
const searchInput = document.getElementById('searchInput');
const nowPlayingMobile = document.getElementById('nowPlayingMobile');

let tracks = [];
let currentTrackIndex = -1;
let isSyncing = false;
let lastSyncTime = 0;

// Initialize with saved state
const savedState = JSON.parse(localStorage.getItem('jamsync-state')) || {};

// Load tracks and restore state
fetch('/tracks')
  .then(res => res.json())
  .then(loadedTracks => {
    tracks = loadedTracks;
    renderTrackList(tracks);
    
    if (savedState.trackUrl) {
      currentTrackIndex = tracks.findIndex(t => t.url === savedState.trackUrl);
      if (currentTrackIndex !== -1) {
        loadTrack(tracks[currentTrackIndex], savedState.position || 0, savedState.isPlaying);
      }
    }
  });

// Precision track loading
function loadTrack(track, position = 0, shouldPlay = false) {
  isSyncing = true;
  audioPlayer.src = track.url;
  audioPlayer.currentTime = position;
  
  audioPlayer.onloadedmetadata = () => {
    socket.emit('track-duration', { 
      url: track.url, 
      duration: audioPlayer.duration 
    });
    
    if (shouldPlay) {
      audioPlayer.play()
        .then(() => {
          playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
          updateNowPlaying();
          isSyncing = false;
        })
        .catch(e => {
          console.log("Playback error:", e);
          isSyncing = false;
        });
    } else {
      isSyncing = false;
    }
  };
}

// Instant track switching
function playTrack(track, index) {
  if (isSyncing) return;
  
  currentTrackIndex = index;
  socket.emit('play', track.url);
  loadTrack(track, 0, true);
  saveState();
}

// UI updates
function updateNowPlaying() {
  if (currentTrackIndex >= 0) {
    const track = tracks[currentTrackIndex];
    currentTrackName.textContent = track.name;
    currentArtist.textContent = 'JamSync';
    nowPlayingMobile.textContent = track.name;
    document.querySelectorAll('.track').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.track')[currentTrackIndex]?.classList.add('active');
  }
}

// State persistence
function saveState() {
  localStorage.setItem('jamsync-state', JSON.stringify({
    trackUrl: tracks[currentTrackIndex]?.url,
    position: audioPlayer.currentTime,
    isPlaying: !audioPlayer.paused
  }));
}

// Socket event handlers
socket.on('full-sync', (state) => {
  if (Date.now() - lastSyncTime < 500) return; // Prevent sync storms
  lastSyncTime = Date.now();
  
  const trackIndex = tracks.findIndex(t => t.url === state.track);
  if (trackIndex !== -1) {
    currentTrackIndex = trackIndex;
    loadTrack(tracks[currentTrackIndex], state.calculatedPosition, state.isPlaying);
    updateNowPlaying();
  }
});

socket.on('play', (state) => {
  const trackIndex = tracks.findIndex(t => t.url === state.track);
  if (trackIndex !== -1) {
    currentTrackIndex = trackIndex;
    loadTrack(tracks[currentTrackIndex], state.calculatedPosition, true);
    updateNowPlaying();
  }
});

socket.on('pause', ({ position }) => {
  audioPlayer.currentTime = position;
  audioPlayer.pause();
  playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
});

socket.on('seek', ({ position }) => {
  audioPlayer.currentTime = position;
});

// Player controls
playPauseBtn.addEventListener('click', () => {
  if (isSyncing) return;
  
  if (audioPlayer.paused) {
    socket.emit('play', tracks[currentTrackIndex].url);
  } else {
    socket.emit('pause');
  }
});

document.getElementById('prevBtn').addEventListener('click', () => {
  if (tracks.length === 0 || isSyncing) return;
  currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
  playTrack(tracks[currentTrackIndex], currentTrackIndex);
});

document.getElementById('nextBtn').addEventListener('click', () => {
  if (tracks.length === 0 || isSyncing) return;
  currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
  playTrack(tracks[currentTrackIndex], currentTrackIndex);
});

// Progress sync
audioPlayer.addEventListener('timeupdate', () => {
  const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
  document.getElementById('songProgress').style.width = `${progress}%`;
  document.getElementById('currentTime').textContent = formatTime(audioPlayer.currentTime);
  if (!isSyncing) saveState();
});

audioPlayer.addEventListener('loadedmetadata', () => {
  document.getElementById('totalTime').textContent = formatTime(audioPlayer.duration);
});

document.querySelector('.progress-bar').addEventListener('click', (e) => {
  if (isSyncing) return;
  const seekTime = (e.offsetX / e.target.clientWidth) * audioPlayer.duration;
  socket.emit('seek', seekTime);
});

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Search
searchInput.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  renderTrackList(tracks.filter(t => t.name.toLowerCase().includes(term)));
});

function renderTrackList(trackList) {
  musicList.innerHTML = '';
  trackList.forEach((track, index) => {
    const trackEl = document.createElement('div');
    trackEl.className = `track ${index === currentTrackIndex ? 'active' : ''}`;
    trackEl.innerHTML = `
      <div class="track-number">${index + 1}</div>
      <div class="track-info">
        <div class="track-title">${track.name}</div>
        <div class="track-artist">JamSync</div>
      </div>
      <div class="track-duration">${track.duration ? formatTime(track.duration) : '--:--'}</div>
    `;
    trackEl.addEventListener('click', () => playTrack(track, index));
    musicList.appendChild(trackEl);
  });
}
