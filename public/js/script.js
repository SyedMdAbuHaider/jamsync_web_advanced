const musicList = document.getElementById('musicList');
const audioPlayer = document.getElementById('audioPlayer');
const socket = io();

// Load tracks on page load
function loadTracks() {
  fetch('/tracks')
    .then(response => response.json())
    .then(tracks => {
      musicList.innerHTML = '';
      tracks.forEach(track => {
        const listItem = document.createElement('li');
        listItem.textContent = track;
        listItem.addEventListener('click', () => {
          audioPlayer.src = `/music/${encodeURIComponent(track)}`;
          audioPlayer.play();
          socket.emit('play', track);
        });
        musicList.appendChild(listItem);
      });
    });
}

// Initialize
loadTracks();

// Handle play events from other clients
socket.on('play', (track) => {
  audioPlayer.src = `/music/${encodeURIComponent(track)}`;
  audioPlayer.play();
});
