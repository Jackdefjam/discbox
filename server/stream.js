// Liefert Audiodateien aus: direkt (mit Range-Unterstützung zum Spulen) oder per ffmpeg umgewandelt.

import { spawn } from 'node:child_process';

const OUTPUT = {
  mp3: { type: 'audio/mpeg', args: (br) => ['-c:a', 'libmp3lame', '-b:a', br, '-f', 'mp3'] },
  opus: { type: 'audio/ogg', args: (br) => ['-c:a', 'libopus', '-b:a', parseInt(br, 10) > 256 ? '192k' : br, '-f', 'ogg'] },
  flac: { type: 'audio/flac', args: () => ['-c:a', 'flac', '-compression_level', '0', '-f', 'flac'] }
};

export class Transcoder {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.available = false;
    this.active = new Set();
  }

  /** Prüft, ob ffmpeg vorhanden ist. */
  async detect() {
    if (this.config.transcode === 'off') return (this.available = false);
    this.available = await new Promise((resolve) => {
      try {
        const p = spawn(this.config.ffmpegPath, ['-hide_banner', '-version'], { stdio: 'ignore' });
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
    this.log.info(this.available ? 'ffmpeg gefunden – Transcoding aktiv' : 'ffmpeg nicht gefunden – Transcoding aus');
    return this.available;
  }

  stream(req, res, absPath, { start = 0 } = {}) {
    // Zu viele parallele Umwandlungen? Die älteste (meist verwaiste Vorab-Ladung) beenden.
    while (this.active.size >= this.config.maxTranscodes) {
      const oldest = this.active.values().next().value;
      this.active.delete(oldest);
      oldest.kill('SIGKILL');
    }
    const out = OUTPUT[this.config.transcodeFormat] ?? OUTPUT.mp3;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (start > 0) args.push('-ss', start.toFixed(2));
    args.push('-i', absPath, '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1');
    args.push(...out.args(this.config.transcodeBitrate), 'pipe:1');

    const proc = spawn(this.config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.active.add(proc);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      if (stderr.length < 4000) stderr += d;
    });
    res.status(200).set({
      'Content-Type': out.type,
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'none',
      'X-Discbox-Transcoded': '1'
    });
    proc.stdout.pipe(res);
    const stop = () => {
      if (proc.exitCode == null) proc.kill('SIGKILL');
    };
    req.on('close', stop);
    res.on('close', stop);
    proc.on('error', (err) => {
      this.active.delete(proc);
      this.log.warn(`ffmpeg konnte nicht starten: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    proc.on('close', (code, signal) => {
      this.active.delete(proc);
      if (code && signal !== 'SIGKILL') this.log.warn(`ffmpeg beendet (${code}): ${stderr.trim().slice(0, 300)}`);
      res.end();
    });
  }
}

/** Direkte Auslieferung mit Range, ETag und Last-Modified. */
export function sendDirect(res, absPath, mime, next) {
  res.type(mime);
  res.sendFile(
    absPath,
    {
      dotfiles: 'allow',
      acceptRanges: true,
      lastModified: true,
      etag: true,
      cacheControl: false,
      headers: { 'Cache-Control': 'private, max-age=86400' }
    },
    (err) => {
      if (err && !res.headersSent) next(err);
    }
  );
}
