'use strict';

const fs = require('fs');
const path = require('path');
const defaultProfiles = require('./profiles');

const { OFFICIAL_LAYOUT, SLOT_BY_NAME, MATRIX_SIZE } = require('./protocol');

let configPath = null;
let state = null;

function createDefaults() {
  return {
    version: 2,
    autoEnabled: true,
    baseRemap: null,
    settings: cleanSettings(null),
    profiles: Object.entries(defaultProfiles).map(([id, profile]) => normalizeProfile({ id, name: profile.name }, null)),
    games: [
      { id: 'game-osu', processName: 'osu!.exe', profileId: 'game' },
      { id: 'game-cs2', processName: 'cs2.exe', profileId: 'game' },
    ],
  };
}

function normalize(input) {
  const defaults = createDefaults();
  const source = input && typeof input === 'object' ? input : {};
  const savedProfiles = Array.isArray(source.profiles) ? source.profiles : [];
  const profiles = defaults.profiles.map((profile) => {
    const saved = savedProfiles.find((candidate) => candidate?.id === profile.id);
    return normalizeProfile(profile, saved);
  });
  const builtInIds = new Set(defaults.profiles.map((profile) => profile.id));
  for (const saved of savedProfiles) {
    if (!saved || builtInIds.has(saved.id) || !/^custom-[a-z0-9-]+$/.test(saved.id)) continue;
    const name = typeof saved.name === 'string' ? saved.name.trim().slice(0, 32) : '';
    if (!name || profiles.some((profile) => profile.id === saved.id)) continue;
    profiles.push(normalizeProfile({ id: saved.id, name }, saved));
  }
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const games = Array.isArray(source.games)
    ? source.games.map((game) => normalizeGame(game, profileIds)).filter(Boolean)
    : defaults.games;

  return {
    version: 2,
    autoEnabled: source.autoEnabled !== false,
    baseRemap: cleanRemap(source.baseRemap),
    settings: cleanSettings(source.settings),
    profiles,
    games: [...new Map(games.map((game) => [game.processName, game])).values()],
  };
}

function normalizeProfile(profile, saved) {
  const showname = String(saved?.showname || saved?.name || profile.name).trim().slice(0, 32);
  const keyEntries = Array.isArray(saved?.keys_array)
    ? saved.keys_array
    : Object.entries(saved?.keys || {}).map(([keyname, values]) => ({
      keyname,
      action_point: values?.actuationPoint,
      downstroke: values?.downstroke,
      upstroke: values?.releasePoint,
      rapidTrigger: values?.rapidTrigger,
    }));
  const keys = normalizeKeys(keyEntries);
  const defaultRtp = {
    rdt_rtpSettings: [{ mainKey: {}, triggerKey: {}, x2Reset: 0.05, x2Active: 1.5, isRdtEnabled: true }],
    rdt_watch_change: false,
    lw_temp_list: [[]],
    lw_rtpSettings: [],
    lw_watch_change: false,
    rtp_model: '',
    rdt_open: false,
    lw_open: false,
  };
  const rtp = { ...defaultRtp, ...(saved?.rtp || {}) };
  rtp.rdt_rtpSettings = Array.isArray(rtp.rdt_rtpSettings) ? rtp.rdt_rtpSettings : defaultRtp.rdt_rtpSettings;
  rtp.lw_temp_list = Array.isArray(rtp.lw_temp_list) ? rtp.lw_temp_list : [[]];
  rtp.lw_rtpSettings = Array.isArray(rtp.lw_rtpSettings) ? rtp.lw_rtpSettings : [];
  rtp.rdt_open = Boolean(rtp.rdt_open || keyEntries.some((entry) => entry?.rapidTrigger));
  rtp.lw_open = Boolean(rtp.lw_open);

  return {
    id: profile.id,
    name: showname,
    storagename: String(saved?.storagename || `ddeerA75Pro${profile.id}`).slice(0, 80),
    showname,
    keys_array: keys,
    rtp,
    isActive: Boolean(saved?.isActive),
    remap: cleanRemap(saved?.remap),
    features: {
      lastWinMode: Boolean(saved?.features?.lastWinMode),
      turboMode: Boolean(saved?.features?.turboMode),
      keystrokeTracking: Boolean(saved?.features?.keystrokeTracking),
      // Un perfil importado con bajada/subida > 0 ya trabaja en Rapid Trigger aunque no traiga el flag.
      rapidTrigger: Boolean(saved?.features?.rapidTrigger) || keys.some((entry) => entry.downstroke > 0 || entry.upstroke > 0),
      lastWinGroups: cleanLastWinGroups(saved?.features?.lastWinGroups, false),
    },
  };
}

