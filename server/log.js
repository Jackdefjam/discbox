const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const out = (lvl, args) => {
    if (LEVELS[lvl] < min) return;
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
    fn(`${ts} ${lvl.toUpperCase().padEnd(5)}`, ...args);
  };
  return {
    debug: (...a) => out('debug', a),
    info: (...a) => out('info', a),
    warn: (...a) => out('warn', a),
    error: (...a) => out('error', a)
  };
}
