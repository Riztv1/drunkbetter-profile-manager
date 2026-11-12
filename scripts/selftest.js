'use strict';

// Uso: node scripts/selftest.js [Profile2.json]
// Compara nuestras tramas con bytes capturados del software oficial y prueba el almacén de config.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const store = require('../src/configStore');
const {
  buildProfileFrames, OFFICIAL_LAYOUT, MATRIX_SIZE, buildBrightnessFrame, buildRemapFrames, remapTail, remapSlotFor,
  buildTurboFrame, buildKeyTrackingFrame, maxDownstrokeMm, buildPerformanceFrame, lastWinOverrides, buildDualTriggerData, buildEffectFrame,
} = require('../src/protocol');

const defaultProfilePath = fs.existsSync('Profile2.json') ? 'Profile2.json' : path.join(__dirname, 'Profile2.json');
const official = JSON.parse(fs.readFileSync(process.argv[2] || defaultProfilePath, 'utf8'));
const bytes = (s) => s.trim().split(/\s+/).map((h) => parseInt(h, 16));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 1) Captura REAL del oficial: W (slot 44) a 0.2 mm; slot 45 = 0x21; resto 2.0 mm ──
// sendReport id=4, 63 bytes (sin Report ID). Copiado de la consola de Chrome.
const OFFICIAL_BLOCK0 = bytes(
  'b6 01 00 00 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 ' +
  '14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 02 21 14 14 14 14 14 14 14 14 14 14 14 14 14'
);
assert.strictEqual(OFFICIAL_BLOCK0.length, 63);

const profile = clone(official);
profile.keys_array[44].action_point = 0.2;
profile.keys_array[45].action_point = 3.3;
const frames = buildProfileFrames(profile);

assert.strictEqual(frames.length, 3, 'b6 01 debe ir en 3 bloques');
assert.ok(frames.every((f) => f.length === 64 && f[0] === 4));
assert.deepStrictEqual(frames[0].slice(1), OFFICIAL_BLOCK0, 'bloque 0 distinto del oficial');
assert.deepStrictEqual(frames[1].slice(1), [0xb6, 1, 0, 1, ...Array(59).fill(0x14)], 'bloque 1 distinto del oficial');
assert.deepStrictEqual(frames[2].slice(1), [0xb6, 1, 0, 2, ...Array(8).fill(0x14), ...Array(51).fill(0)], 'bloque 2 distinto del oficial');
console.log('1) b6 01 bloques 0, 1 y 2 idénticos byte a byte a la captura oficial');

// ── 2) b6 04 (distancia de activación): captura con 0.2 mm en los slots 44 y 45 ──
const sens = clone(official);
sens.keys_array[44].downstroke = 0.2;
sens.keys_array[45].downstroke = 0.2;
const withSens = buildProfileFrames(sens, { downstroke: true });
assert.strictEqual(withSens.length, 9, 'b6 01 + b6 04 + b6 05');
assert.deepStrictEqual(withSens[3].slice(1), [0xb6, 4, 0, 0, ...Array(44).fill(0), 2, 2, ...Array(13).fill(0)]);
assert.deepStrictEqual(withSens[4].slice(1), [0xb6, 4, 0, 1, ...Array(59).fill(0)]);
console.log('2) b6 04 bloques 0 y 1 coinciden con la captura (slots 44 y 45 = 02)');

// ── 3) Almacén de configuración ──
const cfgPath = path.join(os.tmpdir(), 'dd-selftest-config.json');
fs.rmSync(cfgPath, { force: true });
let cfg = store.initialize(cfgPath);
for (const p of cfg.profiles) assert.strictEqual(buildProfileFrames(p).length, 3);

const collapsed = clone(official);
collapsed.keys_array = collapsed.keys_array.filter((e) => e.keyname);   // formato antiguo: sin huecos
collapsed.keys_array.find((e) => e.keyname === 'W').action_point = 0.4;
fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, autoEnabled: true, profiles: [{ id: 'default', name: 'x', ...collapsed }], games: [] }));
cfg = store.initialize(cfgPath);
const def = cfg.profiles.find((p) => p.id === 'default');
assert.strictEqual(def.keys_array.length, MATRIX_SIZE);
assert.strictEqual(def.keys_array[44].action_point, 0.4);
console.log('3) config antigua migrada a 126 slots (W conserva su valor)');

