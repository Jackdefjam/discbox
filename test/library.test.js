// Integrationstest gegen die erzeugte Testbibliothek (npm run testlib).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { Library } from '../server/library.js';
import { Transcoder } from '../server/stream.js';

const musicDir = path.resolve('testlib/music');
const skip = !fs.existsSync(musicDir) && 'Testbibliothek fehlt – „npm run testlib“ ausführen';

test('Scan der Testbibliothek und API', { skip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbox-lib-'));
  const log = { debug() {}, info() {}, warn() {}, error: console.error };
  const config = loadConfig({ musicDir, dataDir, onlineCovers: false, staticDir: '/nonexistent' });
  const library = new Library({ config, log });
  await library.init();
  library.scan();
  await once(library, 'change'); // Start
  while (library.scanState.running) await once(library, 'change');
  assert.equal(library.scanState.error, null);

  const find = (artist, title) => library.albums.find((a) => a.artist === artist && a.title === title);
  const nacht = find('Die Lichter', 'Nachtfahrt');
  assert.ok(nacht, 'Nachtfahrt gefunden');
  assert.equal(nacht.year, 2019);
  assert.deepEqual(Object.keys(nacht.art).sort(), ['back', 'disc', 'front']);

  const ocean = find('Marlow Bay', 'Ocean Tapes');
  assert.equal(ocean.art.front.src, 'embedded');
  assert.equal(ocean.art.back.src, 'embedded');

  const doppel = find('Kai Sommer', 'Doppelleben');
  assert.equal(doppel.discs, 2);
  assert.equal(doppel.trackCount, 8);
  assert.equal(doppel.art.back.src, 'folder');
  assert.match(doppel.art.back.rel, /Scans\/Back\.jpg$/);

  const comp = library.albums.find((a) => a.title === 'Sommerhits 1999');
  assert.equal(comp.artist, 'Various Artists');

  const wma = find('Old Archive', 'Live 2003');
  assert.equal(wma.art.front.rel.includes('AlbumArt_'), false, 'Folder.jpg bevorzugt');
  assert.ok(wma.tracks.every((t) => t.transcode));

  // API
  const transcoder = new Transcoder(config, log);
  await transcoder.detect();
  const app = createApp({ config, log, library, transcoder });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await (await fetch(`${base}/api/albums`)).json();
    assert.equal(list.albums.length, library.albums.length);
    const detail = await (await fetch(`${base}/api/albums/${nacht.id}`)).json();
    assert.equal(detail.tracks.length, 6);
    assert.equal(detail.tracks[0].title, 'Auffahrt');
    const img = await fetch(`${base}/api/art/${nacht.id}/front?s=sm`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    const range = await fetch(`${base}/api/tracks/${detail.tracks[0].id}/stream`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    const missing = await fetch(`${base}/api/tracks/doesnotexist/stream`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
