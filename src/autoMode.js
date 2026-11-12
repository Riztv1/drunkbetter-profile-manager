'use strict';

const path = require('path');
const activeWin = require('active-win');
const cfg = require('./config');
const keyboard = require('./keyboard');
const configStore = require('./configStore');

const log = (...a) => console.log(`[auto ${new Date().toLocaleTimeString()}]`, ...a);

let lastProcess = null;
let timer = null;
let stopped = false;

async function getActiveWindowInfo() {
  const win = await activeWin();
  if (!win) return { exe: null, isSelf: false }; // escritorio sin foco, pantalla bloqueada, etc.
  // owner.path es más fiable que owner.name (que en Windows a veces omite .exe)
  const raw = win.owner?.path ? path.basename(win.owner.path) : win.owner?.name;
  const exe = raw ? raw.toLowerCase() : null;
  const isSelf = win.owner?.processId === process.pid
    || Boolean(exe && (exe === 'electron.exe' || exe.includes('drunkbetter') || exe.includes('drunkdeer')));
  return { exe, isSelf };
}

async function tick() {
  if (stopped) return;
  clearTimeout(timer);
  try {
    const { exe: proc, isSelf } = await getActiveWindowInfo();
    lastProcess = proc;

    if (configStore.getConfig().autoEnabled && keyboard.getStatus().connected && !isSelf) {
      const target = configStore.profileForProcess(proc);
      if (target !== keyboard.getStatus().currentProfile) {
        log(`Proceso activo: ${proc ?? '(ninguno)'} → ${target}`);
        await keyboard.applyProfile(target);
      }
    }
  } catch (err) {
    log('Error en el sondeo:', err.message);
  } finally {
    if (!stopped) timer = setTimeout(tick, cfg.POLL_INTERVAL_MS);
  }
}

module.exports = {
  start: () => tick(),
  stop: () => { stopped = true; clearTimeout(timer); },
  setEnabled: (value) => {
    const enabled = configStore.setAutoEnabled(value);
    log(enabled ? 'Modo automático ON' : 'Modo automático OFF (manual)');
    if (enabled && !stopped) tick();
  },
  getStatus: () => ({ enabled: configStore.getConfig().autoEnabled, lastProcess }),
};