cfg = store.importOfficialProfile(official);
const imp = cfg.profiles.find((p) => p.id.startsWith('custom-import-'));
store.updateKeySettingsBatch(imp.id, ['BACKSPACE', 'ENTER', '-', 'LSHIFT', 'Space', 'KeyW'], { action_point: 1.25 });
const slots = store.getConfig().profiles.find((p) => p.id === imp.id).keys_array;
for (const n of ['BACK', 'RETURN', 'MINUS', 'SHF_L', 'SPACE', 'W']) assert.strictEqual(slots[OFFICIAL_LAYOUT.indexOf(n)].action_point, 1.3, n);
assert.throws(() => store.updateKeySettingsBatch(imp.id, ['PRTSC'], { action_point: 1 }), /slot asignado/);
console.log('4) nombres de la UI -> slot oficial, redondeo a 0.1 mm y rechazo de teclas sin slot');

cfg = store.updateKeySettingsBatch(imp.id, ['KeyW', 'KeyE'], { action_point: 1.6 });
const multi = cfg.profiles.find((p) => p.id === imp.id).keys_array;
assert.strictEqual(multi[44].keyname, 'W');
assert.strictEqual(multi[45].keyname, 'E');
assert.strictEqual(multi[44].action_point, 1.6);
assert.strictEqual(multi[45].action_point, 1.6);
assert.ok(!multi.some((entry) => entry.keyname === 'WE'));
const multiFrames = buildProfileFrames(cfg.profiles.find((p) => p.id === imp.id));
assert.strictEqual(multiFrames[0][49], 16, 'W debe escribirse en slot 44');
assert.strictEqual(multiFrames[0][50], 16, 'E debe escribirse en slot 45');
console.log('5) selección W + E persiste y codifica dos slots distintos');

// ── 6) Iluminación (ae): capturas reales de brillo 9 y 8 ──
assert.deepStrictEqual(buildBrightnessFrame(9).slice(1), bytes('ae 01 00 00 02 05 09' + ' 00'.repeat(56)));
assert.deepStrictEqual(buildBrightnessFrame(8).slice(1), bytes('ae 01 00 00 02 05 08' + ' 00'.repeat(56)));
assert.strictEqual(buildBrightnessFrame(0)[7], 0);
assert.throws(() => buildBrightnessFrame(10), /no válido/);
console.log('6) ae brillo 9 y 8 idénticos byte a byte a la captura oficial');

// ── 7) Remap: reproducir BYTE A BYTE las capturas del software oficial (44 tramas por apply) ──
const loadMarks = (file) => {
  const out = []; let cur = null;
  for (const e of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    if (e.mark) { cur = { mark: e.mark, frames: [] }; out.push(cur); } else if (cur) cur.frames.push(bytes(e.hex));
  }
  return out;
};
const capRemap = process.argv[3] || 'captura_filtrada2.json';
if (fs.existsSync(capRemap)) {
  const applies = loadMarks(capRemap).filter((a) => a.frames.length === 44);
  const CASES = {
    Characters_S_C: { 64: 'B', 65: 'C' }, 'Numerals_W_4$': { 43: '1!', 44: '4$' }, Numpad_C_NumLock: { 46: 'KP1', 88: 'NUMLOCK' },
    LargeKwys_G_End: { 43: 'F1', 68: 'END' }, Modify_B_Win: { 68: 'LSHIFT', 90: 'WIN' },
    Multimedia_U_Mute: { 48: 'NEXT', 49: 'MUTE' }, Mouse_V_Downmove: { 89: 'MOUSE_DOWN', 92: 'MOUSE_LCLICK' }, Resetallkys: {},
  };
  let compared = 0;
  for (const apply of applies) {
    if (!(apply.mark in CASES)) continue;
    const layers = { default: new Map(Object.entries(CASES[apply.mark]).map(([slot, action]) => [Number(slot), remapTail(action).tail])) };
    const built = buildRemapFrames({ layers });
    assert.strictEqual(built.length, 44);
    built.forEach((f, i) => assert.deepStrictEqual(f.slice(1), apply.frames[i], `${apply.mark}: trama ${i}`));
    compared += 1;
  }
  assert.ok(compared >= 10, `solo se compararon ${compared} applies`);
  console.log(`7) ${compared} applies del oficial (A→B, números, numpad, F1/End, Shift/Win, Next/Mute, ratón, reset) reproducidos byte a byte`);
} else console.log('7) omitido: falta captura_filtrada2.json (node scripts/selftest.js Profile2.json captura_filtrada2.json captura_filtrada.json)');

