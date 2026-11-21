import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discFromDirName, groupTracks, parseFolderName, stripDiscSuffix, titleFromFileName, VARIOUS } from '../server/grouping.js';

const file = (rel, tags = {}, format = {}) => {
  const parts = rel.split('/');
  const name = parts.pop();
  return {
    rel,
    dir: parts.join('/'),
    name,
    ext: name.slice(name.lastIndexOf('.')).toLowerCase(),
    mtime: 1,
    size: 1,
    tags,
    format: { codec: 'MPEG 1 Layer 3', bitrate: 320000, duration: 100, ...format }
  };
};

test('Disc-Ordner werden erkannt', () => {
  assert.deepEqual(discFromDirName('CD1'), { disc: 1, stem: null });
  assert.deepEqual(discFromDirName('Disc 2'), { disc: 2, stem: null });
  assert.deepEqual(discFromDirName('cd_03 - Bonus'), { disc: 3, stem: null });
  assert.deepEqual(discFromDirName('Doppelleben (CD 2)'), { disc: 2, stem: 'Doppelleben' });
  assert.deepEqual(discFromDirName('Best Of [Disc 1 of 2]'), { disc: 1, stem: 'Best Of' });
  assert.equal(discFromDirName('Disco 2000'), null);
  assert.equal(discFromDirName('Disco Inferno'), null);
  assert.equal(discFromDirName('CDs'), null);
});

test('Disc-Zusätze werden aus Albumtiteln entfernt', () => {
  assert.equal(stripDiscSuffix('Doppelleben (Disc 1)'), 'Doppelleben');
  assert.equal(stripDiscSuffix('Live - CD2'), 'Live');
  assert.equal(stripDiscSuffix('Live [CD 2]'), 'Live');
  assert.equal(stripDiscSuffix('1999'), '1999');
  assert.equal(stripDiscSuffix('Disco'), 'Disco');
});

test('Ordnernamen werden zerlegt', () => {
  assert.deepEqual(parseFolderName('2019 - Nachtfahrt'), { artist: null, album: 'Nachtfahrt', year: 2019 });
  assert.deepEqual(parseFolderName('Ocean Tapes (2004)'), { artist: null, album: 'Ocean Tapes', year: 2004 });
  assert.deepEqual(parseFolderName('Moonshine Collective - Basement Sessions'), {
    artist: 'Moonshine Collective',
    album: 'Basement Sessions',
    year: null
  });
  assert.deepEqual(parseFolderName('Kraftwerk - 1978 - Die Mensch-Maschine [FLAC]'), {
    artist: 'Kraftwerk',
    album: 'Die Mensch-Maschine',
    year: 1978
  });
});

test('Titel aus Dateinamen', () => {
  assert.equal(titleFromFileName('03 - Neonregen.flac'), 'Neonregen');
  assert.equal(titleFromFileName('03 Die Lichter - Neonregen.flac', 'Die Lichter'), 'Neonregen');
  assert.equal(titleFromFileName('1999.mp3'), '1999');
});

test('Doppel-CD in CD1/CD2-Ordnern wird ein Album', () => {
  const albums = groupTracks([
    file('Kai/Doppelleben/CD1/01 A.mp3', { album: 'Doppelleben', artist: 'Kai', trackNo: 1, discNo: 1 }),
    file('Kai/Doppelleben/CD1/02 B.mp3', { album: 'Doppelleben', artist: 'Kai', trackNo: 2, discNo: 1 }),
    file('Kai/Doppelleben/CD2/01 C.mp3', { album: 'Doppelleben', artist: 'Kai', trackNo: 1 }),
    file('Kai/Doppelleben/CD2/02 D.mp3', { album: 'Doppelleben', artist: 'Kai', trackNo: 2 })
  ]);
  assert.equal(albums.length, 1);
  const [a] = albums;
  assert.equal(a.title, 'Doppelleben');
  assert.equal(a.discs, 2);
  assert.equal(a.baseDir, 'Kai/Doppelleben');
  assert.deepEqual(
    a.tracks.map((t) => `${t.disc}.${t.no} ${t.title}`),
    ['1.1 A', '1.2 B', '2.1 C', '2.2 D']
  );
});

