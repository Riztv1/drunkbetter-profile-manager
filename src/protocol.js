'use strict';

/**
 * Protocolo HID del DrunkDeer A75 Pro (colección vendor-specific 0xFF00, Report ID 4,
 * informes de SALIDA con sendReport/write). Módulo puro: sin node-hid ni Electron.
 *
 * Formato verificado con capturas del software oficial (WebHID, 63 bytes sin Report ID):
 *
 *   [04] b6 <sub> 00 <bloque> <59 valores>
 *    ^ID  ^cmd ^sub  ^fijo ^bloque
 *
 *   sub 0x01 = action point (mm x10)           -> 3 bloques (59 + 59 + 8 slots)
 *   sub 0x04 = Press to activate (distancia de bajada, mm x10; 0 = Rapid Trigger apagado)
 *   sub 0x05 = Release Reset (distancia de subida, mm x10; 0 = apagado)   <- capturado en captura_filtrada.json
 */

const REPORT_ID = 0x04;
const REPORT_LENGTH = 64;                              // total, incluyendo el Report ID
const HEADER_LENGTH = 5;                               // [reportId, 0xb6, sub, 0x00, bloque]
const KEYS_PER_BLOCK = REPORT_LENGTH - HEADER_LENGTH;  // 59 valores por bloque

const CMD_CONFIG = 0xb6;
const SUB_ACTION_POINT = 0x01;
const SUB_ACTIVATE = 0x04;
const SUB_RELEASE = 0x05;

// Matriz oficial: 6 filas x 21 columnas = 126 slots, en orden de fila.
// '' = slot sin tecla física. NO se pueden eliminar ni reordenar: la POSICIÓN
// en este array es el índice del valor dentro de los bloques.
const LAYOUT_ROWS = [
  ['ESC', '', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'KP7', 'KP8', 'KP9', '', '', '', ''],
  ['SWUNG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'MINUS', 'PLUS', 'BACK', 'KP4', 'KP5', 'KP6', '', '', '', ''],
  ['TAB', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'BRKTS_L', 'BRKTS_R', 'SLASH_K29', 'KP1', 'KP2', 'KP3', '', '', '', ''],
  ['CAPS', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'COLON', 'QOTATN', '', 'RETURN', '', 'KP0', 'KP_DEL', '', '', '', ''],
  ['SHF_L', 'EUR_K45', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'COMMA', 'PERIOD', 'VIRGUE', '', 'SHF_R', 'ARR_UP', '', 'NUMS', '', '', '', ''],
  ['CTRL_L', 'WIN_L', 'ALT_L', '', '', '', 'SPACE', '', '', '', 'ALT_R', 'FN1', 'APP', 'ARR_L', 'ARR_DW', 'ARR_R', 'CTRL_R', '', '', '', ''],
];

for (const row of LAYOUT_ROWS) {
  if (row.length !== 21) throw new Error('Layout A75 Pro corrupto: cada fila debe tener 21 columnas');
}

const OFFICIAL_LAYOUT = LAYOUT_ROWS.flat();
const MATRIX_SIZE = OFFICIAL_LAYOUT.length; // 126

const SLOT_BY_NAME = new Map(
  OFFICIAL_LAYOUT.map((name, slot) => [name, slot]).filter(([name]) => name)
);

function toByte(mm, label) {
  const value = Math.round(Number(mm) * 10);
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new Error(`Valor en mm no válido para ${label}: ${mm}`);
  }
  return value;
}

/** Parte una lista de 126 valores en tramas [04 b6 <sub> 00 <bloque> <59 valores>]. */
function buildBlocks(sub, values) {
  const frames = [];
  for (let block = 0; block * KEYS_PER_BLOCK < values.length; block += 1) {
    const frame = new Array(REPORT_LENGTH).fill(0);
    frame[0] = REPORT_ID;
    frame[1] = CMD_CONFIG;
    frame[2] = sub;
    frame[3] = 0x00;
    frame[4] = block;
    for (let i = 0; i < KEYS_PER_BLOCK; i += 1) {
      const slot = block * KEYS_PER_BLOCK + i;
      if (slot >= values.length) break;
      frame[HEADER_LENGTH + i] = values[slot];
    }
    frames.push(frame);
  }
  return frames;
}

