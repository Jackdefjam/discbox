// Wiedergabelisten und Hörverlauf: Speicher und API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { Collections } from '../server/collections.js';
import { loadConfig } from '../server/config.js';

const log = { debug() {}, info() {}, warn() {}, error: console.error };

/** Kleine Bibliothek im Speicher: zwei Alben mit je drei Titeln. */
function fakeLibrary() {
  const tracks = new Map();
  const albums = [];
  for (const [ai, title] of ['Nachtfahrt', 'Salzwiesen'].entries()) {
    const album = { id: `a${ai}`, title, artist: ai ? 'Dünenwind' : 'Die Lichter', tracks: [] };
    for (let i = 1; i <= 3; i++) {
      const t = { id: `a${ai}t${i}`, no: i, disc: 1, title: `${title} ${i}`, artist: null, duration: 60 * i, mime: 'audio/flac' };
      album.tracks.push(t);
      tracks.set(t.id, { album, track: t });
    }
    albums.push(album);
  }
  return { tracks, albums, byId: new Map(albums.map((a) => [a.id, a])) };
}

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbox-coll-'));
  const config = loadConfig({ musicDir: dataDir, dataDir, onlineCovers: false, staticDir: '/nonexistent' });
  const library = fakeLibrary();
  return { config, library, dataDir, coll: new Collections({ config, log, library }) };
}

test('Wiedergabelisten anlegen, füllen, sortieren, umbenennen, löschen', async () => {
  const { coll, library, config } = setup();
  await coll.init();
  const { playlist, added } = coll.create('  Roadtrip  ', ['a0t2', 'a1t1', 'unbekannt', 'a0t2']);
  assert.equal(playlist.name, 'Roadtrip');
  assert.equal(added, 2, 'unbekannte und doppelte Titel übersprungen');
  assert.deepEqual(
    playlist.tracks.map((t) => t.id),
    ['a0t2', 'a1t1']
  );
  assert.equal(playlist.duration, 120 + 60);
  assert.deepEqual(playlist.albums, ['a0', 'a1']);
  assert.equal(playlist.albumCount, 2);
  assert.equal(playlist.tracks[0].albumTitle, 'Nachtfahrt');
  assert.equal(playlist.tracks[0].artist, 'Die Lichter');

  const more = coll.add(playlist.id, ['a1t1', 'a1t2', 'a1t3']);
  assert.equal(more.added, 2);
  assert.equal(more.skipped, 1);
  assert.equal(more.playlist.count, 4);

  const sorted = coll.setTracks(playlist.id, ['a1t3', 'a0t2', 'a1t2']);
  assert.deepEqual(
    sorted.tracks.map((t) => t.id),
    ['a1t3', 'a0t2', 'a1t2']
  );

  assert.equal(coll.rename(playlist.id, 'Sommer').name, 'Sommer');
  assert.throws(() => coll.rename(playlist.id, '   '), /Namen/);
  assert.throws(() => coll.create('x'.repeat(81)), /zu lang/);

  // Titel verschwindet aus der Bibliothek: bleibt sichtbar, aber nicht verfügbar
  library.tracks.delete('a0t2');
  const after = coll.get(playlist.id);
  assert.equal(after.missing, 1);
  const gone = after.tracks.find((t) => t.id === 'a0t2');
  assert.equal(gone.available, false);
  assert.equal(gone.title, 'Nachtfahrt 2');

  // Gespeichert und wieder geladen
  await coll.save.flush();
  const again = new Collections({ config, log, library });
  await again.init();
  assert.equal(again.list()[0].name, 'Sommer');
  assert.equal(again.get(playlist.id).count, 3);

  again.remove(playlist.id);
  assert.equal(again.list().length, 0);
  assert.throws(() => again.get(playlist.id), /nicht gefunden/);
});

test('Hörverlauf zählt Wiedergaben je Album und Titel', async () => {
  const { coll } = setup();
  await coll.init();
  const t0 = 1_700_000_000_000;
  assert.equal(coll.record('a0t1', t0).n, 1);
  assert.equal(coll.record('a0t1', t0 + 5000).n, 1, 'Wiederholung innerhalb einer Minute zählt nicht');
  assert.equal(coll.record('a0t2', t0 + 70_000).n, 2);
  assert.equal(coll.record('a1t1', t0 + 140_000).n, 1);
  assert.equal(coll.record('gibtsnicht'), null);
  const h = coll.history({ limit: 10 });
  assert.equal(h.albums.a0.n, 2);
  assert.equal(h.albums.a0.last, t0 + 70_000);
  assert.equal(h.tracks.a0t1.n, 1);
  assert.equal(h.recent[0].trackId, 'a1t1', 'neueste zuerst');
  assert.equal(h.recent[0].albumTitle, 'Salzwiesen');
  assert.equal(h.events, 3);
  assert.equal(coll.history({ limit: 0 }).recent.length, 0, 'limit 0 liefert nur die Zähler');
  coll.clearHistory();
  assert.equal(coll.history().recent.length, 0);
  assert.deepEqual(coll.history().albums, {});
});

test('API für Listen und Verlauf', async () => {
  const { config, library } = setup();
  const app = createApp({ config, log, library, transcoder: { available: false } });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body) =>
    fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    let r = await json('POST', '/api/playlists', { name: 'Neu', trackIds: ['a0t1', 'a0t3'] });
    assert.equal(r.status, 201);
    const { playlist } = await r.json();
    assert.equal(playlist.count, 2);
    assert.equal((await json('POST', '/api/playlists', { name: '' })).status, 400);

    r = await json('POST', `/api/playlists/${playlist.id}/tracks`, { trackIds: ['a1t2'] });
    assert.equal((await r.json()).added, 1);
    r = await json('PUT', `/api/playlists/${playlist.id}/tracks`, { trackIds: ['a1t2', 'a0t1'] });
    assert.deepEqual(
      (await r.json()).tracks.map((t) => t.id),
      ['a1t2', 'a0t1']
    );
    r = await json('PATCH', `/api/playlists/${playlist.id}`, { name: 'Umbenannt' });
    assert.equal((await r.json()).name, 'Umbenannt');
    const list = await (await fetch(`${base}/api/playlists`)).json();
    assert.equal(list.playlists.length, 1);
    assert.equal(list.playlists[0].preview[0].title, 'Salzwiesen 2');
    assert.equal(list.playlists[0].preview[0].album, 'Salzwiesen');
    assert.equal((await json('GET', '/api/playlists/gibtsnicht')).status, 404);

    assert.equal((await json('POST', '/api/history', { trackId: 'a0t1' })).status, 200);
    assert.equal((await json('POST', '/api/history', { trackId: 'nix' })).status, 404);
    const h = await (await fetch(`${base}/api/history`)).json();
    assert.equal(h.albums.a0.n, 1);
    assert.equal((await json('DELETE', '/api/history')).status, 204);
    assert.equal((await json('DELETE', `/api/playlists/${playlist.id}`)).status, 204);
    assert.equal((await json('DELETE', `/api/playlists/${playlist.id}`)).status, 404);
  } finally {
    server.close();
  }
});
