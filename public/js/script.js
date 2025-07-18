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

// Load saved state
const savedState = JSON.parse(localStorage.getItem('jamsync-state')) || {};

// Fetch tracks
fetch('/tracks')
  .then(res => res.json())
  .then(loadedTracks => {
    tracks = loadedTracks;
    renderTrackList(tracks);
    
    // Restore playback if available
    if (savedState.trackUrl) {
      currentTrackIndex = tracks.findIndex(t => t.url === savedState.trackUrl);
      if (currentTrackIndex !== -1) {
        audioPlayer.src = savedState.trackUrl;
        audioPlayer.currentTime = savedState.position || 0;
        if (savedState.isPlaying) {
          audioPlayer.play().catch(e => console.log("Playback error:", e));
          playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        }
        updateNowPlaying();
      }
    }
  });

// Render track list
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
      <div class="track-duration">--:--</div>
    `;
    trackEl.addEventListener('click', () => playTrack(track, index));
    musicList.appendChild(trackEl);
  });
}

// Play track
function playTrack(track, index) {
  currentTrackIndex = index;
  socket.emit('play', track.url);
  audioPlayer.src = track.url;
  audioPlayer.currentTime = 0;
  audioPlayer.play()
    .then(() => {
      updateNowPlaying();
      playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
      saveState();
    });
}

// Update UI
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

// Save state
function saveState() {
  localStorage.setItem('jamsync-state', JSON.stringify({
    trackUrl: tracks[currentTrackIndex]?.url,
    position: audioPlayer.currentTime,
    isPlaying: !audioPlayer.paused
  }));
}

// Socket events
socket.on('play', (state) => {
  const trackIndex = tracks.findIndex(t => t.url === state.track);
  if (trackIndex !== -1) {
    currentTrackIndex = trackIndex;
    audioPlayer.src = state.track;
    audioPlayer.currentTime = state.position;
    audioPlayer.play()
      .then(() => {
        updateNowPlaying();
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        saveState();
      });
  }
});

socket.on('pause', (state) => {
  audioPlayer.currentTime = state.position;
  audioPlayer.pause();
  playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  saveState();
});

socket.on('seek', (position) => {
  audioPlayer.currentTime = position;
  saveState();
});

// Player controls
playPauseBtn.addEventListener('click', () => {
  if (audioPlayer.paused) {
    socket.emit('play', tracks[currentTrackIndex].url);
  } else {
    socket.emit('pause', audioPlayer.currentTime);
  }
});

document.getElementById('prevBtn').addEventListener('click', () => {
  if (tracks.length === 0) return;
  currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
  playTrack(tracks[currentTrackIndex], currentTrackIndex);
});

document.getElementById('nextBtn').addEventListener('click', () => {
  if (tracks.length === 0) return;
  currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
  playTrack(tracks[currentTrackIndex], currentTrackIndex);
});

// Progress bar
audioPlayer.addEventListener('timeupdate', () => {
  document.getElementById('songProgress').style.width = 
    `${(audioPlayer.currentTime / audioPlayer.duration) * 100}%`;
  document.getElementById('currentTime').textContent = 
    formatTime(audioPlayer.currentTime);
});

audioPlayer.addEventListener('loadedmetadata', () => {
  document.getElementById('totalTime').textContent = 
    formatTime(audioPlayer.duration);
});

document.querySelector('.progress-bar').addEventListener('click', (e) => {
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

// Auto-save every 2 seconds
setInterval(saveState, 2000);