/**
 * Tramas para aplicar un perfil.
 *   por defecto:    b6 01 bloques 0,1,2 (action point)
 *   init:true       antepone la consulta a0 02 (el oficial NO la envía al aplicar)
 *   downstroke:true añade b6 04 y b6 05, bloques 0,1,2 (el oficial SIEMPRE envía las 9 tramas)
 */
function buildProfileFrames(profile, { init = false, downstroke = false, rapidTrigger = true } = {}) {
  const keys = profile && profile.keys_array;
  if (!Array.isArray(keys) || keys.length !== MATRIX_SIZE) {
    throw new Error(
      `El perfil debe tener ${MATRIX_SIZE} slots (tiene ${Array.isArray(keys) ? keys.length : 0}). ` +
      'Reimporta o recrea el perfil.'
    );
  }
  const label = (entry, slot) => entry.keyname || `slot ${slot}`;
  const frames = [];

  if (init) {
    const query = new Array(REPORT_LENGTH).fill(0);
    query[0] = REPORT_ID;
    query[1] = 0xa0;
    query[2] = 0x02;
    frames.push(query);
  }

  frames.push(...buildBlocks(SUB_ACTION_POINT, keys.map((e, i) => toByte(e.action_point, label(e, i)))));
  if (downstroke) {
    // En Release Dual-Trigger la tecla principal de cada grupo usa x2Active (bajada) y x2Reset (subida) en b6 04 / b6 05.
    const dualBySlot = new Map();
    if (profile?.rtp?.rdt_open) {
      for (const group of profile.rtp.rdt_rtpSettings || []) {
        if (group?.isRdtEnabled === false) continue;
        const slot = SLOT_BY_NAME.get(group?.mainKey?.keyname);
        if (slot !== undefined) dualBySlot.set(slot, group);
      }
    }
    frames.push(...buildBlocks(SUB_ACTIVATE, keys.map((e, i) => {
      const dual = dualBySlot.get(i);
      const mm = dual ? (dual.x2Active ?? e.downstroke ?? 0) : (rapidTrigger ? (e.downstroke || 0) : 0);
      return toByte(mm, label(e, i));
    })));
    frames.push(...buildBlocks(SUB_RELEASE, keys.map((e, i) => {
      const dual = dualBySlot.get(i);
      const mm = dual ? (dual.x2Reset ?? e.upstroke ?? 0) : (rapidTrigger ? (e.upstroke || 0) : 0);
      return toByte(mm, label(e, i));
    })));
  }
  return frames;
}

// ───────── Iluminación: comando 0xae ─────────
// Capturas reales (63 bytes sin Report ID):  ae 01 00 00 02 05 09 00…  (brillo 9)  y  …05 08… (brillo 8).
// El teclado devuelve la misma trama como eco. Solo el brillo está capturado: efectos y color, no.
const CMD_LIGHT = 0xae;
const LIGHT_PARAM_BRIGHTNESS = 0x05;
const BRIGHTNESS_MAX = 9; // la UI oficial usa 0–9; solo se han visto 8 y 9 en la captura

function buildBrightnessFrame(level) {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 0 || value > BRIGHTNESS_MAX) {
    throw new Error(`Brillo no válido: ${level} (0–${BRIGHTNESS_MAX})`);
  }
  const frame = new Array(REPORT_LENGTH).fill(0);
  frame[0] = REPORT_ID;
  frame[1] = CMD_LIGHT;
  frame[2] = 0x01;
  frame[5] = 0x02;
  frame[6] = LIGHT_PARAM_BRIGHTNESS;
  frame[7] = value;
  return frame;
}

