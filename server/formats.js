// Audio-Dateitypen, MIME-Typen und die Entscheidung, ob ein Titel für Browser umgewandelt werden muss.

export const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.m4a', '.mp4', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff',
  '.wma', '.ape', '.wv', '.mpc', '.dsf', '.dff', '.mka', '.webm', '.tta'
]);

const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.ape': 'audio/x-ape',
  '.wv': 'audio/x-wavpack',
  '.mpc': 'audio/x-musepack',
  '.dsf': 'audio/x-dsf',
  '.dff': 'audio/x-dff',
  '.mka': 'audio/x-matroska',
  '.webm': 'audio/webm',
  '.tta': 'audio/x-tta'
};

export const mimeForExt = (ext) => MIME_BY_EXT[ext] ?? 'application/octet-stream';

/** Diese Formate spielt praktisch kein Browser ab – sie werden immer per ffmpeg umgewandelt. */
const NEVER_PLAYABLE = /alac|apple lossless|windows media|wma|monkey|\bape\b|wavpack|dsd|musepack|mpc|tta|true audio|ac-?3|e-ac-?3|dts|amr/i;
const NEVER_PLAYABLE_EXT = new Set(['.wma', '.ape', '.wv', '.mpc', '.dsf', '.dff', '.tta', '.mka']);

export function needsTranscode(ext, format = {}) {
  if (NEVER_PLAYABLE_EXT.has(ext)) return true;
  const codec = `${format.codec ?? ''} ${format.container ?? ''}`;
  return NEVER_PLAYABLE.test(codec);
}

/** Kurzer, lesbarer Codec-Name. */
export function codecLabel(ext, format = {}) {
  const codec = String(format.codec ?? '');
  const container = String(format.container ?? '');
  if (/layer 3|mp3/i.test(codec) || ext === '.mp3') return 'MP3';
  if (/flac/i.test(codec) || ext === '.flac') return 'FLAC';
  if (/alac/i.test(codec)) return 'ALAC';
  if (/aac/i.test(codec)) return 'AAC';
  if (/opus/i.test(codec) || ext === '.opus') return 'Opus';
  if (/vorbis/i.test(codec)) return 'Vorbis';
  if (/windows media|wma/i.test(codec) || ext === '.wma') return 'WMA';
  if (/monkey/i.test(codec) || ext === '.ape') return 'APE';
  if (/wavpack/i.test(codec) || ext === '.wv') return 'WavPack';
  if (/dsd/i.test(codec) || ext === '.dsf' || ext === '.dff') return 'DSD';
  if (/pcm/i.test(codec)) return /aiff/i.test(container) || ext.startsWith('.aif') ? 'AIFF' : 'WAV';
  if (ext === '.wav') return 'WAV';
  return (ext.replace('.', '') || 'Audio').toUpperCase();
}

const fmtKhz = (hz) => `${(hz / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kHz`;

/** Zusammenfassung wie „FLAC · 16 bit / 44,1 kHz“ oder „MP3 · 320 kbit/s“. */
export function formatSummary(tracks) {
  if (!tracks.length) return '';
  const labels = new Set(tracks.map((t) => t.codec));
  if (labels.size > 1) return 'Gemischte Formate';
  const label = tracks[0].codec;
  const lossless = tracks.every((t) => t.lossless);
  if (lossless) {
    const bits = tracks[0].bitsPerSample;
    const sr = tracks[0].sampleRate;
    const parts = [bits ? `${bits} bit` : null, sr ? fmtKhz(sr) : null].filter(Boolean);
    return parts.length ? `${label} · ${parts.join(' / ')}` : label;
  }
  const rates = tracks.map((t) => t.bitrate).filter(Boolean);
  if (!rates.length) return label;
  const avg = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length / 1000);
  return `${label} · ${avg} kbit/s`;
}
