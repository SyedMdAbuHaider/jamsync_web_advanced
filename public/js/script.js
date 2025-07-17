const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
let currentTrack = null;
let isSyncing = false;
let lastSyncTime = 0;

// When receiving play command from server
socket.on('play', (data) => {
    // Don't react to our own sync messages
    if (data.socketId === socket.id) return;
    
    if (data.track !== currentTrack) {
        // New track to play
        currentTrack = data.track;
        audioPlayer.src = `/music/${encodeURIComponent(data.track)}`;
        audioPlayer.currentTime = data.currentTime || 0;
        audioPlayer.play();
        updateUI(data.track);
    } else {
        // Sync existing track
        isSyncing = true;
        const timeDifference = Math.abs(audioPlayer.currentTime - data.currentTime);
        
        // Only adjust if difference is significant (>1 second)
        if (timeDifference > 1) {
            audioPlayer.currentTime = data.currentTime;
        }
        
        // Force play if we're paused but should be playing
        if (audioPlayer.paused && data.isPlaying) {
            audioPlayer.play();
        }
    }
});

// When audio starts playing
audioPlayer.addEventListener('play', () => {
    if (!isSyncing) {
        syncState();
    }
    isSyncing = false;
});

// When audio is paused
audioPlayer.addEventListener('pause', () => {
    if (!isSyncing) {
        syncState();
    }
    isSyncing = false;
});

// Regularly sync playback position
audioPlayer.addEventListener('timeupdate', () => {
    const now = Date.now();
    // Only sync every 3 seconds to reduce network traffic
    if (now - lastSyncTime > 3000) {
        syncState();
        lastSyncTime = now;
    }
});

// Send current state to other clients
function syncState() {
    socket.emit('sync', {
        track: currentTrack,
        currentTime: audioPlayer.currentTime,
        isPlaying: !audioPlayer.paused,
        socketId: socket.id
    });
}

// Play track function (modified)
function playTrack(track) {
    currentTrack = track;
    audioPlayer.src = `/music/${encodeURIComponent(track)}`;
    audioPlayer.currentTime = 0;
    audioPlayer.play();
    updateUI(track);
    syncState();
}