// ───────── Remap: comando 0xa0 0x02 0x04 ─────────
// Cada "aplicar" del software oficial envía:  a0 02 00  +  3 capas x 14 bloques  +  a0 02 00   (44 tramas)
//   bloque:  a0 02 04 <bloque 1..14> 0e <capa 1=Default 2=Fn 3=Fn2> {9 entradas de 6 bytes} a5 00 00
//   entrada: [slot, tipo, b2, b3, 0, 0]   (126 slots = 14 x 9). Slot sin tecla: seis ceros.
// Tipos de entrada (verificados con la captura salvo lo marcado "deducido"):
//   fc 00 <usage>   tecla estándar (usage HID)          fc <máscara> 00  modificador (01 Ctrl, 02 Shift, 04 Alt; 20/40 R-Shift/R-Alt)
//   fc 00 e3        Win izquierda (usage, no máscara)   96/92/95 00 00   multimedia: Next / Mute / Prev (tipo = función)
//   b0 / b6 00 00   ratón: clic izquierdo / mover abajo ff / fe        Fn / Fn2           fb <n>  función de iluminación (no usada aquí)
//   f8 00 <grupo> <rol> 01   grupo Last Win / Dual-Trigger (ver docs; NO se envía todavía)
const REMAP_BASELINE = require('./remapBaseline');

const CMD_REMAP = 0xa0;
const SUB_REMAP = 0x04;
const REMAP_ENTRIES_PER_CHUNK = 9;
const REMAP_CHUNKS = MATRIX_SIZE / REMAP_ENTRIES_PER_CHUNK; // 14
const REMAP_TRAILER = [0xa5, 0x00, 0x00];
const REMAP_LAYER_BYTE = { default: 0x01, fn: 0x02, fn2: 0x03 };
const T_KEY = 0xfc;

const hexBytes = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const parseHex = (text) => text.trim().split(/\s+/).map((h) => parseInt(h, 16));

// Usage IDs HID estándar. Todos los observados en la captura coinciden con la tabla HID, el resto se deduce de ella.
const KEY_USAGE = (() => {
  const map = {
    ENTER: 0x28, ESC: 0x29, BACK: 0x2a, TAB: 0x2b, SPACE: 0x2c, '-': 0x2d, '=': 0x2e, '[': 0x2f, ']': 0x30,
    '\\': 0x31, ';': 0x33, "'": 0x34, '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38, CAPS: 0x39,
    PRTSC: 0x46, INS: 0x49, HOME: 0x4a, PGUP: 0x4b, DEL: 0x4c, END: 0x4d, PGDN: 0x4e,
    RIGHT: 0x4f, LEFT: 0x50, DOWN: 0x51, UP: 0x52, NUMLOCK: 0x53, 'KP/': 0x54, 'KP*': 0x55, 'KP-': 0x56,
    'KP+': 0x57, KPENTER: 0x58, 'KP.': 0x63, MENU: 0x65,
  };
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l, i) => { map[l] = 0x04 + i; });
  '1234567890'.split('').forEach((d, i) => { map[d] = 0x1e + i; });
  for (let i = 1; i <= 12; i += 1) map[`F${i}`] = 0x39 + i;
  for (let i = 1; i <= 9; i += 1) map[`KP${i}`] = 0x58 + i;
  map.KP0 = 0x62;
  // Capturas Large Keys / Characters (A75 Pro, nov-2026): Pause, Print, §, K56, App verificados.
  Object.assign(map, { PAUSE: 0x48, SCROLLLK: 0x47, SECTION: 0x64, K56: 0x87, APP: 0x65 });
  return map;
})();
// Máscaras de modificador: LCtrl/LShift/LAlt/RShift/RAlt vistos en la captura; RCtrl (0x10) deducido del patrón.
const MODIFIER_MASK = { LCTRL: 0x01, LSHIFT: 0x02, LALT: 0x04, RCTRL: 0x10, RSHIFT: 0x20, RALT: 0x40 };
// Tipo de entrada directo. Next/Mute/Prev y ratón: capturados. Vol+, Vol-, Play/Pause, Stop y el resto del ratón NO se pueden deducir.
const SPECIAL_TYPE = { FN: 0xff, FN2: 0xfe, NEXT: 0x96, MUTE: 0x92, PREV: 0x95, MOUSE_LCLICK: 0xb0, MOUSE_DOWN: 0xb6 };
// Multimedia sin captura propia: los tipos 0x90..0x96 son contiguos (0x92 Mute, 0x95 Prev, 0x96 Next están capturados;
// en una captura apareció 0x90 sin marca). Se DEDUCE Vol+=90, Vol-=91, Pause=93, Stop=94 -> se marcan como "derived".
Object.assign(SPECIAL_TYPE, { 'VOL+': 0x90, 'VOL-': 0x91, MEDIA_PAUSE: 0x93, STOP: 0x94 });
// Ratón (drunkdeer_capture_remap_mouse.json): b0 izq, b1 der, b2 rueda, b5 arriba (por orden), b6 abajo, b7 izquierda, b8 derecha.
Object.assign(SPECIAL_TYPE, {
  MOUSE_RCLICK: 0xb1, MOUSE_MCLICK: 0xb2, MOUSE_UP: 0xb5, MOUSE_LEFT: 0xb7, MOUSE_RIGHT: 0xb8,
});

