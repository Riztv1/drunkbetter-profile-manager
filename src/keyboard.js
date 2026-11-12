'use strict';

const HID = require('node-hid');
const cfg = require('./config');
const PROFILES = require('./profiles');
const configStore = require('./configStore');
const {
  buildProfileFrames, buildPerformanceFrame, buildCustomLightFrames, buildEffectFrame, buildKeyTrackingFrame,
  KEYS_PER_BLOCK, CMD_CONFIG, REPORT_ID, REPORT_LENGTH,
} = require('./protocol');
const remap = require('./remap');

let currentRemapSig = ''; // firma del último remap/modo enviado ('' = estado base sin cambios)
let lastHadLayers = false; // si el último envío de remap incluía capas personalizadas (Default/Fn/Fn2)
// Estado REAL de Turbo en el teclado: solo cambia cuando de verdad se envían tramas (dentro de la cola HID).
let lastTurboState = false;
let lastCustomColors = new Map();
let lastTurboColors = new Map();
let lastBrightness = 9;

function setCustomColorsCache(map, brightness = 9) {
  if (map instanceof Map) lastCustomColors = new Map(map);
  if (Number.isFinite(Number(brightness))) lastBrightness = Math.min(9, Math.max(0, Number(brightness)));
}

function setTurboColorsCache(map, brightness = 9) {
  if (map instanceof Map) lastTurboColors = new Map(map);
  if (Number.isFinite(Number(brightness))) lastBrightness = Math.min(9, Math.max(0, Number(brightness)));
}

/** Guarda (en config.json) el último modo de iluminación NO turbo, para restaurarlo al apagar Turbo Mode. */
function setLastActiveLighting(state) {
  try { configStore.updateSettings({ lastLighting: state || null }); } catch (_) { /* noop */ }
}

function defaultTurboColors(baseMap) {
  const map = new Map(baseMap);
  // En la captura oficial de Turbo mode light (drunkdeer_capture_Colours_lightning_turn_off.json),
  // si el usuario no ha fijado color para el slot 44 (0xAC), se marca en rojo [255, 0, 0].
  if (!map.has(44)) map.set(44, [255, 0, 0]);
  return map;
}

function buildRestoredLightingFrames(profile) {
  const frames = [];
  // 1) Pasar siempre por Custom light (ae 01 00 00 13 06…) para desbloquear el firmware al salir de Turbo mode light
  frames.push(...buildCustomLightFrames(lastCustomColors, { turbo: false, brightness: lastBrightness }));
  // 2) Reenviar el efecto que había antes (Always light, Spectrum, Off…). Así efectos con velocidad (SP+/SP-) siguen funcionando.
  const p = configStore.getConfig().settings?.lastLighting;
  if (p && p.effect && p.effect !== 'custom') {
    if (p.effect === 'off') {
      frames.push(buildKeyTrackingFrame(Boolean(profile?.features?.keystrokeTracking)));
      frames.push(buildEffectFrame({ effect: 'off', speed: p.speed ?? 5, brightness: p.brightness ?? 9, colour: 0 }));
      const a0 = new Array(REPORT_LENGTH).fill(0);
      a0.splice(0, 3, REPORT_ID, 0xa0, 0x02);
      frames.push(a0);
    } else {
      frames.push(buildEffectFrame(p));
    }
  }
  return frames;
}

/** Tramas que dejan el teclado en el estado Turbo/no-Turbo que pide el perfil (siempre coherentes con lastTurboState). */
function turboTransitionFrames(profile, forceRestore = false) {
  const turboNow = Boolean(profile.features?.turboMode);
  const frames = [];
  if (turboNow) frames.push(...buildCustomLightFrames(defaultTurboColors(lastTurboColors), { turbo: true, brightness: lastBrightness }));
  else if (lastTurboState || forceRestore) frames.push(...buildRestoredLightingFrames(profile));
  return { turboNow, frames };
}

let device = null;
let currentProfile = null; // clave del último perfil aplicado, o null
let reconnectTimer = null;
let closed = false;
let lastDeviceError = null;
let deviceInfo = null;
let lastWriteInfo = null;
let pendingEcho = null; // { frame, resolve }: trama b6 enviada que espera su eco

