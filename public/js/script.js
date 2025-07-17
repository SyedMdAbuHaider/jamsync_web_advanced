const socket = io();
const musicList = document.getElementById('musicList');
const audioPlayer = document.getElementById('audioPlayer');
const playPauseBtn = document.getElementById('playPauseBtn');
let currentTrack = null;

// Load tracks from server
function loadTracks() {
    fetch('/tracks')
        .then(response => response.json())
        .then(tracks => {
            musicList.innerHTML = '';
            tracks.forEach((track, index) => {
                const trackElement = document.createElement('div');
                trackElement.className = 'track';
                trackElement.innerHTML = `
                    <div class="track-index">${index + 1}</div>
                    <div class="track-title">
                        <div class="track-name">${track.replace(/\.[^/.]+$/, "")}</div>
                    </div>
                    <div class="track-album">JamSync</div>
                    <div class="track-duration">--:--</div>
                `;
                
                trackElement.addEventListener('click', () => {
                    playTrack(track);
                    // Highlight the selected track
                    document.querySelectorAll('.track').forEach(t => t.classList.remove('active'));
                    trackElement.classList.add('active');
                });
                
                musicList.appendChild(trackElement);
            });
        });
}

// Play track function
function playTrack(track) {
    currentTrack = track;
    audioPlayer.src = `/music/${encodeURIComponent(track)}`;
    audioPlayer.play();
    
    // Update player bar
    document.querySelector('.track-name').textContent = track.replace(/\.[^/.]+$/, "");
    document.querySelector('.artist-name').textContent = "JamSync";
    
    // Notify other clients
    socket.emit('play', track);
    
    // Change play button to pause
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
}

// Play/Pause button click
playPauseBtn.addEventListener('click', () => {
    if (audioPlayer.paused) {
        if (currentTrack) {
            audioPlayer.play();
            playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        }
    } else {
        audioPlayer.pause();
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
});

// Handle play events from other clients
socket.on('play', (track) => {
    if (track !== currentTrack) {
        playTrack(track);
    }
});

// Update progress bar
audioPlayer.addEventListener('timeupdate', () => {
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    document.querySelector('.progress').style.width = `${progress}%`;
    
    // Update time display
    document.querySelector('.time-current').textContent = formatTime(audioPlayer.currentTime);
    document.querySelector('.time-total').textContent = formatTime(audioPlayer.duration);
});

// Format time (seconds to MM:SS)
function formatTime(seconds) {
    if (isNaN(seconds)) return "--:--";
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

// Click on progress bar to seek
document.querySelector('.progress-bar').addEventListener('click', (e) => {
    const progressBar = e.currentTarget;
    const clickPosition = e.clientX - progressBar.getBoundingClientRect().left;
    const progressBarWidth = progressBar.clientWidth;
    const seekTime = (clickPosition / progressBarWidth) * audioPlayer.duration;
    audioPlayer.currentTime = seekTime;
});

// Initialize
loadTracks();
