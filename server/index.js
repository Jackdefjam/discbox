import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { Library } from './library.js';
import { createLogger } from './log.js';
import { Transcoder } from './stream.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

log.info(`discbox startet – Musik: ${config.musicDir}, Daten: ${config.dataDir}`);
if (!config.password) log.info('Kein DISCBOX_PASSWORD gesetzt – Zugriff ohne Anmeldung.');

const library = new Library({ config, log });
await library.init();

const transcoder = new Transcoder(config, log);
await transcoder.detect();

const app = createApp({ config, log, library, transcoder });
const server = app.listen(config.port, config.host, () => {
  log.info(`Weboberfläche: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
});
server.keepAliveTimeout = 65000;

if (config.scanOnStart || library.albums.length === 0) library.scan();
if (config.scanIntervalMinutes > 0) {
  setInterval(() => library.scan(), config.scanIntervalMinutes * 60 * 1000).unref();
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} empfangen – beende …`);
  server.close();
  try {
    if (!library.scanState.running) await library.save();
    await library.online.save.flush();
  } catch (err) {
    log.warn('Beim Beenden nicht gespeichert:', err.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