// Cola de escrituras: evita intercalar informes de perfiles distintos.
let queue = Promise.resolve();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[kb ${new Date().toLocaleTimeString()}]`, ...a);

// ───────── Lector (eco del teclado) ─────────
// El teclado repite como informe de entrada cada trama b6 que acepta. Hay que LEER el canal
// (como hace la sonda y la web oficial) y usar el eco como confirmación.

function attachReader(dev) {
  dev.on('data', (data) => {
    if (!pendingEcho) return;
    const sent = pendingEcho.frame;
    // [reportId, cmd, sub, 0x00, bloque]
    if (data[0] === sent[0] && data[1] === sent[1] && data[2] === sent[2] && data[4] === sent[4]) {
      const { resolve } = pendingEcho;
      pendingEcho = null;
      resolve(true);
    }
  });
}

function waitForEcho(frame, timeoutMs) {
  return new Promise((resolve) => {
    const entry = { frame, resolve: null };
    const timer = setTimeout(() => {
      if (pendingEcho === entry) pendingEcho = null;
      resolve(false);
    }, timeoutMs);
    entry.resolve = (ok) => { clearTimeout(timer); resolve(ok); };
    pendingEcho = entry;
  });
}

// ───────── Conexión ─────────

function findDevicePath() {
  let devices;
  try {
    devices = HID.devices();
  } catch (error) {
    lastDeviceError = `No se pudo consultar HID: ${error.message}`;
    log(lastDeviceError);
    return null;
  }

  const candidates = devices.filter((d) =>
    d.vendorId === cfg.VENDOR_ID && d.productId === cfg.PRODUCT_ID
  );

  if (!candidates.length) {
    lastDeviceError = `No se encontró HID VID ${cfg.VENDOR_ID} / PID ${cfg.PRODUCT_ID} entre ${devices.length} dispositivos.`;
    log(lastDeviceError);
    return null;
  }

  log(`Interfaces coincidentes VID ${cfg.VENDOR_ID} / PID ${cfg.PRODUCT_ID}: ${candidates.length}`);
  for (const candidate of candidates) {
    log(`HID interface: ${JSON.stringify({
      product: candidate.product,
      manufacturer: candidate.manufacturer,
      path: candidate.path,
      interface: candidate.interface,
      usagePage: candidate.usagePage,
      usage: candidate.usage,
      vendorId: candidate.vendorId,
      productId: candidate.productId,
    })}`);
  }

  const isTypingInterface = (d) => /\\KBD(?:$|&)/i.test(d.path || '')
    || (d.usagePage === 0x01 && d.usage === 0x06);
  const target = candidates.find((d) => !isTypingInterface(d) && d.usagePage === 0xff00)
    || candidates.find((d) => !isTypingInterface(d) && d.interface !== 0)
    || null;

  if (target) {
    lastDeviceError = null;
    deviceInfo = {
      product: target.product,
      manufacturer: target.manufacturer,
      path: target.path,
      interface: target.interface,
      usagePage: target.usagePage,
      usage: target.usage,
      vendorId: target.vendorId,
      productId: target.productId,
    };
    log(`Seleccionada interfaz de configuración: ${JSON.stringify(deviceInfo)}`);
    return target.path;
  }

  lastDeviceError = 'No se encontró una interfaz vendor-specific ni una interfaz de datos no-KBD.';
  log(lastDeviceError);
  return null;
}

function connect() {
  const p = findDevicePath();
  if (!p) return false;
  try {
    device = new HID.HID(p);
    const openedInfo = device.getDeviceInfo();
    if (openedInfo.path !== p || openedInfo.usagePage === 0x01 && openedInfo.usage === 0x06) {
      device.close();
      device = null;
      throw new Error('La interfaz abierta no coincide con el canal HID de configuración seleccionado');
    }
    deviceInfo = { ...deviceInfo, ...openedInfo };
    attachReader(device);
    device.on('error', (err) => {
      log('Error HID:', err.message);
      handleDisconnect();
    });
    log(`Handle HID abierto: ${JSON.stringify(deviceInfo)}`);
    log('Teclado conectado en la interfaz de configuración.');
    lastDeviceError = null;
    return true;
  } catch (err) {
    try { device?.close(); } catch (_) { /* noop */ }
    lastDeviceError = `No se pudo abrir la interfaz HID: ${err.message}`;
    log(lastDeviceError);
    device = null;
    return false;
  }
}

function handleDisconnect() {
  if (device) {
    try { device.close(); } catch (_) { /* ya cerrado */ }
  }
  device = null;
  currentProfile = null; // fuerza reaplicar al reconectar
  currentRemapSig = '';
  lastHadLayers = false;
  lastTurboState = false; // al reconectar no se sabe en qué estado queda el teclado
  pendingEcho = null;
  scheduleReconnect();
}

function preferredStartupProfile() {
  const cfgData = configStore.getConfig();
  const ids = new Set(cfgData.profiles.map((p) => p.id));
  const manual = cfgData.settings?.manualProfileId;
  const last = cfgData.settings?.lastProfileId;
  if (!cfgData.autoEnabled && manual && ids.has(manual)) return manual;
  if (last && ids.has(last)) return last;
  return 'default';
}

function scheduleReconnect() {
  if (reconnectTimer || closed) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (connect()) await applyProfile(preferredStartupProfile(), true);
    else scheduleReconnect();
  }, cfg.RECONNECT_INTERVAL_MS);
}

async function _apply(key, force, { forceTurboRestore = false } = {}) {
  const profile = configStore.getConfig().profiles.find((item) => item.id === key) || PROFILES[key];
  if (!profile) throw new Error(`Perfil desconocido: ${key}`);
  if (!device) throw new Error('Teclado no conectado');
  if (!force && currentProfile === key) return;

  // Orden del software oficial: b5 (turbo / rapid trigger / modo) -> b6 01,04,05 -> tabla de remap (con las teclas de Last Win).
  const frames = profile.keys_array
    ? [performanceFrame(profile), ...buildProfileFrames(profile, { init: cfg.SEND_INIT_QUERY, downstroke: cfg.SEND_SENSITIVITY, rapidTrigger: Boolean(profile.features?.rapidTrigger) })]
    : profile.frames.map((frame) => {
      const report = new Array(cfg.REPORT_LENGTH).fill(0);
      report[0] = cfg.REPORT_ID;
      report.splice(1, Math.min(frame.length, cfg.REPORT_PAYLOAD_LENGTH), ...frame.slice(0, cfg.REPORT_PAYLOAD_LENGTH));
      return report;
    });

  if (profile.keys_array) {
    log(`Perfil ${profile.showname || profile.name}: ${profile.keys_array.length} teclas; ${frames.length} trama(s).`);
    const custom = profile.keys_array.filter((entry) => entry.action_point !== 2);
    const summary = custom.slice(0, 8).map((entry) => `${entry.keyname}=${entry.action_point}`).join(' ');
    log(`Slots con action_point distinto de 2.0 mm: ${custom.length ? summary + (custom.length > 8 ? ' …' : '') : 'ninguno'}`);
  }

  try {
    for (const frame of frames) {
      const isConfig = frame[1] === CMD_CONFIG;
      const block = isConfig ? frame[4] : null;
      const ack = isConfig ? waitForEcho(frame, cfg.ECHO_TIMEOUT_MS) : null; // antes de escribir
      const bytesWritten = device.write(frame);
      const echoed = ack ? await ack : null;
      lastWriteInfo = {
        reportId: frame[0],
        command: frame[1],
        sub: frame[2],
        block,
        bufferLength: frame.length,
        bytesWritten,
        echoed,
        keys: isConfig
          ? profile.keys_array.slice(block * KEYS_PER_BLOCK, (block + 1) * KEYS_PER_BLOCK).map((entry) => entry.keyname)
          : [],
      };
      const head = frame.slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
      const echoText = echoed === null ? '' : echoed ? ' eco=OK' : ' eco=NO';
      log(`HID write: ${head} ... buffer=${frame.length} returned=${bytesWritten}${echoText}`);
      if (echoed === false) log('⚠ El teclado no confirmó esta trama (sin eco): puede haberla rechazado o ignorado.');
      if (bytesWritten !== frame.length) log(`⚠ node-hid escribió ${bytesWritten} de ${frame.length} bytes`);
      if (!Number.isFinite(bytesWritten) || bytesWritten <= 0) {
        throw new Error(`node-hid devolvió un tamaño de escritura inválido: ${bytesWritten}`);
      }
      await sleep(cfg.FRAME_DELAY_MS);
    }
    await syncRemap(profile, false);
    const turbo = turboTransitionFrames(profile, forceTurboRestore);
    if (turbo.frames.length) await _sendRaw(turbo.frames, turbo.turboNow ? 'turbo light' : 'restaurar luz tras turbo', { echo: false });
    lastTurboState = turbo.turboNow;
    currentProfile = key;
    try { configStore.updateSettings({ lastProfileId: key }); } catch (_) { /* noop */ }
    lastDeviceError = null;
    log(`Perfil aplicado: ${profile.showname || profile.name}; ${frames.length} informes HID enviados.`);
  } catch (err) {
    lastDeviceError = `Error al escribir informe HID: ${err.message}`;
    log(lastDeviceError);
    handleDisconnect();
    throw err;
  }
}

/** Aplica un perfil (serializado en cola). */
function applyProfile(key, force = false) {
  const run = queue.then(() => _apply(key, force));
  queue = run.catch(() => {}); // un fallo no rompe la cola
  return run;
}

/**
 * Aplica el cambio de Turbo Mode usando la misma secuencia completa con eco hardware (b5 -> b6 01/04/05 -> luz)
 * que usa autoMode al abrir/cerrar aplicaciones, y coalesciendo pulsaciones rápidas para que la cola nunca se acumule.
 */
let pendingTurboKey = null;
let pendingTurboPromise = null;
function applyTurbo(key) {
  pendingTurboKey = key;
  if (!pendingTurboPromise) {
    const run = queue.then(async () => {
      while (pendingTurboKey !== null) {
        const targetKey = pendingTurboKey;
        pendingTurboKey = null;
        await _apply(targetKey, true, { forceTurboRestore: true });
      }
    });
    queue = run.catch(() => {});
    pendingTurboPromise = run.finally(() => {
      pendingTurboPromise = null;
    });
  }
  return pendingTurboPromise;
}

/**
 * Envía tramas ya construidas (iluminación, remap…) por la misma cola que los perfiles.
 * Espera el eco de cada trama (si el teclado no lo da, se avisa y se sigue).
 */
async function _sendRaw(frames, label, { echo = true } = {}) {
  if (!device) throw new Error('Teclado no conectado');
  let echoes = 0;
  let expectEcho = echo; // si la 1ª trama no tiene eco, esa familia de comandos no lo da: no se espera más
  try {
    for (const [index, frame] of frames.entries()) {
      const ack = expectEcho ? waitForEcho(frame, cfg.ECHO_TIMEOUT_MS) : null; // antes de escribir
      const bytesWritten = device.write(frame);
      const echoed = ack ? await ack : null;
      if (echoed === false && index === 0) expectEcho = false;
      if (!Number.isFinite(bytesWritten) || bytesWritten <= 0) {
        throw new Error(`node-hid devolvió un tamaño de escritura inválido: ${bytesWritten}`);
      }
      if (echoed) echoes += 1;
      lastWriteInfo = { reportId: frame[0], command: frame[1], sub: frame[2], block: frame[4], bufferLength: frame.length, bytesWritten, echoed, keys: [] };
      const head = frame.slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
      log(`HID write [${label}]: ${head} ... buffer=${frame.length} returned=${bytesWritten} eco=${echoed === null ? '-' : echoed ? 'OK' : 'NO'}`);
      await sleep(cfg.FRAME_DELAY_MS);
    }
  } catch (err) {
    lastDeviceError = `Error al escribir informe HID: ${err.message}`;
    log(lastDeviceError);
    handleDisconnect();
    throw err;
  }
  return { frames: frames.length, echoed: echoes };
}

/** Envía tramas ya construidas (iluminación, remap…) por la misma cola que los perfiles. */
function sendRaw(frames, label = 'raw', options = {}) {
  const run = queue.then(() => _sendRaw(frames, label, options));
  queue = run.catch(() => {});
  return run;
}

// ───────── Remap por perfil ─────────
// Cada perfil puede llevar su propio remap (profile.remap). Si no lo tiene se usa el remap global (config.baseRemap).
// Solo se reenvía cuando cambia respecto a lo último enviado, y al salir de un perfil con remap se restaura el global.
function desiredRemap(profile) {
  if (profile && remap.hasEntries(profile.remap)) return profile.remap;
  const base = configStore.getConfig().baseRemap;
  return remap.hasEntries(base) ? base : null;
}

/** Grupos de Last Win activos del perfil: [[nombreA, nombreB], …] (vacío si Last Win está apagado). */
function lastWinNames(profile) {
  if (!profile?.rtp?.lw_open) return [];
  return (profile.features?.lastWinGroups || []).map((group) => group.keys.map((key) => key.keyname));
}

/** Grupos de Release Dual-Trigger activos del perfil (vacío si está apagado). */
function dualTriggerGroups(profile) {
  if (!cfg.DUAL_TRIGGER_READY || !profile?.rtp?.rdt_open) return [];
  return (profile.rtp?.rdt_rtpSettings || []).filter(
    (g) => g && g.isRdtEnabled !== false && g.mainKey?.keyname && g.triggerKey?.keyname
  );
}

/** Trama b5: turbo, rapid trigger y modo (Last Win / Release Dual-Trigger) del perfil. */
function performanceFrame(profile) {
  const features = profile.features || {};
  const lastWin = Boolean(profile?.rtp?.lw_open);
  const dual = cfg.DUAL_TRIGGER_READY && Boolean(profile?.rtp?.rdt_open);
  const mode = lastWin ? 'lastWin' : dual ? 'dualTrigger' : 'none';
  return buildPerformanceFrame({ turbo: Boolean(features.turboMode), rapidTrigger: Boolean(features.rapidTrigger), mode });
}

async function syncRemap(profile, force = false) {
  const layers = desiredRemap(profile);
  const lastWin = lastWinNames(profile);
  const dualGroups = dualTriggerGroups(profile);
  const isPerfMode = Boolean(profile?.rtp?.lw_open || (cfg.DUAL_TRIGGER_READY && profile?.rtp?.rdt_open));
  const sig = layers || lastWin.length || dualGroups.length || isPerfMode
    ? JSON.stringify({ layers, lastWin, dualGroups, lw: Boolean(profile?.rtp?.lw_open), rdt: Boolean(profile?.rtp?.rdt_open) })
    : '';
  if (!force && sig === currentRemapSig) return null;
  // Si venimos de «Aplicar al teclado» en Remap (force = true), o hay capas personalizadas, o veníamos de un perfil con capas,
  // enviamos las 3 capas (Default + Fn + Fn2 = 44 tramas). Solo cuando es únicamente un cambio de Performance (Last Win /
  // Dual-Trigger) sin capas de remap enviamos los 14 bloques de Default + 'aa 00 01' (+ a7/a8) + 'a0 02'.
  const onlyDefaultLayer = !force && !layers && !lastHadLayers;
  const built = remap.build(layers || {}, { lastWin, dualGroups, onlyDefaultLayer });
  await _sendRaw(built.frames, 'remap');
  currentRemapSig = sig;
  lastHadLayers = Boolean(layers);
  return { frames: built.frames.length, derived: built.derived };
}

/** Reenvía el remap que corresponde al perfil actualmente aplicado (tras guardar un remap). */
function refreshRemap() {
  const run = queue.then(() => {
    if (!device) throw new Error('Teclado no conectado');
    const id = currentProfile || 'default';
    const profile = configStore.getConfig().profiles.find((item) => item.id === id);
    return syncRemap(profile, true);
  });
  queue = run.catch(() => {});
  return run;
}

// ───────── API pública ─────────

function start() {
  if (connect()) return applyProfile(preferredStartupProfile(), true).catch(() => {});
  log('Teclado no encontrado. Reintentando en segundo plano...');
  scheduleReconnect();
}

async function stop({ reset = true, profileId = 'default' } = {}) {
  closed = true;
  clearTimeout(reconnectTimer);
  if (device) {
    if (reset) await applyProfile(profileId, true).catch(() => {});
    try { device.close(); } catch (_) { /* noop */ }
    device = null;
  }
}

const getStatus = () => ({ connected: !!device, currentProfile, deviceInfo, lastWriteInfo, error: lastDeviceError });

const listProfiles = () =>
  Object.entries(PROFILES).map(([key, p]) => ({ key, name: p.name }));

module.exports = {
  start, stop, applyProfile, applyTurbo, sendRaw, refreshRemap, getStatus, listProfiles,
  buildProfileFrames, performanceFrame, setCustomColorsCache, setTurboColorsCache,
  setLastActiveLighting, defaultTurboColors,
  getLastCustomColors: () => lastCustomColors,
  getLastTurboColors: () => lastTurboColors,
  getLastBrightness: () => lastBrightness,
};