#!/usr/bin/env node
// @ts-check
/**
 * Runs `astro dev` and restarts it whenever the Alt+V active-view file changes.
 *
 * The active view (VIEW_ID) is baked in at Astro config load, so switching views
 * needs a fresh dev server. The DevViewSwitcher writes .dev-session/active-view;
 * this supervisor watches that file and cycles Astro so the new view renders
 * server-side — no manual terminal restart. Prod builds never involve this.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, watch } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sessionDir = path.join(root, '.dev-session');
const astroBin = path.join(root, 'node_modules', '.bin', 'astro');

mkdirSync(sessionDir, { recursive: true });

/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
let restarting = false;
let shuttingDown = false;

function startAstro() {
  child = spawn(astroBin, ['dev'], { cwd: root, env: process.env, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    child = null;
    // A restart-driven exit is expected; anything else means Astro died on its own.
    if (!restarting && !shuttingDown) {
      process.exit(code ?? (signal ? 1 : 0));
    }
  });
}

function restartAstro() {
  if (restarting || shuttingDown) return;
  restarting = true;
  const relaunch = () => {
    restarting = false;
    startAstro();
  };
  if (child) {
    child.once('exit', () => setTimeout(relaunch, 250));
    child.kill('SIGTERM');
  } else {
    setTimeout(relaunch, 250);
  }
}

startAstro();

let debounce = null;
watch(sessionDir, (_event, filename) => {
  if (filename !== 'active-view') return;
  clearTimeout(debounce);
  debounce = setTimeout(restartAstro, 150);
});

function shutdown() {
  shuttingDown = true;
  if (child) child.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
