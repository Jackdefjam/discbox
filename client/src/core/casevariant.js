// Welche Verpackung bekommt ein Album?
// Reihenfolge: eigene Festlegung → Verpackung laut MusicBrainz → Anzahl der CDs → Standard aus den Einstellungen.

import { VARIANTS } from '../scene/jewelcase.js';

/** Übersetzt MusicBrainz-Verpackungen in unsere Hüllenmodelle. */
export function packagingVariant(packaging, discs = 1) {
  const p = String(packaging ?? '').toLowerCase();
  if (!p || p === 'none' || p === 'other') return null;
  if (/digipak|digibook|digisleeve|gatefold|cardboard|paper sleeve|book/.test(p)) return 'digipak';
  if (/slim/.test(p)) return 'slim';
  if (/fatbox|double/.test(p)) return 'double';
  if (/jewel/.test(p)) return discs >= 2 ? 'double' : 'jewel';
  return null;
}

/** Liefert { variant, reason } – reason erklärt die automatische Wahl. */
export function resolveCase(album, settings) {
  if (album.caseVariant && VARIANTS[album.caseVariant]) return { variant: album.caseVariant, reason: 'manual' };
  if (settings.caseAuto !== false) {
    const fromMb = packagingVariant(album.packaging, album.discs ?? 1);
    if (fromMb) return { variant: fromMb, reason: 'musicbrainz' };
    if ((album.discs ?? 1) >= 2) return { variant: 'double', reason: 'discs' };
  }
  const def = VARIANTS[settings.defaultCase] ? settings.defaultCase : 'jewel';
  return { variant: def, reason: 'default' };
}

export const caseVariantFor = (album, settings) => resolveCase(album, settings).variant;
