// Configuration
const JELLYFIN_URL = 'https://grizzly-stream.duckdns.org';
const JELLYFIN_API_KEY = '9be43634c07e42c8bc2bc87368b51712';
const LYRICS_API = 'https://grizzlyrics.duckdns.org/api/search.php';

let tracks = [];
let currentTrack = null;
let audioPlayer = document.getElementById('audioPlayer');
let trackListDiv = document.getElementById('trackList');
let searchInput = document.getElementById('searchInput');

// Récupérer les morceaux depuis Jellyfin
async function fetchTracks() {
    try {
        // Récupérer les utilisateurs (optionnel)
        const usersResp = await fetch(`${JELLYFIN_URL}/Users?api_key=${JELLYFIN_API_KEY}`);
        const users = await usersResp.json();
        const userId = users[0]?.Id;
        if (!userId) throw new Error('Aucun utilisateur trouvé');

        // Récupérer les items musicaux (fichiers audio)
        const itemsResp = await fetch(`${JELLYFIN_URL}/Items?userId=${userId}&Recursive=true&IncludeItemTypes=Audio&api_key=${JELLYFIN_API_KEY}`);
        const data = await itemsResp.json();
        tracks = data.Items.map(item => ({
            id: item.Id,
            title: item.Name,
            artist: item.Artists?.[0] || 'Artiste inconnu',
            duration: item.RunTimeTicks / 10000000, // en secondes
            streamUrl: `${JELLYFIN_URL}/Audio/${item.Id}/stream?api_key=${JELLYFIN_API_KEY}`,
            searchName: item.Name // utilisé pour chercher les paroles
        }));
        renderTrackList(tracks);
    } catch (error) {
        console.error('Erreur Jellyfin:', error);
        trackListDiv.innerHTML = '<div class="error">Erreur de chargement des morceaux. Vérifiez Jellyfin.</div>';
    }
}

// Afficher la liste des morceaux
function renderTrackList(filteredTracks) {
    if (filteredTracks.length === 0) {
        trackListDiv.innerHTML = '<div class="placeholder">Aucun morceau trouvé</div>';
        return;
    }
    trackListDiv.innerHTML = filteredTracks.map(track => `
        <div class="track-item" data-id="${track.id}">
            <div class="track-icon">🎵</div>
            <div class="track-info">
                <div class="track-title">${escapeHtml(track.title)}</div>
                <div class="track-artist">${escapeHtml(track.artist)}</div>
            </div>
        </div>
    `).join('');
    
    // Ajouter les écouteurs
    document.querySelectorAll('.track-item').forEach(el => {
        el.addEventListener('click', () => playTrack(el.dataset.id));
    });
}

// Rechercher et afficher les paroles pour un morceau
async function fetchLyrics(trackName) {
    const lyricsDiv = document.getElementById('lyricsDisplay');
    lyricsDiv.innerHTML = '<div class="loading">Recherche des paroles...</div>';
    
    try {
        // Appeler l'API Nextcloud avec le nom du morceau
        const url = `${LYRICS_API}?q=${encodeURIComponent(trackName)}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success && data.results.length > 0) {
            // Priorité au JSON, puis LRC
            const jsonFile = data.results.find(r => r.type === 'json');
            const lrcFile = data.results.find(r => r.type === 'lrc');
            const selected = jsonFile || lrcFile;
            
            if (selected) {
                // Récupérer le contenu du fichier
                const contentResp = await fetch(selected.content_url);
                const content = await contentResp.text();
                
                if (selected.type === 'json') {
                    // Essayer de parser le JSON (peut contenir des paroles structurées)
                    try {
                        const jsonData = JSON.parse(content);
                        // Afficher le champ 'lyrics' ou la valeur brute
                        let lyricsText = jsonData.lyrics || jsonData.text || JSON.stringify(jsonData, null, 2);
                        lyricsDiv.innerHTML = `<pre>${escapeHtml(lyricsText)}</pre>`;
                    } catch(e) {
                        lyricsDiv.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
                    }
                } else {
                    // Fichier LRC : afficher tel quel
                    lyricsDiv.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
                }
                return;
            }
        }
        lyricsDiv.innerHTML = '<p class="placeholder">Aucune parole trouvée pour ce morceau.</p>';
    } catch (error) {
        console.error('Erreur chargement paroles:', error);
        lyricsDiv.innerHTML = '<p class="placeholder">Erreur lors de la recherche des paroles.</p>';
    }
}

// Jouer un morceau
async function playTrack(trackId) {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    currentTrack = track;
    audioPlayer.src = track.streamUrl;
    audioPlayer.play();
    
    // Mettre à jour l'interface
    document.getElementById('currentTitle').innerText = track.title;
    document.getElementById('currentArtist').innerText = track.artist;
    
    // Mettre en surbrillance l'élément actif
    document.querySelectorAll('.track-item').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.id === trackId) el.classList.add('active');
    });
    
    // Charger les paroles en fonction du nom
    await fetchLyrics(track.title);
}

// Filtrage en temps réel
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = tracks.filter(track => 
        track.title.toLowerCase().includes(term) || 
        track.artist.toLowerCase().includes(term)
    );
    renderTrackList(filtered);
});

// Utilitaires
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Lancer l'application
fetchTracks();