// Nombres de la UI / DOM -> nombre de slot oficial.
// PRTSC, DEL, HOME, PGUP, END y PGDN NO están aquí a propósito: el JSON oficial
// los llama KP7..KP0/NUMS y no se puede saber cuál es cuál sin calibrarlo
// (ver instrucciones: exportar un perfil con un valor distinto en cada tecla).
const KEY_ALIASES = {
  '`': 'SWUNG', '-': 'MINUS', '=': 'PLUS', BACKSPACE: 'BACK', '[': 'BRKTS_L', ']': 'BRKTS_R',
  '\\': 'SLASH_K29', ';': 'COLON', "'": 'QOTATN', ENTER: 'RETURN', LSHIFT: 'SHF_L', RSHIFT: 'SHF_R',
  ',': 'COMMA', '.': 'PERIOD', '/': 'VIRGUE', UP: 'ARR_UP', LEFT: 'ARR_L', DOWN: 'ARR_DW', RIGHT: 'ARR_R',
  LCTRL: 'CTRL_L', RCTRL: 'CTRL_R', LWIN: 'WIN_L', LALT: 'ALT_L', RALT: 'ALT_R', FN: 'FN1', MENU: 'APP',
  // KeyboardEvent.code
  Escape: 'ESC', Backquote: 'SWUNG', Minus: 'MINUS', Equal: 'PLUS', Backspace: 'BACK',
  BracketLeft: 'BRKTS_L', BracketRight: 'BRKTS_R', Backslash: 'SLASH_K29', CapsLock: 'CAPS',
  Semicolon: 'COLON', Quote: 'QOTATN', Enter: 'RETURN', ShiftLeft: 'SHF_L', ShiftRight: 'SHF_R',
  Comma: 'COMMA', Period: 'PERIOD', Slash: 'VIRGUE', ArrowUp: 'ARR_UP', ArrowLeft: 'ARR_L',
  ArrowDown: 'ARR_DW', ArrowRight: 'ARR_R', ControlLeft: 'CTRL_L', ControlRight: 'CTRL_R',
  MetaLeft: 'WIN_L', AltLeft: 'ALT_L', AltRight: 'ALT_R', ContextMenu: 'APP', Space: 'SPACE',
};

/** Devuelve el nombre de slot oficial o '' si la tecla no tiene slot conocido. */
function officialKeyName(value) {
  const key = String(value ?? '').trim();
  if (!key) return '';
  if (SLOT_BY_NAME.has(key)) return key;
  if (KEY_ALIASES[key]) return KEY_ALIASES[key];
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  if (/^Digit[0-9]$/.test(key)) return key.slice(5);
  const upper = key.toUpperCase();
  if (SLOT_BY_NAME.has(upper)) return upper;
  return KEY_ALIASES[upper] || '';
}

/**
 * Devuelve SIEMPRE 126 entradas (una por slot, vacíos incluidos).
 *  - Si llegan 126 entradas (formato oficial) la POSICIÓN manda.
 *  - Si llegan menos (config antigua con huecos eliminados) se recolocan por nombre.
 */
function normalizeKeys(entries) {
  const keys = OFFICIAL_LAYOUT.map((keyname) => ({ keyname, action_point: 2, downstroke: 0, upstroke: 0 }));
  if (!Array.isArray(entries)) return keys;
  const read = (entry, keyname) => ({
    keyname,
    action_point: clamp(entry?.action_point, 0.2, 3.3, 2),
    downstroke: clamp(entry?.downstroke, 0, 3.3, 0),
    upstroke: clamp(entry?.upstroke, 0, 3.3, 0),
  });
  if (entries.length === MATRIX_SIZE) {
    entries.forEach((entry, slot) => { keys[slot] = read(entry, OFFICIAL_LAYOUT[slot]); });
    return keys;
  }
  for (const entry of entries) {
    const name = officialKeyName(entry?.keyname);
    const slot = name ? SLOT_BY_NAME.get(name) : undefined;
    if (slot !== undefined) keys[slot] = read(entry, name);
  }
  return keys;
}

const toTenth = (value, min, max, fallback) => Math.round(clamp(value, min, max, fallback) * 10) / 10;

const RDT_PLACEHOLDER = { mainKey: {}, triggerKey: {}, x2Reset: 0.05, x2Active: 1.5, isRdtEnabled: true };

