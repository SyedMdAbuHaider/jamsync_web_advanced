const socket = io();

// Play track and notify others
function playTrack(track) {
  socket.emit('play', track.url);
  audioPlayer.src = track.url;
  audioPlayer.play();
}

// Handle incoming sync events
socket.on('play', (state) => {
  if (audioPlayer.src !== state.currentTrack) {
    audioPlayer.src = state.currentTrack;
  }
  audioPlayer.currentTime = state.position;
  audioPlayer.play();
});

socket.on('pause', (state) => {
  audioPlayer.currentTime = state.position;
  audioPlayer.pause();
});

socket.on('seek', (position) => {
  audioPlayer.currentTime = position;
});
