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
  // Ensure each track has required fields for display
  tracks = serverTracks.map(track => ({
    ...track,
    artist: track.artist || 'JamSync Artist',
    albumArt: track.albumArt || getRandomAlbumArt(),
    likes: track.likes || Math.floor(Math.random() * 500) + 100,
    duration: track.duration || 180 // Default 3 minutes if not provided
  }));
  
  filteredTracks = [...tracks];
  playlists = serverPlaylists;
  renderTrackList(filteredTracks);
  updatePlaylistDropdown();
  
  if (currentState.currentTrack) {
    loadTrack(currentState.currentTrack, currentState.position, currentState.isPlaying);
  }
});

// Helper function to get random album art emoji
function getRandomAlbumArt() {
  const emojis = ['📀'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

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
          renderTrackList(filteredTracks);
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
      track.name.toLowerCase().includes(searchTerm) ||
      (track.artist && track.artist.toLowerCase().includes(searchTerm))
    );
  }
  
  renderTrackList(filteredTracks);
});

// Track list rendering (UPDATED to match HTML/CSS structure)
function renderTrackList(trackList) {
  musicList.innerHTML = '';
  
  trackList.forEach((track, index) => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track';
    if (currentTrack?.id === track.id) {
      trackEl.classList.add('active');
      if (!audioPlayer.paused) {
        trackEl.classList.add('playing');
      }
    }
    trackEl.dataset.id = track.id;
    
    // Create the full track structure matching your HTML/CSS
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
          <span class="dur">${track.duration ? formatTime(track.duration) : '--:--'}</span>
        </div>
      </div>
      <div class="track-likes">
        <i class="fa-regular fa-heart"></i>
        <span>${track.likes || 0}</span>
      </div>
    `;
    
    musicList.appendChild(trackEl);
  });
  
  // Update track count
  const trackCountEl = document.getElementById('trackCount');
  if (trackCountEl) {
    trackCountEl.textContent = trackList.length;
  }
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
  renderTrackList(filteredTracks);
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
        renderTrackList(filteredTracks);
      })
      .catch(e => console.log("Sync play error:", e));
  } else if (!isPlaying && !audioPlayer.paused) {
    audioPlayer.pause();
    updatePlayState(false);
    renderTrackList(filteredTracks);
  }
});

// Player controls
playPauseBtn.addEventListener('click', () => {
  if (!currentTrack) {
    // If no track selected, play the first one
    if (tracks.length > 0) {
      const firstTrack = tracks[0];
      socket.emit('play', { trackId: firstTrack.id });
    }
    return;
  }
  
  isUserInteracting = true;
  
  if (audioPlayer.paused) {
    socket.emit('play', { trackId: currentTrack.id });
    audioPlayer.play()
      .then(() => {
        updatePlayState(true);
        renderTrackList(filteredTracks);
      })
      .catch(e => console.log("Play error:", e));
  } else {
    socket.emit('pause');
    audioPlayer.pause();
    updatePlayState(false);
    renderTrackList(filteredTracks);
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
  playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play" style="margin-left:2px;"></i>';
}

function updateUI() {
  if (currentTrack) {
    document.getElementById('currentTrackName').textContent = currentTrack.name;
    document.getElementById('currentArtist').textContent = currentTrack.artist || 'JamSync';
    
    // Update mobile now playing
    const mobileSpan = document.querySelector('#nowPlayingMobile span');
    if (mobileSpan) {
      mobileSpan.textContent = currentTrack.name;
    }
    
    // Update player album art
    const playerArt = document.getElementById('playerAlbumArt');
    if (playerArt) {
      playerArt.textContent = currentTrack.albumArt || '🎵';
    }
  } else {
    document.getElementById('currentTrackName').textContent = 'Not Playing';
    document.getElementById('currentArtist').textContent = 'Select a track';
    
    const mobileSpan = document.querySelector('#nowPlayingMobile span');
    if (mobileSpan) {
      mobileSpan.textContent = 'Select a track';
    }
    
    const playerArt = document.getElementById('playerAlbumArt');
    if (playerArt) {
      playerArt.textContent = '🎵';
    }
  }
}

// Helper function
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
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
  updatePlayState(true);
  renderTrackList(filteredTracks);
});

audioPlayer.addEventListener('pause', () => {
  updatePlayState(false);
  renderTrackList(filteredTracks);
});

audioPlayer.addEventListener('ended', () => {
  renderTrackList(filteredTracks);
  socket.emit('track-ended');
});

// Progress bar click handler
const progressContainer = document.querySelector('.progress-bar');
if (progressContainer) {
  progressContainer.addEventListener('click', (e) => {
    if (!currentTrack || !audioPlayer.duration) return;
    
    const rect = e.target.closest('.progress-bar').getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
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
}

// Add some sample data if server doesn't send any (for development)
window.addEventListener('load', () => {
  // If no tracks after 2 seconds, load sample data (for testing)
  setTimeout(() => {
    if (tracks.length === 0) {
      console.log('No tracks received from server, loading sample data');
      tracks = [
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
      filteredTracks = [...tracks];
      renderTrackList(filteredTracks);
    }
  }, 2000);
});
