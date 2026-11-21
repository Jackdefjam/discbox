import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const sha1 = (value, length = 12) =>
  crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, length);

/** Schlüssel zum Vergleichen von Namen: klein, ohne doppelte Leerzeichen, ohne Satzzeichen am Rand. */
export const norm = (value) =>
  String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/^[\s\-.,;:'"]+|[\s\-.,;:'"]+$/g, '')
    .trim();

export function mostCommon(values) {
  const counts = new Map();
  let best = undefined;
  let bestCount = 0;
  for (const v of values) {
    if (v == null || v === '') continue;
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function frequencySorted(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/** Begrenzt gleichzeitige asynchrone Aufgaben. */
export function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Konnte ${file} nicht lesen:`, err.message);
    return fallback;
  }
}

export async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

export const yearFrom = (value) => {
  if (value == null) return null;
  const m = String(value).match(/(1[89]\d\d|20\d\d)/);
  return m ? Number(m[1]) : null;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Prüft, ob ein absoluter Pfad innerhalb eines Basisordners liegt. */
export function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Leitet eine Schreibfunktion so ab, dass sie höchstens alle `ms` Millisekunden ausgeführt wird. */
export function throttleAsync(fn, ms) {
  let timer = null;
  let pending = false;
  let running = null;
  const run = async () => {
    timer = null;
    if (running) {
      pending = true;
      return;
    }
    running = fn().catch((e) => console.warn('Speichern fehlgeschlagen:', e.message));
    await running;
    running = null;
    if (pending) {
      pending = false;
      schedule();
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(run, ms);
  };
  schedule.flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (running) await running;
    await fn();
  };
  return schedule;
}
