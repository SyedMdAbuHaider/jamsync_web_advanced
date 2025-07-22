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
const playlistTracksContainer = document.getElementById('playlistTracks');

// State management
let tracks = [];
let filteredTracks = [];
let currentTrack = null;
let isUserInteracting = false;

// Initialize playlists from localStorage or create defaults
let playlists = JSON.parse(localStorage.getItem('jamsync-playlists')) || {
    favorites: []
};

// ======================
// AUDIO CONTEXT FIX + MODERN VISUALIZER
// ======================
let audioContext;
let analyzer;
let source;

function setupAudioContext() {
    // Fix for WebAudio autoplay policy
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    
    // Reconnect nodes when audio source changes
    if (source) source.disconnect();
    source = audioContext.createMediaElementSource(audioPlayer);
    source.connect(analyzer);
    analyzer.connect(audioContext.destination);
}

// Modern visualizer with smoothing
const visualizerCtx = visualizer.getContext('2d');
visualizer.width = visualizer.offsetWidth;
visualizer.height = visualizer.offsetHeight;

let lastVisualizerUpdate = 0;
const visualizerData = new Uint8Array(analyzer?.frequencyBinCount || 256);
const smoothedData = new Array(visualizerData.length).fill(0);

function drawModernVisualizer(timestamp) {
    requestAnimationFrame(drawModernVisualizer);
    
    if (!analyzer || audioPlayer.paused) {
        // Draw idle state
        visualizerCtx.fillStyle = 'rgba(18, 18, 18, 0.8)';
        visualizerCtx.fillRect(0, 0, visualizer.width, visualizer.height);
        return;
    }

    // Throttle visualizer updates for performance
    if (timestamp - lastVisualizerUpdate < 50) return;
    lastVisualizerUpdate = timestamp;

    analyzer.getByteFrequencyData(visualizerData);
    
    // Smoothing algorithm
    for (let i = 0; i < visualizerData.length; i++) {
        smoothedData[i] = Math.max(
            visualizerData[i] * 0.3,
            smoothedData[i] * 0.7
        );
    }

    // Clear canvas with fade effect
    visualizerCtx.fillStyle = 'rgba(18, 18, 18, 0.2)';
    visualizerCtx.fillRect(0, 0, visualizer.width, visualizer.height);
    
    // Draw bars with gradient
    const barWidth = (visualizer.width / smoothedData.length) * 2.5;
    let x = 0;
    
    for (let i = 0; i < smoothedData.length; i++) {
        const barHeight = (smoothedData[i] / 255) * visualizer.height;
        const gradient = visualizerCtx.createLinearGradient(0, visualizer.height, 0, visualizer.height - barHeight);
        gradient.addColorStop(0, `hsla(${i * 360 / smoothedData.length}, 100%, 50%, 0.3)`);
        gradient.addColorStop(1, `hsla(${i * 360 / smoothedData.length}, 100%, 70%, 0.8)`);
        
        visualizerCtx.fillStyle = gradient;
        visualizerCtx.fillRect(x, visualizer.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

// Initialize visualizer
drawModernVisualizer();

// =================
// PERMANENT PLAYLIST SYSTEM
// =================
function savePlaylists() {
    localStorage.setItem('jamsync-playlists', JSON.stringify(playlists));
}

function showPlaylistStatus(message, isError = false) {
    playlistStatus.textContent = message;
    playlistStatus.style.color = isError ? '#ff5252' : '#1db954';
    playlistStatus.style.opacity = 1;
    
    setTimeout(() => {
        playlistStatus.style.opacity = 0;
        setTimeout(() => playlistStatus.textContent = '', 300);
    }, 2000);
}

function renderPlaylistTracks(playlistName) {
    playlistTracksContainer.innerHTML = '';
    
    if (!playlists[playlistName]?.length) {
        playlistTracksContainer.innerHTML = '<div class="empty-playlist">No tracks added yet</div>';
        return;
    }

    playlists[playlistName].forEach((track, index) => {
        const trackEl = document.createElement('div');
        trackEl.className = `track playlist-track ${currentTrack?.id === track.id ? 'active' : ''}`;
        trackEl.innerHTML = `
            <div class="track-info">
                <div class="track-title">${track.name}</div>
                <div class="track-actions">
                    <button class="btn-play" data-index="${index}">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn-delete" data-index="${index}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        playlistTracksContainer.appendChild(trackEl);
    });

    // Add event listeners for new elements
    document.querySelectorAll('.btn-play').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = e.currentTarget.dataset.index;
            const track = playlists[document.getElementById('playlistSelect').value][index];
            socket.emit('play', { trackId: track.id });
        });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const playlistName = document.getElementById('playlistSelect').value;
            const index = e.currentTarget.dataset.index;
            playlists[playlistName].splice(index, 1);
            savePlaylists();
            renderPlaylistTracks(playlistName);
            showPlaylistStatus('Track removed');
        });
    });
}

addToPlaylistBtn.addEventListener('click', () => {
    if (!currentTrack) {
        showPlaylistStatus('No track playing', true);
        return;
    }
    
    const playlistName = document.getElementById('playlistSelect').value;
    
    // Initialize playlist if it doesn't exist
    if (!playlists[playlistName]) {
        playlists[playlistName] = [];
    }
    
    // Check for duplicates
    if (playlists[playlistName].some(t => t.id === currentTrack.id)) {
        showPlaylistStatus('Already in playlist', true);
        return;
    }
    
    // Add to playlist
    playlists[playlistName].push(currentTrack);
    savePlaylists();
    renderPlaylistTracks(playlistName);
    showPlaylistStatus(`✓ Added to ${playlistName}`);
    
    // Button feedback
    addToPlaylistBtn.innerHTML = '<i class="fas fa-check"></i> Added';
    setTimeout(() => {
        addToPlaylistBtn.innerHTML = '<i class="fas fa-plus"></i> Add Current';
    }, 1500);
});

// Update playlist view when dropdown changes
document.getElementById('playlistSelect').addEventListener('change', (e) => {
    renderPlaylistTracks(e.target.value);
});

// ======================
// AUDIO PLAYER FIXES
// ======================
audioPlayer.addEventListener('play', () => {
    // Fix for audio context suspension
    if (audioContext?.state === 'suspended') {
        audioContext.resume();
    }
    
    // Initialize audio nodes if not done
    if (!source) {
        setupAudioContext();
    }
});

// ======================
// EXISTING FUNCTIONALITY (with small fixes)
// ======================
socket.on('init', ({ tracks: serverTracks, currentState }) => {
    tracks = serverTracks;
    filteredTracks = [...tracks];
    renderTrackList(filteredTracks);
    
    // Initialize playlist view
    renderPlaylistTracks(document.getElementById('playlistSelect').value);
    
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
            audioPlayer.play().catch(e => {
                console.log("Play error:", e);
                // Show play button to resume context
                updatePlayState(false);
            });
        }
        updateUI();
    };
}

// ... (keep all other existing functions exactly the same as in your original code)
// [Include all your original socket.io handlers, renderTrackList, player controls, etc.]

// Initialize audio context on first interaction
document.body.addEventListener('click', () => {
    if (!audioContext) {
        setupAudioContext();
    }
}, { once: true });

// Window resize handler
window.addEventListener('resize', () => {
    visualizer.width = visualizer.offsetWidth;
    visualizer.height = visualizer.offsetHeight;
});
