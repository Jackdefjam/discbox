// HTTP-API und Auslieferung der Weboberfläche.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { KINDS, renderArt } from './art.js';
import { CollectionError, Collections } from './collections.js';
import { extractMbid } from './online.js';
import { sendDirect } from './stream.js';
import { isInside } from './util.js';

const APP_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function basicAuth(config) {
  if (!config.password) return (_req, _res, next) => next();
  const expected = Buffer.from(`${config.user}:${config.password}`);
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const given = Buffer.from(header.slice(6), 'base64');
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="discbox", charset="UTF-8"').status(401).send('Anmeldung erforderlich');
  };
}

async function loadCustomThemes(dataDir, log) {
  const dir = path.join(dataDir, 'themes');
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const themes = [];
  for (const f of files) {
    try {
      const t = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      if (typeof t !== 'object' || !t) continue;
      t.id = String(t.id || f.replace(/\.json$/, ''));
      t.name = String(t.name || t.id);
      t.custom = true;
      themes.push(t);
    } catch (err) {
      log.warn(`Theme ${f} ist kein gültiges JSON: ${err.message}`);
    }
  }
  return themes;
}

export function createApp({ config, log, library, transcoder, collections }) {
  if (!collections) {
    collections = new Collections({ config, log, library });
    collections.init().catch((err) => log.warn('Wiedergabelisten nicht geladen:', err.message));
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'weak');

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use(basicAuth(config));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/status', (_req, res) => {
    res.json({
      app: 'discbox',
      appVersion: APP_VERSION,
      ...library.status(),
      transcoding: transcoder.available ? config.transcodeFormat : null
    });
  });

  app.get('/api/albums', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ version: library.version, albums: library.albums.map((a) => library.summary(a)) });
  });

  app.get('/api/albums/:id', (req, res) => {
    const album = library.byId.get(req.params.id);
    if (!album) return res.status(404).json({ error: 'Album nicht gefunden' });
    res.set('Cache-Control', 'no-cache');
    res.json(library.detail(album));
  });

  app.get('/api/art/:albumId/:kind', async (req, res, next) => {
    const album = library.byId.get(req.params.albumId);
    const kind = req.params.kind;
    let ref = null;
    if (album && KINDS.includes(kind)) ref = album.art?.[kind];
    else if (album && /^g\d{1,3}$/.test(kind)) ref = album.gallery?.[Number(kind.slice(1))];
    if (!ref) return res.status(404).json({ error: 'Kein Bild vorhanden' });
    const size = ['sm', 'md', 'lg'].includes(req.query.s) ? req.query.s : 'md';
    try {
      const { file, type } = await renderArt({
        albumId: album.id,
        kind,
        ref,
        size,
        musicDir: config.musicDir,
        dataDir: config.dataDir
      });
      res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=600');
      res.type(type);
      res.sendFile(file, { dotfiles: 'allow', cacheControl: false }, (err) => err && !res.headersSent && next(err));
    } catch (err) {
      log.warn(`Bild ${album.id}/${kind} nicht verarbeitbar: ${err.message}`);
      res.status(422).json({ error: 'Bild konnte nicht gelesen werden' });
    }
  });

  app.get('/api/tracks/:id/stream', (req, res, next) => {
    const entry = library.tracks.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Titel nicht gefunden' });
    const abs = path.join(config.musicDir, entry.track.rel);
    if (!isInside(config.musicDir, abs)) return res.status(400).end();
    const transcode = entry.track.transcode || req.query.transcode === '1';
    if (transcode) {
      if (!transcoder.available) {
        return res.status(415).json({ error: 'Dieses Format braucht ffmpeg zum Abspielen, ffmpeg ist aber nicht verfügbar.' });
      }
      const start = Math.max(0, Number.parseFloat(req.query.start) || 0);
      return transcoder.stream(req, res, abs, { start });
    }
    sendDirect(res, abs, entry.track.mime.split(';')[0], next);
  });

  app.post('/api/scan', (req, res) => {
    const started = library.scan({ full: !!req.body?.full });
    res.status(202).json({ started, scan: library.scanState });
  });

  app.post('/api/albums/:id/online', (req, res) => {
    const raw = req.body?.mbid;
    const mbid = raw ? extractMbid(raw) : null;
    if (raw && !mbid) return res.status(400).json({ error: 'Keine gültige MusicBrainz-Release-ID erkannt' });
    if (!library.lookupOnline(req.params.id, mbid)) return res.status(404).json({ error: 'Album nicht gefunden' });
    res.status(202).json({ queued: true, mbid });
  });

  const CASE_VARIANTS = ['auto', 'jewel', 'slim', 'double', 'digipak'];
  app.put('/api/albums/:id/case', async (req, res) => {
    const variant = String(req.body?.variant ?? '');
    if (!CASE_VARIANTS.includes(variant)) return res.status(400).json({ error: `Unbekannte Hülle: ${variant}` });
    if (!(await library.setCaseVariant(req.params.id, variant))) return res.status(404).json({ error: 'Album nicht gefunden' });
    res.json({ id: req.params.id, caseVariant: variant === 'auto' ? null : variant });
  });

  // Favoriten: einzeln (PUT /api/albums/:id/favorite) oder viele (POST /api/favorites)
  app.put('/api/albums/:id/favorite', async (req, res) => {
    const favorite = req.body?.favorite !== false;
    const n = await library.setFavorite([req.params.id], favorite);
    if (n < 0) return res.status(404).json({ error: 'Album nicht gefunden' });
    res.json({ id: req.params.id, favorite });
  });

  app.post('/api/favorites', async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 20000) : null;
    if (!ids) return res.status(400).json({ error: 'ids fehlt' });
    const favorite = req.body?.favorite !== false;
    const changed = Math.max(0, await library.setFavorite(ids, favorite));
    res.json({ changed, favorite });
  });

  // Wiedergabelisten
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof CollectionError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  };
  app.get('/api/playlists', (_req, res) => res.json({ playlists: collections.list() }));
  app.get(
    '/api/playlists/:id',
    handle((req, res) => res.json(collections.get(req.params.id)))
  );
  app.post(
    '/api/playlists',
    handle((req, res) => res.status(201).json(collections.create(req.body?.name, req.body?.trackIds)))
  );
  app.patch(
    '/api/playlists/:id',
    handle((req, res) => res.json(collections.rename(req.params.id, req.body?.name)))
  );
  app.post(
    '/api/playlists/:id/tracks',
    handle((req, res) => res.json(collections.add(req.params.id, req.body?.trackIds)))
  );
  app.put(
    '/api/playlists/:id/tracks',
    handle((req, res) => res.json(collections.setTracks(req.params.id, req.body?.trackIds)))
  );
  app.delete(
    '/api/playlists/:id',
    handle((req, res) => {
      collections.remove(req.params.id);
      res.status(204).end();
    })
  );

  // Hörverlauf: Wiedergaben melden (für „Zuletzt gehört“ und die Statistik)
  app.get('/api/history', (req, res) => {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    res.json(collections.history({ limit: Number.isFinite(limit) ? limit : 100 }));
  });
  app.post('/api/history', (req, res) => {
    const trackId = String(req.body?.trackId ?? '');
    if (!trackId) return res.status(400).json({ error: 'trackId fehlt' });
    const at = Number(req.body?.at);
    const stat = collections.record(trackId, Number.isFinite(at) && at > 0 && at <= Date.now() + 60_000 ? at : Date.now());
    if (!stat) return res.status(404).json({ error: 'Titel nicht gefunden' });
    res.json(stat);
  });
  app.delete('/api/history', (_req, res) => {
    collections.clearHistory();
    res.status(204).end();
  });

  app.get('/api/themes', async (_req, res) => {
    res.json(await loadCustomThemes(config.dataDir, log));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unbekannter Endpunkt' }));

  // Weboberfläche
  if (fs.existsSync(config.staticDir)) {
    app.use(
      '/assets',
      express.static(path.join(config.staticDir, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false })
    );
    app.use(express.static(config.staticDir, { maxAge: '10m' }));
    const index = path.join(config.staticDir, 'index.html');
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  } else {
    app.get('/', (_req, res) =>
      res.type('text/plain').send('discbox-API läuft. Die Weboberfläche fehlt – bitte „npm run build“ ausführen.')
    );
  }

  app.use((err, _req, res, _next) => {
    if (err.status === 404 || err.statusCode === 404 || err.code === 'ENOENT') return res.status(404).end();
    if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') return;
    log.error('Fehler:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Interner Fehler' });
  });

  return app;
}
