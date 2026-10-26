const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

function apiUrl(caminho) {
    return `${API_BASE}${caminho}`;
}
