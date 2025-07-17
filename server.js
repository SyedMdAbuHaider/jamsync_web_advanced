const express = require('express');
const axios = require('axios');
const app = express();

const DRIVE_FOLDER_ID = '1SfzWcO3mDSoQYHwSRVBdyt57T3YaroSc';

// New improved track loader
async function loadDriveTracks() {
  try {
    const response = await axios.get(
      `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}?usp=sharing`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0' // Bypass potential blocking
        }
      }
    );

    // Improved regex pattern
    const regex = /\["([^"]+\.(mp3|wav|ogg|m4a))","([^"]+)",\d+,\d+,null,\d+,\["([^"]+)"/g;
    const matches = [...response.data.matchAll(regex)];
    
    return matches.map(match => ({
      name: match[1].replace(/\.[^/.]+$/, ''),
      id: match[4] || match[3], // Try both possible ID positions
      url: `https://drive.google.com/uc?export=download&id=${match[4] || match[3]}`
    }));
  } catch (err) {
    console.error('Drive loading error:', err.message);
    return [];
  }
}

// Cache tracks for 1 hour
let cachedTracks = [];
let lastRefresh = 0;

app.get('/tracks', async (req, res) => {
  // Refresh cache if older than 1 hour
  if (Date.now() - lastRefresh > 3600000) {
    cachedTracks = await loadDriveTracks();
    lastRefresh = Date.now();
    console.log('Refreshed tracks:', cachedTracks.length);
  }
  
  res.json(cachedTracks.length > 0 ? cachedTracks : [{
    name: "Demo Track (Add files to Drive)",
    url: "https://example.com/fallback.mp3"
  }]);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server ready. Load tracks from: http://localhost:${PORT}/tracks`);
  loadDriveTracks().then(tracks => {
    console.log('Initial load found:', tracks.length, 'tracks');
  });
});
