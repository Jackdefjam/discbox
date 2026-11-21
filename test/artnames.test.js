import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyImage, pickFolderArt } from '../server/artnames.js';

test('Bildnamen werden richtig zugeordnet', () => {
  const kind = (n) => classifyImage(n).kind;
  for (const n of ['cover.jpg', 'Front.png', 'folder.jpg', 'Folder.JPG', 'AlbumArt_{7D3E2A10-5B1C-4E0F-9A77-3C5D1E2F4A6B}_Large.jpg', 'cd front.jpg', 'album.png']) {
    assert.equal(kind(n), 'front', n);
  }
  for (const n of ['back.jpg', 'Back Cover.png', 'rear.jpg', 'inlay.jpg', 'Rückseite.jpg', 'cover_back.jpg', 'cd-back.jpg']) {
    assert.equal(kind(n), 'back', n);
  }
  for (const n of ['cd.png', 'cd1.png', 'disc.png', 'cdart.png', 'discart.png', 'CD 2.jpg']) {
    assert.equal(kind(n), 'disc', n);
  }
  for (const n of ['Booklet 01.jpg', 'artist.jpg', 'logo.png']) {
    assert.equal(kind(n), 'other', n);
  }
});

test('cover.jpg gewinnt gegen AlbumArtSmall und folder.jpg', () => {
  const picked = pickFolderArt([
    { name: 'AlbumArtSmall.jpg', size: 5 },
    { name: 'folder.jpg', size: 50 },
    { name: 'cover.jpg', size: 40 }
  ]);
  assert.equal(picked.front.name, 'cover.jpg');
});

test('Einzelnes unbenanntes Bild wird Frontcover', () => {
  const picked = pickFolderArt([{ name: 'Nachtfahrt.jpg', size: 10 }]);
  assert.equal(picked.front.name, 'Nachtfahrt.jpg');
});

test('Ohne Cover im Albumordner: erste Booklet-Seite aus Scans', () => {
  const picked = pickFolderArt([
    { name: 'back.jpg', size: 10, depth: 1 },
    { name: 'page 02.jpg', size: 10, depth: 1 },
    { name: 'page 01.jpg', size: 10, depth: 1 }
  ]);
  assert.equal(picked.back.name, 'back.jpg');
  assert.equal(picked.front.name, 'page 01.jpg');
});
