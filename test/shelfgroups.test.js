// Regalwand: Einteilung der Alben nach Genre, Jahrzehnt, Künstler-Buchstabe.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, String(v))
};

const { Store } = await import('../client/src/core/store.js');

const albums = () => [
  { id: 'a', artist: 'Zebra', title: 'Eins', year: 1984, genres: ['Rock'] },
  { id: 'b', artist: 'Adler', title: 'Zwei', year: 1999, genres: ['Jazz'] },
  { id: 'c', artist: 'Moos', title: 'Drei', year: 1981, genres: ['Rock'] },
  { id: 'd', artist: 'Bär', title: 'Vier', genres: [] },
  { id: 'e', artist: '808 State', title: 'Fünf', year: 2003, genres: ['Electronic'] }
];

function makeStore(settings) {
  mem.set('discbox.settings.v1', JSON.stringify({ startView: 'all', ...settings }));
  const s = new Store();
  s.setAlbums(albums(), 1);
  return s;
}

const summary = (s) => s.groups.map((g) => [g.title, s.view.slice(g.start, g.end + 1).map((a) => a.id).join('')]);

test('Regal nach Genre: Abschnitte alphabetisch, ohne Genre am Ende, darin nach Künstler', () => {
  const s = makeStore({ layout: 'shelf', shelfGroup: 'genre', sort: 'artist' });
  assert.deepEqual(summary(s), [
    ['Electronic', 'e'],
    ['Jazz', 'b'],
    ['Rock', 'ca'],
    ['Ohne Genre', 'd']
  ]);
  assert.deepEqual(s.letters().map((l) => l.letter), ['Electronic', 'Jazz', 'Rock', 'Ohne Genre']);
  assert.equal(s.letterAt(3), 'Rock');
  assert.equal(s.groupIndexOf(4), 3);
});

test('Regal nach Jahrzehnt: chronologisch, ohne Jahr am Ende', () => {
  const s = makeStore({ layout: 'shelf', shelfGroup: 'decade', sort: 'artist' });
  assert.deepEqual(summary(s), [
    ['1980er', 'ca'],
    ['1990er', 'b'],
    ['2000er', 'e'],
    ['Ohne Jahr', 'd']
  ]);
});

test('Regal nach Künstler: Ziffern unter # am Ende', () => {
  const s = makeStore({ layout: 'shelf', shelfGroup: 'letter', sort: 'artist' });
  assert.deepEqual(summary(s).map(([t]) => t), ['A', 'B', 'M', 'Z', '#']);
});

test('Andere Anordnungen ohne Einteilung; Wechsel behält die Auswahl', () => {
  const s = makeStore({ layout: 'coverflow', shelfGroup: 'genre', sort: 'artist' });
  assert.equal(s.groups, null);
  s.selectId('b');
  s.updateSettings({ layout: 'shelf' });
  assert.ok(s.groups);
  assert.equal(s.current.id, 'b');
  s.updateSettings({ shelfGroup: 'decade' });
  assert.equal(s.current.id, 'b');
  s.updateSettings({ layout: 'wheel' });
  assert.equal(s.groups, null);
  assert.equal(s.current.id, 'b');
});
