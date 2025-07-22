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

// Audio Analyzer Setup
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const analyzer = audioContext.createAnalyser();
analyzer.fftSize = 256;
const bufferLength = analyzer.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

// Connect audio player to analyzer
const source = audioContext.createMediaElementSource(audioPlayer);
source.connect(analyzer);
analyzer.connect(audioContext.destination);

// Visualizer
const visualizerCtx = visualizer.getContext('2d');
visualizer.width = visualizer.offsetWidth;
visualizer.height = visualizer.offsetHeight;

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    
    analyzer.getByteFrequencyData(dataArray);
    visualizerCtx.clearRect(0, 0, visualizer.width, visualizer.height);
    
    const barWidth = (visualizer.width / bufferLength) * 2.5;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * visualizer.height;
        const hue = i * 360 / bufferLength;
        
        visualizerCtx.fillStyle = `hsla(${hue}, 80%, 60%, 0.8)`;
        visualizerCtx.fillRect(
            x, 
            visualizer.height - barHeight, 
            barWidth, 
            barHeight
        );
        
        x += barWidth + 1;
    }
}

// Initialize visualizer
drawVisualizer();

// Playlist Functions
function showPlaylistStatus(message, isError = false) {
    playlistStatus.textContent = message;
    playlistStatus.style.color = isError ? '#ff5252' : var(--highlight);
    
    setTimeout(() => {
        playlistStatus.textContent = '';
    }, 2000);
}

addToPlaylistBtn.addEventListener('click', () => {
    if (!currentTrack) {
        showPlaylistStatus('No track selected', true);
        return;
    }
    
    const playlistSelect = document.getElementById('playlistSelect');
    const selectedPlaylist = playlistSelect.value;
    
    if (playlists[selectedPlaylist].some(track => track.id === currentTrack.id)) {
        showPlaylistStatus('Already in playlist', true);
        return;
    }
    
    playlists[selectedPlaylist].push(currentTrack);
    showPlaylistStatus(`Added to ${selectedPlaylist}`);
    
    // Visual feedback
    addToPlaylistBtn.innerHTML = '<i class="fas fa-check"></i> Added';
    setTimeout(() => {
        addToPlaylistBtn.innerHTML = '<i class="fas fa-plus"></i> Add Current';
    }, 1500);
});

// Existing functionality (keep all your original code below)
socket.on('init', ({ tracks: serverTracks, currentState }) => {
    tracks = serverTracks;
    filteredTracks = [...tracks];
    renderTrackList(filteredTracks);
    
    if (currentState.currentTrack) {
        loadTrack(currentState.currentTrack, currentState.position, currentState.isPlaying);
    }
});

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

// Keep all other existing functions (updatePlayState, formatTime, etc.)
// Keep all socket.io event handlers (track-changed, pause, seek, etc.)
// Keep all player control event listeners (playPauseBtn, nextBtn, prevBtn)

// Window resize handler for visualizer
window.addEventListener('resize', () => {
    visualizer.width = visualizer.offsetWidth;
    visualizer.height = visualizer.offsetHeight;
});
