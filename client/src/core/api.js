// Zugriff auf die discbox-API.

async function request(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

const post = (url, body) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const api = {
  status: () => request('/api/status'),
  albums: () => request('/api/albums'),
  album: (id) => request(`/api/albums/${encodeURIComponent(id)}`),
  themes: () => request('/api/themes').catch(() => []),
  scan: (full = false) => post('/api/scan', { full }),
  setFavorite: (id, favorite) =>
    request(`/api/albums/${encodeURIComponent(id)}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite })
    }),
  setFavorites: (ids, favorite) => post('/api/favorites', { ids, favorite }),
  lookupOnline: (id, mbid) => post(`/api/albums/${encodeURIComponent(id)}/online`, mbid ? { mbid } : {})
};

/** Bild-URL; v sorgt für dauerhaftes Caching im Browser. */
export function artUrl(album, kind, size = 'md') {
  // Galerie-Bilder (g0, g1 …) ohne Versionsangabe → kurz gecacht
  if (kind.startsWith('g')) return `/api/art/${album.id}/${kind}?s=${size}`;
  const v = album.art?.[kind];
  return v ? `/api/art/${album.id}/${kind}?s=${size}&v=${v}` : null;
}

export function streamUrl(track, { transcode = false, start = 0 } = {}) {
  const params = new URLSearchParams();
  if (transcode) params.set('transcode', '1');
  if (start > 0) params.set('start', start.toFixed(2));
  const q = params.toString();
  return `/api/tracks/${track.id}/stream${q ? `?${q}` : ''}`;
}