const k = (code, name) => remapSlotFor(code, store.officialKeyName(code) || name);
assert.strictEqual(k('ArrowLeft'), 119); assert.strictEqual(k('ArrowDown'), 120); assert.strictEqual(k('ArrowRight'), 121);
assert.strictEqual(k('ArrowUp'), 98); assert.strictEqual(k('Delete'), 14); assert.strictEqual(k('End'), 100);
assert.strictEqual(k('KeyW'), 44); assert.strictEqual(k('Fn'), 116); assert.strictEqual(k('ContextMenu'), 117);
assert.strictEqual(k('PrintScreen'), undefined); assert.strictEqual(k('Insert'), undefined);
for (const nope of ['SHIFT', 'UNKNOWN_ACTION']) assert.strictEqual(remapTail(nope), null, nope);
for (const ok of ['VOL+', 'VOL-', 'PAUSE', 'STOP', 'BR+', 'RDT', 'LW']) assert.ok(remapTail(ok), ok);
assert.strictEqual(remapTail('PREV').tail[0], 0x95);
assert.strictEqual(remapTail('RCTRL').source, 'derived');
assert.throws(() => buildRemapFrames({ layers: { fn3: new Map() } }), /Capa desconocida/);
console.log('8) slots físicos (flechas 119–121, Del/Home/PgUp/PgDn/End), acciones validadas, capas validadas');

// ── 9) Rendimiento: b6 01/04/05 y Turbo/Key tracking de la captura ──
const capPerf = process.argv[4] || 'captura_filtrada.json';
if (fs.existsSync(capPerf)) {
  const marks = loadMarks(capPerf);
  const apply = marks.find((a) => a.mark.startsWith('set_action_point_1.5mm_E'));
  const b6 = apply.frames.filter((f) => f[0] === 0xb6 && [1, 4, 5].includes(f[1]));
  assert.strictEqual(b6.length, 9);
  const val = (sub, slot) => b6.find((f) => f[1] === sub && f[3] === Math.floor(slot / 59))[4 + (slot % 59)];
  const prof = { keys_array: OFFICIAL_LAYOUT.map((keyname, slot) => ({ keyname, action_point: val(1, slot) / 10, downstroke: val(4, slot) / 10, upstroke: val(5, slot) / 10 })) };
  assert.deepStrictEqual(buildProfileFrames(prof, { downstroke: true }).map((f) => f.slice(1)), b6, 'b6 01/04/05 distintos del oficial');
  const turbo = marks.find((a) => a.mark === 'Turbomode_on').frames[0];
  assert.deepStrictEqual(buildTurboFrame(true).slice(1), turbo);
  assert.deepStrictEqual(buildTurboFrame(false).slice(1), marks.find((a) => a.mark === 'Turbomode_off').frames[0]);
  const trk = marks.find((a) => a.mark === 'keystroketracking_off').frames;
  assert.deepStrictEqual(buildKeyTrackingFrame(true).slice(1), trk[0]);
  assert.deepStrictEqual(buildKeyTrackingFrame(false).slice(1), trk[1]);
  console.log('9) b6 01 + b6 04 + b6 05 (9 tramas), Turbo y Key tracking idénticos a la captura');
}
for (const [ap, max] of [[0.2, 2.9], [1.5, 1.6], [2.0, 1.1], [3.3, 0]]) assert.strictEqual(maxDownstrokeMm(ap), max);
console.log('10) máximo de bajada = 3.1 − actuación (0.2→2.9, 1.5→1.6, 2.0→1.1, 3.3→0)');

// ── 11) Last Win, Release Dual-Trigger y Lighting turn off ──
const lwOvr = lastWinOverrides([['A', 'D']]);
assert.deepStrictEqual(lwOvr.get(64), [0xf8, 0x00, 0x00, 0x00, 0x01]);
assert.deepStrictEqual(lwOvr.get(66), [0xf8, 0x00, 0x00, 0x01, 0x01]);
const dtData = buildDualTriggerData([{ mainKey: { keyname: 'A' }, triggerKey: { keyname: 'D' }, x2Active: 1.5, x2Reset: 0.1, isRdtEnabled: true }]);
assert.deepStrictEqual(dtData.overrides.get(64), [0xf8, 0x01, 0x00, 0x00, 0x01]);
assert.strictEqual(dtData.frames.length, 2);
assert.strictEqual(dtData.frames[0][1], 0xa7);
assert.strictEqual(dtData.frames[1][1], 0xa8);
assert.strictEqual(dtData.frames[1][39], 0x07); // D usage 0x07
assert.strictEqual(dtData.frames[1][44], 0x07);
assert.deepStrictEqual(buildEffectFrame({ effect: 'off', speed: 5, brightness: 9 }).slice(1, 9), [0xae, 0x01, 0x00, 0x00, 0x00, 0x05, 0x09, 0x00]);
assert.strictEqual(buildPerformanceFrame({ mode: 'lastWin' })[11], 0x01);
assert.strictEqual(buildPerformanceFrame({ mode: 'dualTrigger' })[11], 0x02);
console.log('11) Last Win, Release Dual-Trigger (a7/a8) y Lighting turn off verificados');
console.log('\nTodo correcto.');
