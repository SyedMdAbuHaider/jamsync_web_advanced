const socket = io();
const musicList = document.getElementById('musicList');
const audioPlayer = document.getElementById('audioPlayer');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const currentTrackName = document.getElementById('currentTrackName');
const currentArtist = document.getElementById('currentArtist');
const nowPlayingMobile = document.getElementById('nowPlayingMobile');
const songProgress = document.getElementById('songProgress');
const currentTime = document.getElementById('currentTime');
const totalTime = document.getElementById('totalTime');
const searchInput = document.getElementById('searchInput');

let currentTrack = null;
let tracks = [];

// Load tracks from server
function loadTracks() {
    fetch('/tracks')
        .then(response => response.json())
        .then(loadedTracks => {
            tracks = loadedTracks;
            renderTracks(loadedTracks);
        });
}

// Render tracks to the list
function renderTracks(tracksToRender) {
    musicList.innerHTML = '';
    tracksToRender.forEach((track, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'track';
        trackElement.innerHTML = `
            <div class="track-number">${index + 1}</div>
            <div class="track-info">
                <div class="track-title">${formatTrackName(track)}</div>
                <div class="track-artist">JamSync</div>
            </div>
            <div class="track-duration">--:--</div>
        `;
        
        trackElement.addEventListener('click', () => {
            playTrack(track);
        });
        
        musicList.appendChild(trackElement);
    });
}

// Play track function
function playTrack(track) {
    currentTrack = track;
    audioPlayer.src = `/music/${encodeURIComponent(track)}`;
    audioPlayer.play();
    
    // Update player info
    currentTrackName.textContent = formatTrackName(track);
    currentArtist.textContent = "JamSync";
    nowPlayingMobile.querySelector('span').textContent = formatTrackName(track);
    
    // Notify other clients
    socket.emit('play', track);
    
    // Update play button
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    
    // Highlight the selected track
    document.querySelectorAll('.track').forEach(t => t.classList.remove('active'));
    const trackElements = Array.from(document.querySelectorAll('.track'));
    const trackIndex = tracks.indexOf(track);
    if (trackIndex >= 0 && trackElements[trackIndex]) {
        trackElements[trackIndex].classList.add('active');
    }
}

// Format track name (remove extension)
function formatTrackName(track) {
    return track.replace(/\.[^/.]+$/, "");
}

// Play/Pause button click
playPauseBtn.addEventListener('click', () => {
    if (audioPlayer.paused) {
        if (currentTrack) {
            audioPlayer.play();
            playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        } else if (tracks.length > 0) {
            playTrack(tracks[0]);
        }
    } else {
        audioPlayer.pause();
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
});

// Previous track button
prevBtn.addEventListener('click', () => {
    if (!currentTrack || tracks.length === 0) return;
    
    const currentIndex = tracks.indexOf(currentTrack);
    const prevIndex = (currentIndex - 1 + tracks.length) % tracks.length;
    playTrack(tracks[prevIndex]);
});

// Next track button
nextBtn.addEventListener('click', () => {
    if (!currentTrack || tracks.length === 0) return;
    
    const currentIndex = tracks.indexOf(currentTrack);
    const nextIndex = (currentIndex + 1) % tracks.length;
    playTrack(tracks[nextIndex]);
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
    songProgress.style.width = `${progress}%`;
    
    // Update time display
    currentTime.textContent = formatTime(audioPlayer.currentTime);
    if (!isNaN(audioPlayer.duration)) {
        totalTime.textContent = formatTime(audioPlayer.duration);
    }
});

// Click on progress bar to seek
document.querySelector('.progress-bar').addEventListener('click', (e) => {
    const progressBar = e.currentTarget;
    const clickPosition = e.clientX - progressBar.getBoundingClientRect().left;
    const progressBarWidth = progressBar.clientWidth;
    const seekTime = (clickPosition / progressBarWidth) * audioPlayer.duration;
    audioPlayer.currentTime = seekTime;
});

// Format time (seconds to MM:SS)
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

// Search functionality
searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredTracks = tracks.filter(track => 
        track.toLowerCase().includes(searchTerm)
    );
    renderTracks(filteredTracks);
});

// Initialize
loadTracks();
