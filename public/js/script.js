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
const playlistStatus = document.getElementById('playlistStatus');
const visualizer = document.getElementById('visualizer');

// State management
let tracks = [];
let filteredTracks = [];
let currentTrack = null;
let isUserInteracting = false;
let playlists = {
    default: [],
    favorites: []
};

// ======================
// AUDIO VISUALIZER SETUP
// ======================
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const analyzer = audioContext.createAnalyser();
analyzer.fftSize = 256;
const bufferLength = analyzer.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

// Connect audio nodes
const source = audioContext.createMediaElementSource(audioPlayer);
source.connect(analyzer);
analyzer.connect(audioContext.destination);

// Visualizer rendering
const visualizerCtx = visualizer.getContext('2d');
visualizer.width = visualizer.offsetWidth;
visualizer.height = visualizer.offsetHeight;

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    
    if (audioPlayer.paused) {
        // Draw idle state when paused
        visualizerCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        visualizerCtx.fillRect(0, 0, visualizer.width, visualizer.height);
        return;
    }
    
    analyzer.getByteFrequencyData(dataArray);
    visualizerCtx.clearRect(0, 0, visualizer.width, visualizer.height);
    
    const barWidth = (visualizer.width / bufferLength) * 2.5;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * visualizer.height;
        const hue = i * 360 / bufferLength;
        
        visualizerCtx.fillStyle = `hsla(${hue}, 80%, 60%, 0.8)`;
        visualizerCtx.fillRect(x, visualizer.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

// Initialize visualizer
drawVisualizer();

// =================
// PLAYLIST FEATURES
// =================
function showPlaylistStatus(message, isError = false) {
    playlistStatus.textContent = message;
    playlistStatus.style.color = isError ? '#ff5252' : '#1db954';
    playlistStatus.style.opacity = 1;
    
    setTimeout(() => {
        playlistStatus.style.opacity = 0;
        setTimeout(() => {
            playlistStatus.textContent = '';
        }, 300);
    }, 2000);
}

addToPlaylistBtn.addEventListener('click', () => {
    if (!currentTrack) {
        showPlaylistStatus('No track playing', true);
        return;
    }
    
    const playlistSelect = document.getElementById('playlistSelect');
    const selectedPlaylist = playlistSelect.value;
    
    // Check for duplicates
    if (playlists[selectedPlaylist].some(track => track.id === currentTrack.id)) {
        showPlaylistStatus('Already in playlist', true);
        return;
    }
    
    // Add to playlist
    playlists[selectedPlaylist].push(currentTrack);
    showPlaylistStatus(`✓ Added to ${selectedPlaylist}`);
    
    // Button feedback
    const originalHTML = addToPlaylistBtn.innerHTML;
    addToPlaylistBtn.innerHTML = '<i class="fas fa-check"></i> Added';
    addToPlaylistBtn.disabled = true;
    
    setTimeout(() => {
        addToPlaylistBtn.innerHTML = originalHTML;
        addToPlaylistBtn.disabled = false;
    }, 1500);
});

// ======================
// EXISTING FUNCTIONALITY
// ======================

// Initialize
socket.on('init', ({ tracks: serverTracks, currentState }) => {
    tracks = serverTracks;
    filteredTracks = [...tracks];
    renderTrackList(filteredTracks);
    
    if (currentState.currentTrack) {
        loadTrack(currentState.currentTrack, currentState.position, currentState.isPlaying);
    }
});

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
    
    filteredTracks = searchTerm === '' 
        ? [...tracks] 
        : tracks.filter(track => track.name.toLowerCase().includes(searchTerm));
    
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

// Player controls
playPauseBtn.addEventListener('click', () => {
    isUserInteracting = true;
    
    if (audioPlayer.paused) {
        socket.emit('play', { trackId: currentTrack.id });
        audioPlayer.play()
            .then(() => updatePlayState(true))
            .catch(e => console.log("Play error:", e));
    } else {
        socket.emit('pause');
        audioPlayer.pause();
        updatePlayState(false);
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
    playPauseBtn.innerHTML = isPlaying 
        ? '<i class="fas fa-pause"></i>' 
        : '<i class="fas fa-play"></i>';
}

function updateUI() {
    if (currentTrack) {
        document.getElementById('currentTrackName').textContent = currentTrack.name;
        document.getElementById('currentArtist').textContent = 'JamSync';
        document.getElementById('nowPlayingMobile').textContent = currentTrack.name;
        
        document.querySelectorAll('.track').forEach(el => {
            el.classList.toggle('active', el.dataset.id === currentTrack.id);
        });
    }
}

// Helper function
function formatTime(seconds) {
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

audioPlayer.addEventListener('ended', () => {
    socket.emit('track-ended');
});

progressBar.parentElement.addEventListener('click', (e) => {
    if (!currentTrack) return;
    
    const percent = e.offsetX / e.target.clientWidth;
    const seekTime = percent * audioPlayer.duration;
    
    isUserInteracting = true;
    const wasPlaying = !audioPlayer.paused;
    
    if (wasPlaying) audioPlayer.pause();
    
    audioPlayer.currentTime = seekTime;
    socket.emit('seek', { position: seekTime });
    
    setTimeout(() => {
        isUserInteracting = false;
        if (wasPlaying) audioPlayer.play().catch(e => console.log("Play error:", e));
    }, 500);
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
        audioPlayer.play().catch(e => console.log("Sync play error:", e));
    } else if (!isPlaying && !audioPlayer.paused) {
        audioPlayer.pause();
    }
});

// Window resize handler
window.addEventListener('resize', () => {
    visualizer.width = visualizer.offsetWidth;
    visualizer.height = visualizer.offsetHeight;
});