function cleanKeyRef(ref) {
  const keyname = officialKeyName(ref?.keyname);
  return keyname ? { keyname, name: String(ref?.name || keyname).slice(0, 12) } : null;
}

/** Grupos de Release Dual-Trigger (rtp.rdt_rtpSettings). strict=true lanza error si algo no es válido. */
function cleanDualGroups(groups, strict) {
  if (strict && !Array.isArray(groups)) throw new Error('Los grupos no son válidos');
  const result = [];
  const used = new Set();
  for (const group of Array.isArray(groups) ? groups.slice(0, 8) : []) {
    const mainKey = cleanKeyRef(group?.mainKey);
    const triggerKey = cleanKeyRef(group?.triggerKey);
    if (!mainKey || !triggerKey || mainKey.keyname === triggerKey.keyname) {
      if (strict) throw new Error('Cada grupo necesita dos teclas distintas con slot conocido');
      continue;
    }
    const clash = [mainKey.keyname, triggerKey.keyname].find((name) => used.has(name));
    if (clash) {
      if (strict) throw new Error(`La tecla ${clash} ya pertenece a otro grupo`);
      continue;
    }
    used.add(mainKey.keyname).add(triggerKey.keyname);
    result.push({
      mainKey,
      triggerKey,
      x2Active: toTenth(group.x2Active, 0.1, 3.3, 1.5),
      x2Reset: toTenth(group.x2Reset, 0.1, 3.3, 0.1),
      isRdtEnabled: group.isRdtEnabled !== false,
    });
  }
  return result;
}

/** Grupos de Last Win: { keys: [{ keyname, name }] } con 2 a 6 teclas. */
function cleanLastWinGroups(groups, strict) {
  if (strict && !Array.isArray(groups)) throw new Error('Los grupos no son válidos');
  const result = [];
  const used = new Set();
  for (const group of Array.isArray(groups) ? groups.slice(0, 8) : []) {
    const keys = (Array.isArray(group?.keys) ? group.keys : []).map(cleanKeyRef);
    const unique = new Set(keys.filter(Boolean).map((key) => key.keyname));
    if (keys.some((key) => !key) || unique.size !== keys.length || keys.length !== 2) {
      if (strict) throw new Error('Cada grupo de Last Win necesita exactamente 2 teclas distintas con slot conocido');
      continue;
    }
    const clash = keys.find((key) => used.has(key.keyname));
    if (clash) {
      if (strict) throw new Error(`La tecla ${clash.name} ya pertenece a otro grupo`);
      continue;
    }
    keys.forEach((key) => used.add(key.keyname));
    result.push({ keys });
  }
  return result;
}

const THEMES = ['blue', 'dark', 'white', 'earth', 'ibm'];
const LANGUAGES = ['auto', 'es', 'en'];
const LIGHT_EFFECTS = ['off', 'custom', 'marquee', 'always', 'spectrum', 'breath', 'lightByPress', 'stars', 'waveSpectrum', 'centerSurfing',
  'surfingDown', 'ripple', 'glowingFish', 'colorfulFountain', 'traffic', 'gluttonousSnake', 'repeatSurfing', 'surfingCross', 'laserKey', 'randomFountain'];
/** Último modo de iluminación (no turbo) enviado: se restaura al apagar Turbo Mode. */
function cleanLastLighting(input) {
  if (!input || typeof input !== 'object' || !LIGHT_EFFECTS.includes(input.effect)) return null;
  return {
    effect: input.effect,
    speed: clamp(input.speed, 0, 9, 5),
    brightness: clamp(input.brightness, 0, 9, 9),
    colour: clamp(input.colour, 0, 7, 0),
  };
}
/** Ajustes de la app (menú de ajustes). */
function cleanSettings(input) {
  const s = input && typeof input === 'object' ? input : {};
  return {
    launchAtLogin: Boolean(s.launchAtLogin),
    startHidden: Boolean(s.startHidden),
    closeToBackground: s.closeToBackground !== false,   // por defecto la X deja la app en segundo plano
    resetOnExit: s.resetOnExit !== false,               // por defecto al cerrar del todo vuelve a "Escritura estándar"
    keepLastProfile: Boolean(s.keepLastProfile),        // por defecto desactivado
    theme: THEMES.includes(s.theme) ? s.theme : 'blue',
    language: LANGUAGES.includes(s.language) ? s.language : 'auto',
    lastProfileId: typeof s.lastProfileId === 'string' ? s.lastProfileId : null,
    manualProfileId: typeof s.manualProfileId === 'string' ? s.manualProfileId : null,
    lastLighting: cleanLastLighting(s.lastLighting),
  };
}

