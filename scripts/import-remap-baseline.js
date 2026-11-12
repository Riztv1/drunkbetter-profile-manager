'use strict';

// Uso: node scripts/import-remap-baseline.js <captura.json> [salida.json]
// <captura.json>: el log WebHID del software oficial (array de { out, id, hex }) con los 14 bloques a0 02 04.
// Guarda las entradas reales de los slots sin valor integrado (modificadores, bloque derecho, huecos…) y
// lista las diferencias en los slots conocidos (una remapeo tuyo, o un valor integrado mal inferido).
// Copia la salida como remap-baseline.json en la carpeta userData de la app (junto a config.json).

const fs = require('fs');
const { REMAP_CHUNKS, REMAP_ENTRIES_PER_CHUNK: PER, MATRIX_SIZE, OFFICIAL_LAYOUT, defaultRemapEntry } = require('../src/protocol');

const [input, output = 'remap-baseline.json'] = process.argv.slice(2);
if (!input) { console.error('Uso: node scripts/import-remap-baseline.js <captura.json> [salida.json]'); process.exit(1); }

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const chunks = new Map(JSON.parse(fs.readFileSync(input, 'utf8'))
  .filter((e) => e.out && /^a0 02 04 /i.test(String(e.hex).trim()))
  .map((e) => String(e.hex).trim().split(/\s+/).map((h) => parseInt(h, 16)))
  .map((bytes) => [bytes[3], bytes]));

console.log(`Bloques a0 02 04 encontrados: ${[...chunks.keys()].sort((a, b) => a - b).join(', ') || 'ninguno'} (se esperan 1–${REMAP_CHUNKS})`);
const baseline = {};
for (const [chunk, bytes] of chunks) {
  for (let i = 0; i < PER; i += 1) {
    const slot = (chunk - 1) * PER + i;
    if (slot >= MATRIX_SIZE) break;
    const entry = bytes.slice(6 + i * 6, 12 + i * 6); // 63 bytes sin Report ID: las entradas empiezan en el 6
    const known = defaultRemapEntry(slot);
    if (!known) baseline[slot] = hex(entry);
    else if (hex(known) !== hex(entry)) console.log(`  Diferencia en ${OFFICIAL_LAYOUT[slot]} (slot ${slot}): capturado ${hex(entry)} | integrado ${hex(known)}`);
  }
}
const missing = OFFICIAL_LAYOUT.map((_, slot) => slot).filter((slot) => !defaultRemapEntry(slot) && !baseline[slot]);
fs.writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
console.log(`Guardado ${output}: ${Object.keys(baseline).length} slots. Sin dato: ${missing.length ? missing.join(', ') : 'ninguno'}.`);