test('Geschwister-Ordner „Album (Disc n)“ werden zusammengeführt', () => {
  const albums = groupTracks([
    file('Best Of (Disc 1)/01.mp3', { album: 'Best Of (Disc 1)', artist: 'X', trackNo: 1 }),
    file('Best Of (Disc 2)/01.mp3', { album: 'Best Of (Disc 2)', artist: 'X', trackNo: 1 })
  ]);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].title, 'Best Of');
  assert.equal(albums[0].discs, 2);
});

test('Flacher Ordner mit mehreren Alben wird aufgeteilt und nutzt keine Ordnerbilder', () => {
  const albums = groupTracks([
    file('Singles/a.mp3', { album: 'A', artist: 'Eins' }),
    file('Singles/b.mp3', { album: 'A', artist: 'Eins' }),
    file('Singles/c.mp3', { album: 'B', artist: 'Zwei' })
  ]);
  assert.equal(albums.length, 2);
  assert.ok(albums.every((a) => a.sharedDir));
});

test('Compilations werden erkannt', () => {
  const albums = groupTracks([
    file('Comp/1.m4a', { album: 'Hits', artist: 'A' }),
    file('Comp/2.m4a', { album: 'Hits', artist: 'B' }),
    file('Comp/3.m4a', { album: 'Hits', artist: 'C' }),
    file('Comp/4.m4a', { album: 'Hits', artist: 'D' })
  ]);
  assert.equal(albums[0].artist, VARIOUS);
  assert.equal(albums[0].compilation, true);
  assert.equal(albums[0].tracks[1].artist, 'B');
});

test('Ohne Tags: Künstler und Album aus Ordnernamen', () => {
  const albums = groupTracks([file('Moonshine Collective - Basement Sessions/Track 1.wav', {}, { codec: 'PCM', lossless: true })]);
  assert.equal(albums[0].artist, 'Moonshine Collective');
  assert.equal(albums[0].title, 'Basement Sessions');
  assert.equal(albums[0].tracks[0].title, 'Track 1');
});

test('Ohne Tags: Künstler aus übergeordnetem Ordner', () => {
  const albums = groupTracks([file('Fjordlicht/Polarnacht/1. Nordlicht.ogg', {}, { codec: 'Vorbis I' })]);
  assert.equal(albums[0].artist, 'Fjordlicht');
  assert.equal(albums[0].title, 'Polarnacht');
  assert.equal(albums[0].tracks[0].title, 'Nordlicht');
  assert.equal(albums[0].tracks[0].no, 1);
});

test('Album-IDs bleiben stabil', () => {
  const tracks = [file('X/Y/01.mp3', { album: 'Y', artist: 'X' })];
  assert.equal(groupTracks(tracks)[0].id, groupTracks(tracks)[0].id);
});

test('WMA und ALAC werden zum Umwandeln markiert, FLAC nicht', () => {
  const albums = groupTracks([
    file('A/1.wma', { album: 'A' }, { codec: 'Windows Media Audio 9' }),
    file('B/1.m4a', { album: 'B' }, { codec: 'ALAC', container: 'M4A/isom', lossless: true }),
    file('C/1.flac', { album: 'C' }, { codec: 'FLAC', lossless: true })
  ]);
  const byTitle = Object.fromEntries(albums.map((a) => [a.title, a.tracks[0]]));
  assert.equal(byTitle.A.transcode, true);
  assert.equal(byTitle.B.transcode, true);
  assert.equal(byTitle.C.transcode, false);
  assert.equal(byTitle.C.mime, 'audio/flac');
});
