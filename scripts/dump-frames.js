'use strict';

// Uso: node scripts/dump-frames.js <perfil.json> [--sens] [--init]
// Imprime los slots con valor distinto de 2.0 mm y las tramas HID en hexadecimal
// para compararlas byte a byte con tu captura WebHID del software oficial.

const fs = require('fs');
const { buildProfileFrames, OFFICIAL_LAYOUT, MATRIX_SIZE, KEYS_PER_BLOCK } = require('../src/protocol');

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Uso: node scripts/dump-frames.js <perfil.json>');
  process.exit(1);
}

const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const keys = profile.keys_array || [];
console.log(`Slots en el archivo: ${keys.length} (esperados: ${MATRIX_SIZE})`);

const wrongName = keys.filter((e, i) => (e.keyname || '') !== OFFICIAL_LAYOUT[i]).length;
console.log(`Slots cuyo nombre no coincide con el layout: ${wrongName}`);

console.log('\nSlots con action_point distinto de 2.0 mm (slot -> nombre -> mm -> byte):');
keys.forEach((e, i) => {
  if (e.action_point !== 2) console.log(`  [${i}] ${e.keyname || '(vacío)'} -> ${e.action_point} mm -> 0x${Math.round(e.action_point * 10).toString(16).padStart(2, '0')}`);
});

const hex = (frame) => frame.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const frames = buildProfileFrames(profile, { init: process.argv.includes('--init'), downstroke: process.argv.includes('--sens') });
console.log(`\nTramas a enviar: ${frames.length} (bloques de hasta ${KEYS_PER_BLOCK} slots)\n`);
frames.forEach((frame, i) => console.log(`#${i} (${frame.length} bytes)\n${hex(frame)}\n`));
