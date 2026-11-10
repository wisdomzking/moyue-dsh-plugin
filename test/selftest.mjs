/**
 * Offline self-check for the bundle halves (no browser, no DSH host needed).
 * 1) client.js: fake module loader + fake React, assert sidebar/main registrations.
 * 2) index.js: real watchdog logic 鈥?starts the reader server, verifies health, cleans up.
 *
 * Run: node test/selftest.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = fs.readFileSync(path.join(HERE, '..', 'client.js'), 'utf8');

const h = (type, props, ...children) => ({ type, props, children });
const ReactStub = { createElement: h, useState: (value) => [value, () => {}] };

let factory = null;
const sandbox = {
  window: { __ModuleLoader__: { load: (def) => { factory = def.factory; } }, setTimeout: () => 0, open: () => {} },
  console,
  setTimeout: () => 0,
};
vm.createContext(sandbox);
vm.runInContext(CLIENT, sandbox);
assert.equal(typeof factory, 'function', 'factory registered');

const clientModule = factory((name) => (name === 'react' ? ReactStub : {}));
assert.equal(clientModule.name, 'moyue-reader');
assert.equal(typeof clientModule.apply, 'function');

const registrations = [];
const locale = {
  register: () => () => {},
  bind: () => (key) => key,
};
const slots = {
  inject: (owner, callback) => callback(),
  register: (opts, component) => {
    registrations.push({ opts, component });
    return () => {};
  },
};
const ctx = {
  effect: (fn) => {
    const cleanup = fn();
    return cleanup || (() => {});
  },
  locale,
  inject: (services, callback) => {
    callback({ locale, slots });
    return () => {};
  },
};
clientModule.apply(ctx);

const sidebar = registrations.find((r) => r.opts.name === 'sidebar.panellist');
const main = registrations.find((r) => r.opts.name === 'main');
assert.ok(sidebar, 'sidebar panellist registered');
assert.equal(sidebar.opts.id, 'moyue-reader');
assert.equal(sidebar.opts.order, 20);
assert.equal(typeof sidebar.opts.label, 'function');
assert.equal(sidebar.opts.label(), 'panel.title');
assert.ok(main, 'main panel registered');
assert.equal(main.opts.key, 'moyue-reader');
assert.equal(typeof main.opts.inject, 'function');

const iconEl = sidebar.component({ size: 16, active: false });
assert.ok(iconEl && (iconEl.type === 'svg' || typeof iconEl.type === 'function'), 'sidebar icon renders');
const panelEl = main.component({ ...main.opts.inject() });
assert.ok(panelEl, 'panel component renders');
const panelProps = JSON.stringify(panelEl, (key, value) => (key === 'children' ? value : value));
assert.ok(panelProps.includes('iframe'), 'panel renders an iframe');
assert.ok(panelProps.includes('http://127.0.0.1:7788/'), 'iframe points at the local reader');
console.log('client.js self-check: OK (sidebar + main registrations, iframe panel)');

// ---------------------------------------------------------------- host half
const { apply } = await import(pathToFileURL(path.join(HERE, '..', 'index.js')).href);
assert.equal(typeof apply, 'function');

const health = async () => {
  try {
    const res = await fetch('http://127.0.0.1:7788/api/health', { signal: AbortSignal.timeout(900) });
    return res.ok;
  } catch (_) {
    return false;
  }
};

if (await health()) {
  console.log('host watchdog self-check: skipped (reader server already running)');
  process.exit(0);
}

let disposer = null;
const hostCtx = {
  effect: (fn) => {
    disposer = fn();
    return disposer;
  },
};
apply(hostCtx);
assert.equal(typeof disposer, 'function', 'watchdog cleanup installed');

let up = false;
for (let i = 0; i < 40; i += 1) {
  if (await health()) { up = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
assert.ok(up, 'watchdog started the reader server');
console.log('host watchdog self-check: OK (server started)');

disposer();
let down = false;
for (let i = 0; i < 20; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!(await health())) { down = true; break; }
}
assert.ok(down, 'watchdog cleanup stopped the server it started');
console.log('host watchdog self-check: OK (cleanup stopped the server)');