// Funciones del propio teclado (iluminación, etc.): entrada [slot, fb, <código>, 0, 0]. Todos capturados (drunkdeer_capture_remap_function.json).
const FUNCTION_CODE = {
  LIGHTING_CYCLE: 0x00, MODE_PLUS: 0x01, MODE_MINUS: 0x02, 'BR+': 0x04, 'BR-': 0x05, 'SP+': 0x07, 'SP-': 0x08,
  COLOR_CYCLE: 0x09, PAUSE_LIGHT: 0x0d, LIGHT_BUTTON: 0x0e, LOCK_WIN: 0x10, RDT: 0x4e, LW: 0x4f,
};
// Caracteres con su par de la UI oficial ("= +", "[ {"...) -> tecla base.
const CHAR_ALIASES = { '-_': '-', '=+': '=', '[{': '[', ']}': ']', '\\|': '\\', ';:': ';', "'\"": "'", ',<': ',', '.>': '.', '`~': '`', '/?': '/' };

// Colas [tipo, b2, b3] vistas literalmente en la captura (baseline + marks de prueba). El resto se marca como "deducido".
// Usages vistos en las capturas nuevas (F3–F12, Esc, App, Ins, End, Del, flechas, Home, Pause, Print, PgDn, PgUp, §, K56, símbolos).
const NEW_CAPTURED_USAGES = [0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x36, 0x38, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45,
  0x29, 0x65, 0x49, 0x4d, 0x4c, 0x50, 0x4f, 0x52, 0x51, 0x4a, 0x48, 0x46, 0x4e, 0x4b, 0x64, 0x87];
const CAPTURED_TAILS = new Set(['fc 00 59', 'fc 00 53', 'fc 00 e3', 'fc 02 00', '96 00 00', '92 00 00', '95 00 00', 'b0 00 00', 'b6 00 00', 'fe 00 00', 'ff 00 00']);
for (const type of [0x90, 0x91, 0x93, 0x94, 0xb0, 0xb1, 0xb2, 0xb6, 0xb7, 0xb8]) CAPTURED_TAILS.add(hexBytes([type, 0, 0]));
CAPTURED_TAILS.add(hexBytes([0xb5, 0, 0])); // arriba: no marcado en la captura, deducido del orden (UI: arriba, abajo, izquierda, derecha)
for (const usage of NEW_CAPTURED_USAGES) CAPTURED_TAILS.add(hexBytes([T_KEY, 0, usage]));
for (const code of Object.values(FUNCTION_CODE)) CAPTURED_TAILS.add(hexBytes([0xfb, code, 0]));
for (const layer of Object.values(REMAP_BASELINE)) {
  for (const text of Object.values(layer)) CAPTURED_TAILS.add(hexBytes(parseHex(text).slice(1, 4)));
}

