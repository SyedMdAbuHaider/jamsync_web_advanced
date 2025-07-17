const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
let isSyncing = false;

// Load and display tracks
async function loadTracks() {
  const response = await fetch('/tracks');
  const tracks = await response.json();
  
  const musicList = document.getElementById('musicList');
  musicList.innerHTML = '';
  
  tracks.forEach(track => {
    const li = document.createElement('li');
    li.textContent = track.name;
    li.onclick = () => {
      if (!isSyncing) {
        socket.emit('play', track.url);
        playTrack(track.url);
      }
    };
    musicList.appendChild(li);
  });
}

// Play track with sync
function playTrack(url) {
  isSyncing = true;
  audioPlayer.src = url;
  audioPlayer.currentTime = 0;
  audioPlayer.play().then(() => {
    isSyncing = false;
  });
}

// Sync handlers
socket.on('play', (state) => {
  if (audioPlayer.src !== state.currentTrack) {
    audioPlayer.src = state.currentTrack;
  }
  audioPlayer.currentTime = state.position;
  if (!audioPlayer.paused && !state.isPlaying) {
    audioPlayer.pause();
  } else if (audioPlayer.paused && state.isPlaying) {
    audioPlayer.play();
  }
});

socket.on('seek', (position) => {
  if (Math.abs(audioPlayer.currentTime - position) > 1) {
    audioPlayer.currentTime = position;
  }
});

// Send local player events
audioPlayer.addEventListener('play', () => {
  if (!isSyncing) {
    socket.emit('play', {
      currentTrack: audioPlayer.src,
      position: audioPlayer.currentTime
    });
  }
});

audioPlayer.addEventListener('pause', () => {
  if (!isSyncing) {
    socket.emit('pause', audioPlayer.currentTime);
  }
});

audioPlayer.addEventListener('timeupdate', () => {
  if (!isSyncing && audioPlayer.currentTime % 5 < 0.1) {
    socket.emit('seek', audioPlayer.currentTime);
  }
});

// Initial load
loadTracks();
