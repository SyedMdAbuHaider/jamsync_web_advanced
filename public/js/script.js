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

// Fetch tracks from server
fetch('/tracks')
  .then(res => res.json())
  .then(loadedTracks => {
    tracks = loadedTracks;
    renderTrackList(tracks);
    if (tracks.length > 0) {
      currentTrackIndex = 0;
      updateNowPlaying();
    }
  });

// Render track list
function renderTrackList(trackList) {
  musicList.innerHTML = '';
  trackList.forEach((track, index) => {
    const trackElement = document.createElement('div');
    trackElement.className = 'track';
    trackElement.innerHTML = `
      <div class="track-number">${index + 1}</div>
      <div class="track-info">
        <div class="track-title">${track.name}</div>
        <div class="track-artist">JamSync</div>
      </div>
      <div class="track-duration">--:--</div>
    `;
    trackElement.addEventListener('click', () => {
      currentTrackIndex = index;
      playTrack(track);
    });
    musicList.appendChild(trackElement);
  });
}

// Play track and notify others
function playTrack(track) {
  socket.emit('play', track.url);
  audioPlayer.src = track.url;
  audioPlayer.play()
    .then(() => {
      updateNowPlaying();
      playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    })
    .catch(err => console.error('Playback failed:', err));
}

// Update UI with current track info
function updateNowPlaying() {
  if (currentTrackIndex >= 0 && currentTrackIndex < tracks.length) {
    const track = tracks[currentTrackIndex];
    currentTrackName.textContent = track.name;
    currentArtist.textContent = 'JamSync';
    nowPlayingMobile.textContent = track.name;
    
    // Highlight playing track in list
    document.querySelectorAll('.track').forEach((el, idx) => {
      el.classList.toggle('active', idx === currentTrackIndex);
    });
  }
}

// Handle incoming sync events
socket.on('play', (state) => {
  if (audioPlayer.src !== state.track) {
    audioPlayer.src = state.track;
    const trackIndex = tracks.findIndex(t => t.url === state.track);
    if (trackIndex >= 0) {
      currentTrackIndex = trackIndex;
      updateNowPlaying();
    }
  }
  audioPlayer.currentTime = state.position;
  audioPlayer.play()
    .then(() => {
      playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    });
});

socket.on('pause', (state) => {
  audioPlayer.currentTime = state.position;
  audioPlayer.pause();
  playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
});

socket.on('seek', (position) => {
  audioPlayer.currentTime = position;
});

// Player controls
playPauseBtn.addEventListener('click', () => {
  if (audioPlayer.paused) {
    socket.emit('play', tracks[currentTrackIndex].url);
    audioPlayer.play();
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
  } else {
    socket.emit('pause', audioPlayer.currentTime);
    audioPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  }
});

document.getElementById('prevBtn').addEventListener('click', () => {
  if (tracks.length === 0) return;
  currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
  playTrack(tracks[currentTrackIndex]);
});

document.getElementById('nextBtn').addEventListener('click', () => {
  if (tracks.length === 0) return;
  currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
  playTrack(tracks[currentTrackIndex]);
});

// Progress bar
const progressBar = document.getElementById('songProgress');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');

audioPlayer.addEventListener('timeupdate', () => {
  const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
  progressBar.style.width = `${progress}%`;
  currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
});

audioPlayer.addEventListener('loadedmetadata', () => {
  totalTimeEl.textContent = formatTime(audioPlayer.duration);
});

document.querySelector('.progress-bar').addEventListener('click', (e) => {
  const percent = e.offsetX / e.target.clientWidth;
  const seekTime = percent * audioPlayer.duration;
  audioPlayer.currentTime = seekTime;
  socket.emit('seek', seekTime);
});

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Search functionality
searchInput.addEventListener('input', (e) => {
  const searchTerm = e.target.value.toLowerCase();
  const filteredTracks = tracks.filter(track => 
    track.name.toLowerCase().includes(searchTerm)
  );
  renderTrackList(filteredTracks);
});