/** Remap guardado: { default: [[code, action]…], fn: […], fn2: […] } o null si no hay nada. */
function cleanRemap(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  let count = 0;
  for (const layer of ['default', 'fn', 'fn2']) {
    const seen = new Map();
    for (const pair of Array.isArray(input[layer]) ? input[layer].slice(0, 130) : []) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') continue;
      seen.set(pair[0].slice(0, 32), pair[1].slice(0, 32));
    }
    out[layer] = [...seen];
    count += out[layer].length;
  }
  return count ? out : null;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeGame(game, profileIds) {
  if (!game || typeof game !== 'object' || !profileIds.has(game.profileId)) return null;
  const processName = String(game.processName || '').replace(/^.*[\\/]/, '').trim().toLowerCase();
  if (!/^[^<>:"/\\|?*]+\.exe$/.test(processName)) return null;
  return {
    id: String(game.id || `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    processName,
    profileId: game.profileId,
  };
}

function persist() {
  if (!configPath || !state) throw new Error('El almacén de configuración no está inicializado');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, configPath);
}

function initialize(filePath) {
  configPath = filePath;
  let loaded = null;
  try {
    loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('No se pudo leer config.json; se usarán valores predeterminados:', error.message);
  }
  state = normalize(loaded);
  persist();
  return getConfig();
}

function getConfig() {
  return JSON.parse(JSON.stringify(state || createDefaults()));
}

function setAutoEnabled(enabled) {
  state.autoEnabled = Boolean(enabled);
  persist();
  return state.autoEnabled;
}

function addProfile(name) {
  const cleanName = String(name || '').trim().slice(0, 32);
  if (!cleanName) throw new Error('Escribe un nombre para el perfil');
  if (state.profiles.some((profile) => profile.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('Ya existe un perfil con ese nombre');
  }
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil';
  const id = `custom-${slug}-${Date.now().toString(36)}`;
  const profile = normalizeProfile({ id, name: cleanName }, null);
  state.profiles.push(profile);
  persist();
  return getConfig();
}

function renameProfile(profileId, name) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('Perfil desconocido');
  const cleanName = String(name || '').trim().slice(0, 32);
  if (!cleanName) throw new Error('El nombre no puede estar vacío');
  if (state.profiles.some((item) => item.id !== profileId && item.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('Ya existe un perfil con ese nombre');
  }
  profile.name = cleanName;
  profile.showname = cleanName;
  persist();
  return getConfig();
}

function updateSettings(patch) {
  state.settings = cleanSettings({ ...state.settings, ...(patch || {}) });
  persist();
  return getConfig();
}

function removeProfile(profileId) {
  if (!profileId.startsWith('custom-')) throw new Error('Los perfiles integrados no se pueden eliminar');
  const nextProfiles = state.profiles.filter((profile) => profile.id !== profileId);
  if (nextProfiles.length === state.profiles.length) throw new Error('Perfil no encontrado');
  state.profiles = nextProfiles;
  state.games = state.games.map((game) => game.profileId === profileId
    ? { ...game, profileId: 'default' }
    : game);
  persist();
  return getConfig();
}

function updateKeySettings(profileId, key, patch) {
  const config = updateKeySettingsBatch(profileId, [key], patch);
  const keyname = officialKeyName(key);
  return config.profiles.find((profile) => profile.id === profileId)
    .keys_array.find((entry) => entry.keyname === keyname);
}

function updateKeySettingsBatch(profileId, keys, patch) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('Perfil desconocido');
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100) {
    throw new Error('La selección de teclas no es válida');
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Los valores de tecla no son válidos');

  const slots = [...new Set(keys.map((key) => {
    const slot = SLOT_BY_NAME.get(officialKeyName(key));
    if (slot === undefined) throw new Error(`La tecla "${key}" no tiene un slot asignado en el A75 Pro`);
    return slot;
  }))];

  for (const slot of slots) {
    const entry = profile.keys_array[slot];
    if (patch.action_point !== undefined) entry.action_point = toTenth(patch.action_point, 0.2, 3.3, entry.action_point);
    if (patch.downstroke !== undefined) entry.downstroke = toTenth(patch.downstroke, 0.1, 3.3, entry.downstroke);
    if (patch.upstroke !== undefined) entry.upstroke = toTenth(patch.upstroke, 0.1, 3.3, entry.upstroke);
  }
  persist();
  return getConfig();
}

function updateProfileFeatures(profileId, patch) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('Perfil desconocido');
  if (patch.rdt_open !== undefined) profile.rtp.rdt_open = Boolean(patch.rdt_open);
  if (patch.lw_open !== undefined) profile.rtp.lw_open = Boolean(patch.lw_open);
  // Last Win y Release Dual-Trigger no pueden estar activos a la vez: el que se acaba de activar desactiva al otro.
  if (patch.lw_open === true) profile.rtp.rdt_open = false;
  else if (patch.rdt_open === true) { profile.rtp.lw_open = false; profile.features.lastWinMode = false; }
  for (const field of ['lastWinMode', 'turboMode', 'keystrokeTracking']) {
    if (patch[field] !== undefined) profile.features[field] = Boolean(patch[field]);
  }
  if (patch.rapidTrigger !== undefined) profile.features.rapidTrigger = Boolean(patch.rapidTrigger);
  // Rapid Trigger se activa solo al usar cualquiera de los otros dos modos (y no se puede apagar mientras estén activos).
  if (profile.rtp.lw_open || profile.rtp.rdt_open) profile.features.rapidTrigger = true;
  profile.features.lastWinMode = Boolean(profile.rtp.lw_open);
  if (patch.rdt_rtpSettings !== undefined) {
    const groups = cleanDualGroups(patch.rdt_rtpSettings, true);
    profile.rtp.rdt_rtpSettings = groups.length ? groups : [JSON.parse(JSON.stringify(RDT_PLACEHOLDER))];
  }
  if (patch.lastWinGroups !== undefined) profile.features.lastWinGroups = cleanLastWinGroups(patch.lastWinGroups, true);
  persist();
  return getConfig();
}

function setProfileRemap(profileId, layers) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('Perfil desconocido');
  profile.remap = cleanRemap(layers);
  persist();
  return getConfig();
}

function setBaseRemap(layers) {
  state.baseRemap = cleanRemap(layers);
  persist();
  return getConfig();
}

function importOfficialProfile(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.keys_array)) {
    throw new Error('El archivo no contiene un perfil DrunkDeer válido');
  }
  if (input.keys_array.length === MATRIX_SIZE) {
    const distintos = input.keys_array.filter((e, i) => (e?.keyname || '') !== OFFICIAL_LAYOUT[i]).length;
    if (distintos) {
      throw new Error(`El orden de teclas no coincide con el layout del A75 Pro (${distintos} slots distintos)`);
    }
  }
  const showname = String(input.showname || input.storagename || 'Perfil importado').trim().slice(0, 32);
  const id = `custom-import-${Date.now().toString(36)}`;
  state.profiles.push(normalizeProfile({ id, name: showname }, input));
  persist();
  return getConfig();
}

function exportOfficialProfile(profileId) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('Perfil desconocido');
  return {
    storagename: profile.storagename,
    showname: profile.showname,
    keys_array: profile.keys_array.map(({ keyname, action_point, downstroke, upstroke }) => ({
      keyname, action_point, downstroke, upstroke,
    })),
    rtp: JSON.parse(JSON.stringify(profile.rtp)),
    isActive: Boolean(profile.isActive),
  };
}

function addGame(processName, profileId) {
  const game = normalizeGame({ processName, profileId }, new Set(state.profiles.map((item) => item.id)));
  if (!game) throw new Error('Indica un ejecutable .exe y un perfil válido');
  const existing = state.games.find((item) => item.processName === game.processName);
  if (existing) existing.profileId = game.profileId;
  else state.games.push(game);
  persist();
  return getConfig().games;
}

function removeGame(id) {
  const nextGames = state.games.filter((game) => game.id !== id);
  if (nextGames.length === state.games.length) throw new Error('Juego no encontrado');
  state.games = nextGames;
  persist();
  return getConfig().games;
}

function profileForProcess(processName) {
  const processKey = String(processName || '').toLowerCase();
  return state?.games.find((game) => game.processName === processKey)?.profileId || 'default';
}

module.exports = {
  initialize,
  officialKeyName,
  getConfig,
  setAutoEnabled,
  addProfile,
  removeProfile,
  updateKeySettings,
  updateKeySettingsBatch,
  updateProfileFeatures,
  setProfileRemap,
  setBaseRemap,
  renameProfile,
  updateSettings,
  importOfficialProfile,
  exportOfficialProfile,
  addGame,
  removeGame,
  profileForProcess,
};