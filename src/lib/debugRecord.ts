
type Entry = { t: number; data: unknown };

const FLUSH_MS = 400;
const MAX_BATCH = 200;
let entries: Entry[] = [];
let batchPath = '';
let timer = 0;
let listening = false;

function activeTopic() {
  return document.cookie.split(';').map((cookie) => cookie.trim().split('='))
    .find(([name]) => name === 'vcd-record')?.[1] ?? '';
}

function flush() {
  window.clearTimeout(timer);
  timer = 0;
  const topic = activeTopic();
  if (!entries.length || !topic) { entries = []; return; }
  let body = '';
  try { body = JSON.stringify({ topic, path: batchPath, width: window.innerWidth, height: window.innerHeight, entries }); }
  catch { body = JSON.stringify({ topic, path: batchPath, width: window.innerWidth, height: window.innerHeight, entries: [{ t: Date.now(), data: 'unserialisable entry' }] }); }
  entries = [];
  navigator.sendBeacon('/api/dev-record', body);
}

export function debugRecord(topic: string, data: unknown) {
  if (typeof document === 'undefined' || activeTopic() !== topic) return;
  const path = `${location.pathname}${location.search}`;
  if (entries.length && path !== batchPath) flush();
  batchPath = path;
  entries.push({ t: Date.now(), data });
  if (!listening) {
    listening = true;
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }
  if (entries.length >= MAX_BATCH) flush();
  else timer ||= window.setTimeout(flush, FLUSH_MS);
}
