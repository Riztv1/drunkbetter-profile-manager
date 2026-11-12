'use strict';

// Sonda HID independiente (sin Electron). CIERRA antes la app Electron y la web oficial.
//
//   node scripts/probe-hid.js [perfil.json] [opciones]
//
//   --key=W         con --mm, aplica los mm SOLO a esa tecla (nombre de slot oficial)
//   --mm=0.2        mm de action point (sin --key: TODAS las teclas)
//   --sens          envía también b6 04 (distancia de activación; con --down=<mm> la fija en todas)
//   --down=0.2      downstroke en mm para todas las teclas (solo se envía con --sens)
//   --init          antepone a0 02
//   --pad=0x14      relleno de los bytes sin uso del último bloque (por defecto 0x00, como el oficial)
//   --wait=400      ms de espera tras cada trama para capturar respuestas
//
// Sin argumentos envía "todo a 2.0 mm": sirve para restaurar el estado normal.

const fs = require('fs');
const HID = require('node-hid');
const cfg = require('../src/config');
const {
  buildProfileFrames, OFFICIAL_LAYOUT, HEADER_LENGTH, MATRIX_SIZE, KEYS_PER_BLOCK, REPORT_LENGTH, SUB_ACTION_POINT,
} = require('../src/protocol');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};
const file = args.find((a) => !a.startsWith('--'));
const waitMs = Number(opt('wait', 400));
const pad = opt('pad', null);
const mm = opt('mm', null);
const key = opt('key', null);
const down = opt('down', null);

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = file
  ? JSON.parse(fs.readFileSync(file, 'utf8'))
  : { keys_array: OFFICIAL_LAYOUT.map((keyname) => ({ keyname, action_point: 2, downstroke: 0 })) };
if (key && !OFFICIAL_LAYOUT.includes(key)) {
  console.error(`"${key}" no es un nombre de slot oficial.`);
  process.exit(1);
}
if (mm !== null) {
  profile.keys_array.forEach((entry) => { if (!key || entry.keyname === key) entry.action_point = Number(mm); });
}
if (down !== null) profile.keys_array.forEach((entry) => { entry.downstroke = Number(down); });

const frames = buildProfileFrames(profile, { init: args.includes('--init'), downstroke: args.includes('--sens') });
if (pad !== null) {
  const last = frames.find((f) => f[1] === 0xb6 && f[2] === SUB_ACTION_POINT && f[4] === 2);
  for (let i = HEADER_LENGTH + (MATRIX_SIZE % KEYS_PER_BLOCK); i < REPORT_LENGTH; i += 1) last[i] = Number(pad);
}

const candidates = HID.devices().filter((d) => d.vendorId === cfg.VENDOR_ID && d.productId === cfg.PRODUCT_ID);
const target = candidates.find((d) => d.usagePage === 0xff00);
if (!target) {
  console.error('No se encontró la colección 0xFF00. Disponibles:');
  for (const d of candidates) console.error(`  usagePage=0x${d.usagePage.toString(16)} usage=${d.usage} ${d.path}`);
  process.exit(1);
}

(async () => {
  console.log(`Abriendo ${target.path}`);
  console.log(`key: ${key ?? 'todas'} | mm: ${mm ?? 'del perfil'} | --sens: ${args.includes('--sens')} | --init: ${args.includes('--init')}\n`);

  const device = new HID.HID(target.path);
  device.on('data', (data) => console.log(`   <- IN  ${hex(data.slice(0, 16))} ...`));
  device.on('error', (error) => console.log(`   ! error HID: ${error.message}`));

  for (const [i, frame] of frames.entries()) {
    try {
      const returned = device.write(frame);
      console.log(`-> #${i} returned=${returned}  ${hex(frame.slice(0, 12))} ...`);
    } catch (error) {
      console.log(`-> #${i} FALLÓ: ${error.message}`);
    }
    await sleep(waitMs);
  }

  await sleep(1000);
  device.close();
  console.log('\nHecho. Comprueba el teclado.');
})();