/** Acción de la UI -> cola de 5 bytes [tipo, b2, b3, 0, 0] + origen ('captured' | 'derived'). null si no hay trama conocida. */
function remapTail(action) {
  let name = String(action ?? '').trim().toUpperCase();
  if (/^[0-9][!@#$%^&*()]$/.test(name)) name = name[0];
  if (CHAR_ALIASES[name]) name = CHAR_ALIASES[name];
  let tail = null;
  if (FUNCTION_CODE[name] !== undefined) tail = [0xfb, FUNCTION_CODE[name], 0, 0, 0];
  else if (KEY_USAGE[name] !== undefined) tail = [T_KEY, 0, KEY_USAGE[name], 0, 0];
  else if (MODIFIER_MASK[name] !== undefined) tail = [T_KEY, MODIFIER_MASK[name], 0, 0, 0];
  else if (name === 'WIN') tail = [T_KEY, 0, 0xe3, 0, 0];
  else if (name === 'RWIN') tail = [T_KEY, 0, 0xe7, 0, 0];
  else if (SPECIAL_TYPE[name] !== undefined) tail = [SPECIAL_TYPE[name], 0, 0, 0, 0];
  if (!tail) return null;
  return { tail, source: CAPTURED_TAILS.has(hexBytes(tail.slice(0, 3))) ? 'captured' : 'derived' };
}

// Slot de la tabla de remap por tecla física. Los nombres del JSON oficial no coinciden con la matriz real en el bloque
// derecho y las flechas: la captura muestra Left/Down/Right en 119/120/121 y Del/Home/PgUp/PgDn/End en 14/36/57/78/100.
const REMAP_NAV_SLOTS = { Delete: 14, Home: 36, PageUp: 57, PageDown: 78, End: 100 };
const REMAP_SLOT_FIX = { ARR_L: 119, ARR_DW: 120, ARR_R: 121 };
const REMAP_UNAVAILABLE = new Set(['CTRL_R', 'EUR_K45']); // no son teclas físicas del A75 Pro ANSI

/** Slot (0–125) de una tecla física de la UI, o undefined si no existe en el teclado. */
function remapSlotFor(code, officialName) {
  let slot;
  if (REMAP_NAV_SLOTS[code] !== undefined) slot = REMAP_NAV_SLOTS[code];
  else if (REMAP_UNAVAILABLE.has(officialName)) slot = undefined;
  else if (REMAP_SLOT_FIX[officialName] !== undefined) slot = REMAP_SLOT_FIX[officialName];
  else slot = SLOT_BY_NAME.get(officialName);
  return slot !== undefined && REMAP_BASELINE.default[slot] ? slot : undefined; // solo slots con tecla física
}

function remapQueryFrame() {
  const frame = new Array(REPORT_LENGTH).fill(0);
  frame[0] = REPORT_ID; frame[1] = CMD_REMAP; frame[2] = 0x02;
  return frame;
}

/**
 * layers: { default, fn, fn2 } -> Map slot -> cola [tipo, b2, b3, 0, 0] (solo lo que el usuario cambió).
 * Lo demás sale del estado de reset capturado.
 * En Performance (Last Win / Release Dual-Trigger) el software oficial solo envía los 14 bloques de la capa Default
 * seguidos de 'aa 00 01' (+ tramas a7/a8 si es Dual-Trigger) + 'a0 02'.
 */
function buildRemapFrames({ layers = {}, extra = null, tail = [], onlyDefaultLayer = false } = {}) {
  for (const layer of Object.keys(layers)) {
    if (REMAP_LAYER_BYTE[layer] === undefined) throw new Error(`Capa desconocida: ${layer}`);
  }
  const frames = onlyDefaultLayer ? [] : [remapQueryFrame()];
  const layerEntries = onlyDefaultLayer ? [['default', REMAP_LAYER_BYTE.default]] : Object.entries(REMAP_LAYER_BYTE);
  for (const [layer, layerByte] of layerEntries) {
    const overrides = new Map(layers[layer] || []);
    if (layer === 'default' && extra) for (const [slot, entryTail] of extra) overrides.set(slot, entryTail);
    const entries = Array.from({ length: MATRIX_SIZE }, (_, slot) => {
      if (overrides.has(slot)) return [slot, ...overrides.get(slot)];
      const base = REMAP_BASELINE[layer][slot];
      return base ? parseHex(base) : new Array(6).fill(0);
    });
    for (let chunk = 0; chunk < REMAP_CHUNKS; chunk += 1) {
      const frame = new Array(REPORT_LENGTH).fill(0);
      frame.splice(0, 7, REPORT_ID, CMD_REMAP, 0x02, SUB_REMAP, chunk + 1, REMAP_CHUNKS, layerByte);
      frame.splice(7, REMAP_ENTRIES_PER_CHUNK * 6, ...entries.slice(chunk * REMAP_ENTRIES_PER_CHUNK, (chunk + 1) * REMAP_ENTRIES_PER_CHUNK).flat());
      frame.splice(REPORT_LENGTH - REMAP_TRAILER.length, REMAP_TRAILER.length, ...REMAP_TRAILER);
      frames.push(frame);
    }
  }
  if (onlyDefaultLayer || (extra && extra.size) || tail.length) {
    const commit = new Array(REPORT_LENGTH).fill(0);
    commit[0] = REPORT_ID; commit[1] = 0xaa; commit[3] = 0x01; // 'aa 00 01' tras la tabla (capturas de Performance)
    // Release Dual-Trigger: las tramas a7/a8 de cada grupo van entre 'aa 00 01' y el 'a0 02' final (captura Release_dual_trigger).
    frames.push(commit, ...tail);
  }
  frames.push(remapQueryFrame());
  return frames;
}

// ───────── Rendimiento (drunkdeer_capture_Performance.json) ─────────
//   b5 00 1e 01 00 00 01 <turbo> <rapidTrigger> 00 <modo>     modo: 0 = nada, 1 = Last Win, 2 = Release Dual-Trigger
// Activar Last Win o Release Dual-Trigger activa Rapid Trigger solo (byte rapidTrigger = 1). Son excluyentes entre sí.
// Last Win: en la tabla de remap (capa Default) las dos teclas del grupo llevan  slot f8 00 <grupo> <rol 0|1> 01   (solo 2 teclas por grupo).
// Release Dual-Trigger: la tecla principal lleva  slot f8 <n> <n-1> 00 01  y después se envían  aa 00 01, a7 …, a8 …
const PERF_MODE = { none: 0, lastWin: 1, dualTrigger: 2 };
function buildPerformanceFrame({ turbo = false, rapidTrigger = false, mode = 'none' } = {}) {
  const frame = new Array(REPORT_LENGTH).fill(0);
  const modeByte = PERF_MODE[mode] ?? 0;
  frame.splice(0, 12, REPORT_ID, 0xb5, 0x00, 0x1e, 0x01, 0x00, 0x00, 0x01, turbo ? 1 : 0, (rapidTrigger || modeByte) ? 1 : 0, 0x00, modeByte);
  return frame;
}
const LAST_WIN_MAX_KEYS = 2;
/** groups: [[nombreOficialA, nombreOficialB], …] -> Map slot -> cola [f8, 00, grupo, rol, 01] para la capa Default. */
function lastWinOverrides(groups) {
  const out = new Map();
  groups.forEach((names, group) => {
    names.slice(0, LAST_WIN_MAX_KEYS).forEach((name, role) => {
      const slot = SLOT_BY_NAME.get(name);
      if (slot !== undefined) out.set(slot, [0xf8, 0x00, group, role, 0x01]);
    });
  });
  return out;
}

/**
 * Release Dual-Trigger (drunkdeer_capture_Performance_release_dual_trigger.json):
 *   - En la capa Default, la tecla principal del grupo i (0-based) lleva [slot, f8, i+1, i, 00, 01].
 *   - Tras 'aa 00 01' se envían por cada grupo dos tramas:
 *       a7 <i+1> 00 2b 01 00…
 *       a8 <i+1> 01 01 01 26 01 [30x00] 02 <usageTrigger> 01 00 6d 03 <usageTrigger> 00…
 */
const OFFICIAL_TO_USAGE = {
  SWUNG: 0x35, MINUS: 0x2d, PLUS: 0x2e, BACK: 0x2a, BRKTS_L: 0x2f, BRKTS_R: 0x30, SLASH_K29: 0x31,
  COLON: 0x33, QOTATN: 0x34, RETURN: 0x28, COMMA: 0x36, PERIOD: 0x37, VIRGUE: 0x38,
  ARR_UP: 0x52, ARR_L: 0x50, ARR_DW: 0x51, ARR_R: 0x4f, WIN_L: 0xe3,
};
function usageForOfficialKey(keyname) {
  const name = String(keyname || '').trim().toUpperCase();
  if (KEY_USAGE[name] !== undefined) return KEY_USAGE[name];
  if (OFFICIAL_TO_USAGE[name] !== undefined) return OFFICIAL_TO_USAGE[name];
  const base = REMAP_BASELINE.default[SLOT_BY_NAME.get(name)];
  if (base) {
    const bytes = parseHex(base);
    if (bytes[1] === T_KEY && bytes[3]) return bytes[3];
  }
  return null;
}

function buildDualTriggerData(groups = []) {
  const overrides = new Map();
  const frames = [];
  let index = 0;
  for (const group of groups) {
    if (!group || group.isRdtEnabled === false) continue;
    const mainName = group.mainKey?.keyname;
    const triggerName = group.triggerKey?.keyname;
    const mainSlot = SLOT_BY_NAME.get(mainName);
    const triggerUsage = usageForOfficialKey(triggerName);
    if (mainSlot === undefined || !triggerUsage) continue;
    const num = index + 1;
    overrides.set(mainSlot, [0xf8, num, index, 0x00, 0x01]);
    const a7 = new Array(REPORT_LENGTH).fill(0);
    a7.splice(0, 6, REPORT_ID, 0xa7, num, 0x00, 0x2b, 0x01);
    const a8 = new Array(REPORT_LENGTH).fill(0);
    a8.splice(0, 8, REPORT_ID, 0xa8, num, 0x01, 0x01, 0x01, 0x26, 0x01);
    a8.splice(38, 7, 0x02, triggerUsage, 0x01, 0x00, 0x6d, 0x03, triggerUsage);
    frames.push(a7, a8);
    index += 1;
  }
  return { overrides, frames };
}

// ───────── Iluminación por efecto (drunkdeer_capture_Colours.json) ─────────
//   ae 01 00 00 <efecto> <velocidad 0-9> <brillo 0-9> <color 0-7>      (color: 1 rojo, 2 verde, 3 azul, 4 amarillo, 5 rosa, 6 cian, 7 blanco)
//   Lighting turn off (drunkdeer_capture_Colours_lightning_turn_off.json): ae 01 00 00 00 05 09 00… (efecto 0)
const LIGHT_EFFECT_ID = {
  off: 0, marquee: 1, always: 2, spectrum: 3, breath: 4, lightByPress: 5, stars: 6, waveSpectrum: 7, centerSurfing: 8, surfingDown: 9,
  ripple: 10, glowingFish: 11, colorfulFountain: 12, traffic: 13, gluttonousSnake: 14, repeatSurfing: 15, surfingCross: 16,
  laserKey: 17, randomFountain: 18,
};
function buildEffectFrame({ effect, speed = 5, brightness = 9, colour = 0 }) {
  const id = LIGHT_EFFECT_ID[effect];
  if (id === undefined) throw new Error(`Efecto de luz desconocido: ${effect}`);
  const clamp = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  const frame = new Array(REPORT_LENGTH).fill(0);
  frame.splice(0, 9, REPORT_ID, CMD_LIGHT, 0x01, 0x00, 0x00, id, clamp(speed, 9), clamp(brightness, 9), id === 0 ? 0 : clamp(colour, 7));
  return frame;
}

// Custom light / Turbo mode light: 82 teclas (slot 0x80+slot, sin el slot 56), 13 por trama:
//   ae 01 <1=turbo|0=custom> 00 13 06 <brillo> ff  {id R G B}x13  ff 00 00
const COLOR_SLOTS = Object.keys(REMAP_BASELINE.default).map(Number).filter((slot) => slot !== 56).sort((a, b) => a - b);
function buildCustomLightFrames(colors, { turbo = false, brightness = 9, fallback = [255, 255, 255] } = {}) {
  const frames = [];
  for (let start = 0; start < COLOR_SLOTS.length; start += 13) {
    const frame = new Array(REPORT_LENGTH).fill(0);
    frame.splice(0, 9, REPORT_ID, CMD_LIGHT, 0x01, turbo ? 1 : 0, 0x00, 0x13, 0x06, Math.min(9, Math.max(0, brightness)), 0xff);
    let at = 9;
    for (const slot of COLOR_SLOTS.slice(start, start + 13)) {
      const [r, g, b] = colors.get(slot) || fallback;
      frame.splice(at, 4, 0x80 + slot, r, g, b);
      at += 4;
    }
    frame.splice(at, 3, 0xff, 0x00, 0x00);
    frames.push(frame);
  }
  return frames;
}

// ───────── Rendimiento (turbo/tracking sueltos) ─────────
// Turbo:  b5 00 1e 01 00 00 01 <0|1> 01 00 01   (solo cambia el byte 7; el resto se copia de la captura)
// Key tracking:  b6 03 <0|1>
function buildTurboFrame(on, opts = {}) {
  return buildPerformanceFrame({ ...opts, turbo: Boolean(on) });
}
function buildKeyTrackingFrame(on) {
  const frame = new Array(REPORT_LENGTH).fill(0);
  frame.splice(0, 4, REPORT_ID, CMD_CONFIG, 0x03, on ? 1 : 0);
  return frame;
}

// Recorrido real del gatillo (capturas): el máximo de "Press to activate" depende del punto de actuación.
//   actuación 0.2 -> 2.9 | 1.5 -> 1.6 | 2.0 -> 1.1 | 3.3 -> 0.0     (= 3.1 - actuación, mínimo 0)
const TRAVEL_LIMIT_MM = 3.1;
const maxDownstrokeMm = (actionPoint) => Math.max(0, Math.round((TRAVEL_LIMIT_MM - Number(actionPoint)) * 10) / 10);

module.exports = {
  REPORT_ID, REPORT_LENGTH, HEADER_LENGTH, KEYS_PER_BLOCK, MATRIX_SIZE,
  CMD_CONFIG, SUB_ACTION_POINT, SUB_ACTIVATE, SUB_RELEASE,
  OFFICIAL_LAYOUT, SLOT_BY_NAME, buildBlocks, buildProfileFrames,
  CMD_LIGHT, BRIGHTNESS_MAX, buildBrightnessFrame,
  REMAP_CHUNKS, REMAP_ENTRIES_PER_CHUNK, REMAP_LAYER_BYTE, remapTail, remapSlotFor, buildRemapFrames,
  buildTurboFrame, buildPerformanceFrame, lastWinOverrides, buildDualTriggerData, LAST_WIN_MAX_KEYS, LIGHT_EFFECT_ID, buildEffectFrame, buildCustomLightFrames, COLOR_SLOTS,
  buildKeyTrackingFrame, TRAVEL_LIMIT_MM, maxDownstrokeMm,
};
