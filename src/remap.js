'use strict';

// Construye las tramas de remap a partir de las capas de la UI: { default: [[code, action]…], fn: […], fn2: […] }.
// Valida TODO antes de devolver nada: si algo no es seguro lanza error y no se envía ni una trama.
const protocol = require('./protocol');
const configStore = require('./configStore');
const baseline = require('./remapBaseline');

function build(layers, { lastWin = [], dualGroups = [], onlyDefaultLayer = false } = {}) {
  const maps = {};
  const derived = [];
  for (const layer of Object.keys(protocol.REMAP_LAYER_BYTE)) {
    maps[layer] = new Map();
    for (const pair of (layers && layers[layer]) || []) {
      const [code, action] = Array.isArray(pair) ? pair : [];
      const slot = protocol.remapSlotFor(code, configStore.officialKeyName(code));
      if (slot === undefined) throw new Error(`La tecla "${code}" no existe en el A75 Pro y no se puede remapear.`);
      const entry = protocol.remapTail(action);
      if (!entry) throw new Error(`"${action}" aún no tiene trama conocida (sin captura y no deducible). Quítala o cámbiala.`);
      if (entry.source === 'derived') derived.push(`${code}→${action}`);
      maps[layer].set(slot, entry.tail);
    }
  }
  const extra = protocol.lastWinOverrides(lastWin);
  const dual = protocol.buildDualTriggerData(dualGroups);
  for (const [slot, entryTail] of dual.overrides) extra.set(slot, entryTail);
  return {
    frames: protocol.buildRemapFrames({ layers: maps, extra, tail: dual.frames, onlyDefaultLayer }),
    derived,
  };
}

const hasEntries = (layers) => Boolean(layers) && Object.values(layers).some((list) => Array.isArray(list) && list.length);

const FN2_EXTRA_DEFAULTS = { KeyQ: 'RDT', KeyZ: 'LW', MetaLeft: 'LOCK_WIN' };

/**
 * Quita las asignaciones que dejan la tecla igual que de fábrica (misma trama que la tabla base de esa capa).
 * Si tras quitarlas no queda nada, el perfil vuelve a «sin remap» (se quita el puntito ●).
 */
function stripDefaults(layers) {
  const out = {};
  for (const layer of Object.keys(protocol.REMAP_LAYER_BYTE)) {
    out[layer] = [];
    for (const pair of (layers && layers[layer]) || []) {
      const [code, action] = Array.isArray(pair) ? pair : [];
      if (layer === 'fn2' && FN2_EXTRA_DEFAULTS[code] === String(action || '').trim().toUpperCase()) continue;
      const slot = protocol.remapSlotFor(code, configStore.officialKeyName(code));
      const entry = protocol.remapTail(action);
      const base = slot !== undefined ? baseline[layer]?.[slot] : null;
      if (base && entry) {
        const baseTail = base.trim().split(/\s+/).slice(1, 4).map((h) => parseInt(h, 16));
        if (baseTail.every((byte, i) => byte === entry.tail[i])) continue;
      }
      out[layer].push(pair);
    }
  }
  return out;
}

module.exports = { build, hasEntries, stripDefaults };
