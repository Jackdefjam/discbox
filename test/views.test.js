// Ansichten „Zuletzt gehört“ und „Wiedergabelisten“ im Client-Store.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, String(v))
};

const { Store, playlistDetail, recentBucket, relativeTime } = await import('../client/src/core/store.js');

// Fester Zeitpunkt: Mittwoch, 18. November 2026, 15:00 Ortszeit
const NOW = new Date(2026, 10, 18, 15, 0).getTime();
const at = (daysBack, hour = 12) => new Date(2026, 10, 18 - daysBack, hour, 0).getTime();

const albums = () => [
  { id: 'a', artist: 'Zebra', title: 'Eins', year: 1984, genres: ['Rock'], trackCount: 9 },
  { id: 'b', artist: 'Adler', title: 'Zwei', year: 1999, genres: ['Jazz'], trackCount: 8 },
  { id: 'c', artist: 'Moos', title: 'Drei', year: 1981, genres: ['Rock'], trackCount: 7 },
  { id: 'd', artist: 'Bär', title: 'Vier', genres: [], trackCount: 6 }
];

function makeStore(settings) {
  mem.set('discbox.settings.v1', JSON.stringify({ startView: 'all', ...settings }));
  const s = new Store();
  s.setAlbums(albums(), 1);
  return s;
}

test('Zeitabschnitte nach Kalendertagen', () => {
  assert.equal(recentBucket(at(0, 9), NOW), 0);
  assert.equal(recentBucket(at(1, 23), NOW), 1);
  assert.equal(recentBucket(at(1, 0), NOW), 1);
  assert.equal(recentBucket(at(2), NOW), 2);
  assert.equal(recentBucket(at(6), NOW), 2);
  assert.equal(recentBucket(at(7), NOW), 3);
  assert.equal(recentBucket(at(29), NOW), 3);
  assert.equal(recentBucket(at(30), NOW), 4);
});

test('Relative Zeitangaben', () => {
  assert.equal(relativeTime(NOW - 20_000, NOW), 'gerade eben');
  assert.equal(relativeTime(NOW - 5 * 60_000, NOW), 'vor 5 Min.');
  assert.equal(relativeTime(NOW - 2 * 3_600_000, NOW), 'vor 2 Std.');
  assert.match(relativeTime(at(1, 18), NOW), /^gestern, 18:00$/);
  assert.match(relativeTime(at(3, 9), NOW), /^Sonntag, 09:00$/);
  assert.equal(relativeTime(at(40), NOW), 'am 9. Oktober');
  assert.equal(relativeTime(new Date(2025, 0, 2).getTime(), NOW), 'am 2. Januar 2025');
});

test('Zuletzt gehört: nur gehörte Alben, neueste zuerst, in Zeitabschnitten', () => {
  const s = makeStore();
  s.setHistory({
    albums: { a: { n: 3, last: Date.now() - 60_000 }, c: { n: 1, last: Date.now() - 40 * 86_400_000 }, d: { n: 7, last: Date.now() - 1000 } },
    events: 11
  });
  s.setCollection('recent');
  assert.deepEqual(
    s.view.map((a) => a.id),
    ['d', 'a', 'c']
  );
  assert.deepEqual(
    s.groups.map((g) => g.title),
    ['Heute', 'Früher']
  );
  assert.equal(s.railShowsGroups, true);
  assert.equal(s.current.id, 'd', 'beim Wechsel in die Ansicht vorne anfangen');
  assert.equal(s.byId.get('a').plays, 3);
  assert.equal(s.playedCount, 3);

  // Neue Wiedergabe: Album rückt nach vorne, Auswahl bleibt beim gewählten Album
  s.select(2);
  s.notePlay({ albumId: 'b', n: 1, last: Date.now() });
  assert.deepEqual(
    s.view.map((a) => a.id),
    ['b', 'd', 'a', 'c']
  );
  assert.equal(s.current.id, 'c');
  assert.equal(s.historyEvents, 12);

  // Albumliste neu geladen (Rescan): Zähler bleiben erhalten
  s.setAlbums(albums(), 2);
  assert.equal(s.byId.get('d').plays, 7);
  assert.equal(s.view.length, 4);
});

test('Wiedergabelisten: eigene Ansicht, alphabetisch, Suche in den Titeln', () => {
  const s = makeStore();
  s.setPlaylists([
    { id: 'p1', name: 'Roadtrip', count: 3, duration: 600, albums: ['a', 'b'], albumCount: 2, preview: [{ title: 'Highway', artist: 'Zebra' }], created: 1, updated: 5 },
    { id: 'p2', name: 'Abendessen', count: 0, duration: 0, albums: [], preview: [], created: 2, updated: 2 }
  ]);
  assert.equal(s.collection, 'all', 'Listen tauchen in „Alle“ nicht auf');
  assert.ok(!s.view.some((a) => a.kind === 'playlist'));
  s.setCollection('playlists');
  assert.deepEqual(
    s.view.map((a) => a.title),
    ['Abendessen', 'Roadtrip']
  );
  assert.equal(s.view[1].id, 'pl:p1');
  assert.equal(s.view[1].kind, 'playlist');
  assert.equal(s.albumById('pl:p1').albumCount, 2);
  assert.deepEqual(
    s.letters().map((l) => l.letter),
    ['A', 'R']
  );
  s.setQuery('highway');
  assert.deepEqual(
    s.view.map((a) => a.title),
    ['Roadtrip']
  );
  s.setQuery('');

  // Geändert (z. B. Titel hinzugefügt): Zusammenfassung und Details ersetzt, Auswahl bleibt
  s.selectId('pl:p1');
  const updated = s.upsertPlaylist({
    id: 'p1',
    name: 'Roadtrip',
    count: 4,
    duration: 800,
    albums: ['a', 'b'],
    albumCount: 2,
    preview: [],
    created: 1,
    updated: 9,
    tracks: [
      { id: 't1', title: 'Eins', available: true, albumId: 'a' },
      { id: 't2', title: 'Weg', available: false }
    ]
  });
  assert.equal(updated.trackCount, 4);
  assert.equal(s.current.id, 'pl:p1');
  const d = s.cachedDetail('pl:p1');
  assert.deepEqual(
    d.tracks.map((t) => t.no),
    [1, 2],
    'Nummern = Position in der Liste'
  );

  // Gelöscht
  s.removePlaylist('p2');
  assert.deepEqual(
    s.view.map((a) => a.title),
    ['Roadtrip']
  );

  // Auswahl einer Liste aus einer anderen Ansicht springt in die Listen-Ansicht
  s.setCollection('all');
  s.selectId('pl:p1');
  assert.equal(s.collection, 'playlists');
  assert.equal(s.current.id, 'pl:p1');
});

test('Listen-Details: Nummern nach Position, nicht nach Albumtitelnummer', () => {
  const d = playlistDetail({ id: 'x', name: 'Mix', count: 2, tracks: [{ id: 'a', no: 7 }, { id: 'b', no: 2 }] });
  assert.deepEqual(
    d.tracks.map((t) => t.no),
    [1, 2]
  );
  assert.equal(d.id, 'pl:x');
});
