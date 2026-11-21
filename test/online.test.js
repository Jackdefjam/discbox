import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractMbid, OnlineCovers, rankReleases } from '../server/online.js';

const R1 = '11111111-1111-1111-1111-111111111111';
const R2 = '22222222-2222-2222-2222-222222222222';

test('MusicBrainz-IDs werden aus URLs gelesen', () => {
  assert.equal(extractMbid(`https://musicbrainz.org/release/${R1}`), R1);
  assert.equal(extractMbid('quatsch'), null);
});

test('CD-Veröffentlichungen mit passender Titelzahl werden bevorzugt', () => {
  const ranked = rankReleases(
    [
      { id: 'vinyl', score: 100, 'track-count': 9, media: [{ format: '12" Vinyl' }], status: 'Official' },
      { id: 'cd', score: 95, 'track-count': 10, media: [{ format: 'CD' }], status: 'Official' },
      { id: 'low', score: 40 }
    ],
    { trackCount: 10 }
  );
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['cd', 'vinyl']
  );
});

test('Front und Back werden über mehrere Releases zusammengesucht', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbox-online-'));
  const calls = [];
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.match(opts.headers['User-Agent'], /^discbox\//);
    if (url.includes('musicbrainz.org/ws/2/release/?query=')) {
      assert.match(decodeURIComponent(url), /release:"Ocean Tapes" AND artist:"Marlow Bay"/);
      return json({
        releases: [
          { id: R1, score: 100, 'track-count': 5, media: [{ format: 'CD' }], 'release-group': { id: 'rg' } },
          { id: R2, score: 90, 'track-count': 5, media: [{ format: 'CD' }] }
        ]
      });
    }
    if (url.endsWith(`/release/${R1}`)) {
      return json({ images: [{ id: 1, front: true, back: false, types: ['Front'], image: 'http://img/front.jpg', thumbnails: { 1200: 'http://img/front-1200.jpg' } }] });
    }
    if (url.endsWith(`/release/${R2}`)) {
      return json({ images: [{ id: 2, front: false, back: true, types: ['Back'], image: 'http://img/back.jpg', thumbnails: {} }] });
    }
    if (url.startsWith('https://img/')) {
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`bild:${url}`).buffer };
    }
    return { ok: false, status: 404 };
  };
  const online = new OnlineCovers({ dataDir, contact: 'test', fetchImpl, mbDelay: 0 });
  const result = await online.lookup({ id: 'abc', title: 'Ocean Tapes', artist: 'Marlow Bay', trackCount: 5 });
  assert.equal(result.status, 'found');
  assert.equal(result.mbid, R1);
  assert.ok(fs.existsSync(path.join(dataDir, result.art.front.rel)));
  assert.ok(fs.existsSync(path.join(dataDir, result.art.back.rel)));
  assert.equal(result.art.back.mbid, R2);
  assert.ok(calls.some((u) => u === 'https://img/front-1200.jpg'), 'nutzt 1200er-Vorschau und https');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Mit lokalem Frontcover wird nur die Rückseite geladen', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbox-online-'));
  const downloaded = [];
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url) => {
    if (url.includes('/ws/2/release/')) return json({ releases: [{ id: R1, score: 100, 'track-count': 5, media: [{ format: 'CD' }] }] });
    if (url.endsWith(`/release/${R1}`)) {
      return json({ images: [
        { id: 1, front: true, types: ['Front'], image: 'https://img/f.jpg', thumbnails: {} },
        { id: 2, back: true, types: ['Back'], image: 'https://img/b.jpg', thumbnails: {} }
      ] });
    }
    downloaded.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer };
  };
  const online = new OnlineCovers({ dataDir, contact: 'test', fetchImpl, mbDelay: 0 });
  const album = { id: 'y', title: 'Ocean Tapes', artist: 'Marlow Bay', trackCount: 5, localArt: { front: { rel: 'cover.jpg' } } };
  const result = await online.lookup(album);
  assert.deepEqual(downloaded, ['https://img/b.jpg']);
  assert.deepEqual(Object.keys(result.art), ['back']);
  assert.equal(result.status, 'found');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Ohne Treffer: Status notfound, kein Absturz', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discbox-online-'));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ releases: [] }) });
  const online = new OnlineCovers({ dataDir, contact: 'test', fetchImpl, mbDelay: 0 });
  const album = { id: 'x', title: 'Gibt es nicht', artist: 'Niemand', trackCount: 3 };
  const result = await online.lookup(album);
  assert.equal(result.status, 'notfound');
  assert.equal(online.shouldLookup(album, ['front']), false, 'nicht sofort erneut suchen');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
