import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));

const bool = (value, fallback) => {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|ja|on)$/i.test(String(value).trim());
};
const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(overrides = {}) {
  const config = {
    port: int(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    musicDir: path.resolve(env.MUSIC_DIR || '/music'),
    dataDir: path.resolve(env.DATA_DIR || '/data'),
    staticDir: path.resolve(env.STATIC_DIR || path.join(here, '..', 'dist')),
    user: env.DISCBOX_USER || 'discbox',
    password: env.DISCBOX_PASSWORD || '',
    onlineCovers: bool(env.ONLINE_COVERS, true),
    onlinePackaging: bool(env.ONLINE_PACKAGING, true),
    contact: env.MUSICBRAINZ_CONTACT || 'https://github.com/Jackdefjam/discbox',
    scanOnStart: bool(env.SCAN_ON_START, true),
    scanIntervalMinutes: Math.max(0, int(env.SCAN_INTERVAL_MINUTES, 360)),
    scanConcurrency: Math.max(1, int(env.SCAN_CONCURRENCY, 4)),
    transcode: (env.TRANSCODE || 'auto').toLowerCase() === 'off' ? 'off' : 'auto',
    transcodeFormat: ['mp3', 'opus', 'flac'].includes((env.TRANSCODE_FORMAT || '').toLowerCase())
      ? env.TRANSCODE_FORMAT.toLowerCase()
      : 'mp3',
    transcodeBitrate: env.TRANSCODE_BITRATE || '320k',
    maxTranscodes: Math.max(1, int(env.MAX_TRANSCODES, 6)),
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
    ...overrides
  };
  return config;
}
