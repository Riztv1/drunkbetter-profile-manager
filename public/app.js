'use strict';

const $ = (id) => document.getElementById(id);
const bridge = window.drunkdeer;
const selectedKeys = new Set();
const changedSliders = new Set();
// Teclas del bloque derecho cuyo slot aún no está calibrado (el JSON oficial las llama KP7…NUMS).
const UNMAPPED_KEYS = new Set(['DEL', 'HOME', 'PGUP', 'PGDN', 'END', 'PRTSC', 'INS']);
let appState = null;
let appliedLang = null;

function activeLang() {
  return window.I18N.resolveLang(
    appState?.config?.settings?.language,
    appState?.locale || navigator.language
  );
}
const tr = (key, vars) => window.I18N.t(activeLang(), key, vars);

function profileDisplayName(profile) {
  if (!profile) return '';
  if (profile.id === 'default' && profile.name === 'Escritura estándar') return tr('builtin.default');
  if (profile.id === 'game' && profile.name === 'Juego (Rapid Trigger)') return tr('builtin.game');
  return profile.name;
}

function applyTranslations(force = false) {
  const lang = activeLang();
  if (!force && lang === appliedLang) return;
  appliedLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = tr(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', tr(el.dataset.i18nAria)); });
  if (typeof ACTION_INFO !== 'undefined') {
    ACTION_INFO.get('MOUSE_LCLICK').label = tr('remap.mouseLeft');
    ACTION_INFO.get('MOUSE_MCLICK').label = tr('remap.mouseWheel');
    ACTION_INFO.get('MOUSE_RCLICK').label = tr('remap.mouseRight');
    renderRemapActionGroups();
    renderRemapKeyboard();
  }
  updateColorSelection();
  updateMainKeySelection();
  updateRemapSelectionCount();
}
let activeProfileId = 'default';
let sliderContext = null;
let activeRemapLayer = 'default';
const remapSelectedKeys = new Set();
const remapAssignments = {
  default: new Map(),
  fn: new Map(),
  fn2: new Map(),
};
let lightingEffect = 'off';
let preTurboEffect = 'off';     // último efecto no-turbo antes de activar Turbo Mode
const customColors = new Map(); // código de tecla -> #rrggbb (solo Custom light)
const turboCustomColors = new Map(); // código de tecla -> #rrggbb (solo Turbo mode light)
let lightingColourIndex = 1;    // 1 rojo … 7 blanco (efectos con color)
let lightingColor = '#ff343b';
let lightingBrightness = 9;
let lightingSpeed = 5;
let colorAllKeys = true;
const colorSelectedKeys = new Set();
let turboProtectionClicks = 0;
let turboProtectionTarget = null;
let turboTransitionPending = false;

function isTurboModeActive() {
  return Boolean(currentProfile()?.features?.turboMode);
}

function resetTurboProtection() {
  turboProtectionClicks = 0;
  turboProtectionTarget = null;
  hideTurboBanner();
}

// Aviso corto: solo aparece cuando el usuario pulsa otro efecto con Turbo Mode activo.
let turboBannerTimer = null;
function showTurboBanner(message, autoHideMs = 0) {
  clearTimeout(turboBannerTimer);
  $('turboClickStatus').textContent = message;
  $('turboWarningBanner').hidden = false;
  if (autoHideMs) turboBannerTimer = setTimeout(hideTurboBanner, autoHideMs);
}
function hideTurboBanner() {
  clearTimeout(turboBannerTimer);
  if ($('turboWarningBanner')) $('turboWarningBanner').hidden = true;
}

// Efectos cuyo color se puede elegir (los demás solo admiten brillo y/o velocidad y no pintan el teclado virtual).
const COLOR_EFFECTS = new Set(['turbo', 'custom', 'always', 'breath', 'lightByPress', 'waveSpectrum', 'ripple', 'laserKey']);

function enforceTurboLightState() {
  if (turboTransitionPending) return;
  if (isTurboModeActive() && lightingEffect !== 'turbo') {
    if (lightingEffect) preTurboEffect = lightingEffect;
    setLightingEffect('turbo', false);
  } else if (!isTurboModeActive() && lightingEffect === 'turbo') {
    const savedEffect = appState?.config?.settings?.lastLighting?.effect;
    const restoreTo = (preTurboEffect && preTurboEffect !== 'turbo') ? preTurboEffect : (savedEffect || 'custom');
    setLightingEffect(restoreTo, false);
  }
}

// Rangos REALES medidos en las capturas del software oficial (captura_filtrada.json):
//   Punto de actuación: 0.2–3.3 mm.   Release Reset (subida): hasta 3.1 mm.
//   Press to activate (bajada): hasta 3.1 − actuación (0.2→2.9, 1.5→1.6, 2.0→1.1, 3.3→0.0).
const TRAVEL_LIMIT = 3.1;
const SENSITIVITY_RANGE = { min: 0.1, max: TRAVEL_LIMIT, step: 0.1 };
const maxDownstroke = (actionPoint) => Math.max(0, Math.round((TRAVEL_LIMIT - actionPoint) * 10) / 10);
const sliderStored = {}; // qué sliders tenían valor guardado (>0) en la tecla seleccionada
const KEY_SLIDERS = [
  { id: 'actionPoint', setting: 'action_point', fallback: 2.0 },
  { id: 'downstroke', setting: 'downstroke', fallback: 0.2 },
  { id: 'upstroke', setting: 'upstroke', fallback: 0.1 },
];

const keyRows = [
  [['Escape', 'Esc', 1], ['gap', '', 0.45], ['F1', 'F1', 1], ['F2', 'F2', 1], ['F3', 'F3', 1], ['F4', 'F4', 1], ['gap', '', 0.45], ['F5', 'F5', 1], ['F6', 'F6', 1], ['F7', 'F7', 1], ['F8', 'F8', 1], ['gap', '', 0.45], ['F9', 'F9', 1], ['F10', 'F10', 1], ['F11', 'F11', 1], ['F12', 'F12', 1], ['gap', '', 0.45], ['Delete', 'Del', 1]],
  [['Backquote', '`', 1], ['Digit1', '1', 1], ['Digit2', '2', 1], ['Digit3', '3', 1], ['Digit4', '4', 1], ['Digit5', '5', 1], ['Digit6', '6', 1], ['Digit7', '7', 1], ['Digit8', '8', 1], ['Digit9', '9', 1], ['Digit0', '0', 1], ['Minus', '-', 1], ['Equal', '=', 1], ['Backspace', 'Backspace', 2], ['gap', '', 0.45], ['Home', 'Home', 1]],
  [['Tab', 'Tab', 1.5], ['KeyQ', 'Q', 1], ['KeyW', 'W', 1], ['KeyE', 'E', 1], ['KeyR', 'R', 1], ['KeyT', 'T', 1], ['KeyY', 'Y', 1], ['KeyU', 'U', 1], ['KeyI', 'I', 1], ['KeyO', 'O', 1], ['KeyP', 'P', 1], ['BracketLeft', '[', 1], ['BracketRight', ']', 1], ['Backslash', '\\', 1.5], ['gap', '', 0.45], ['PageUp', 'PgUp', 1]],
  [['CapsLock', 'Caps', 1.8], ['KeyA', 'A', 1], ['KeyS', 'S', 1], ['KeyD', 'D', 1], ['KeyF', 'F', 1], ['KeyG', 'G', 1], ['KeyH', 'H', 1], ['KeyJ', 'J', 1], ['KeyK', 'K', 1], ['KeyL', 'L', 1], ['Semicolon', ';', 1], ['Quote', "'", 1], ['Enter', 'Enter', 2.2], ['gap', '', 0.45], ['PageDown', 'PgDn', 1]],
  [['ShiftLeft', 'Shift', 2.3], ['KeyZ', 'Z', 1], ['KeyX', 'X', 1], ['KeyC', 'C', 1], ['KeyV', 'V', 1], ['KeyB', 'B', 1], ['KeyN', 'N', 1], ['KeyM', 'M', 1], ['Comma', ',', 1], ['Period', '.', 1], ['Slash', '/', 1], ['ShiftRight', 'Shift', 2.7], ['gap', '', 0.45], ['ArrowUp', '↑', 1], ['End', 'End', 1]],
  [['ControlLeft', 'Ctrl', 1.3], ['MetaLeft', 'Win', 1.2], ['AltLeft', 'Alt', 1.2], ['Space', 'Space', 6.3], ['AltRight', 'Alt', 1.2], ['Fn', 'Fn', 1.1], ['ContextMenu', 'Menu', 1.2], ['gap', '', 0.45], ['ArrowLeft', '←', 1], ['ArrowDown', '↓', 1], ['ArrowRight', '→', 1]],
];

const officialKeyNames = {
  Escape: 'ESC', PrintScreen: 'PRTSC', Delete: 'DEL', Backquote: '`', Backspace: 'BACKSPACE',
  PageUp: 'PGUP', PageDown: 'PGDN', CapsLock: 'CAPS', ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT',
  ControlLeft: 'LCTRL', ControlRight: 'RCTRL', MetaLeft: 'LWIN', AltLeft: 'LALT', AltRight: 'RALT',
  ContextMenu: 'MENU', Space: 'SPACE', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',',
  Period: '.', Slash: '/', Minus: '-', Equal: '=', Insert: 'INS', Home: 'HOME', End: 'END', Tab: 'TAB', Enter: 'ENTER',
};

function officialKeyName(code) {
  if (officialKeyNames[code]) return officialKeyNames[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code.toUpperCase();
}

function setMessage(message = '') {
  $('message').textContent = message;
}

function currentProfile() {
  return appState?.config.profiles.find((profile) => profile.id === activeProfileId);
}

// ───────── Selección por rectángulo (marquee) ─────────
let marqueeActive = false; // refresh() no reconstruye el teclado mientras se arrastra

const allKeyCodes = () => keyRows.flat().filter(([code]) => code !== 'gap').map(([code]) => code);
const labelByCode = new Map(keyRows.flat().filter(([code]) => code !== 'gap').map(([code, label]) => [code, label]));

function paintRange(input) {
  const span = Number(input.max) - Number(input.min);
  input.style.setProperty('--fill', `${span ? ((Number(input.value) - Number(input.min)) / span) * 100 : 0}%`);
}

function syncSelectionClasses(boardId, selection, className) {
  $(boardId).querySelectorAll('[data-key-code]').forEach((key) => {
    const on = selection.has(key.dataset.keyCode);
    key.classList.toggle(className, on);
    key.setAttribute('aria-pressed', String(on));
  });
}

/**
 * Rectángulo de selección tipo Windows sobre un teclado virtual.
 * - Arrastrar (>4 px) dibuja la caja; al soltar se seleccionan las teclas que la tocan (total o parcialmente).
 * - Clic sin arrastre sobre una tecla la alterna; clic en el fondo limpia (salvo Ctrl/Shift/Meta, que suman).
 * La caja es un hijo del visor (no del teclado), así que sobrevive a los re-render del teclado.
 */
function attachMarquee(viewportId, boardId, { getSelection, selectedClass, apply, toggle }) {
  const viewport = $(viewportId);
  const board = $(boardId);
  const box = document.createElement('div');
  box.className = 'marquee';
  box.hidden = true;
  viewport.append(box);
  let drag = null;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function onMove(event) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < 4) return;
      drag.moved = true;
      marqueeActive = true;
      box.hidden = false;
      drag.keys = [...board.querySelectorAll('[data-key-code]')]
        .map((el) => ({ el, code: el.dataset.keyCode, rect: el.getBoundingClientRect() }));
    }
    const area = viewport.getBoundingClientRect();
    const x = clamp(event.clientX, area.left, area.right);
    const y = clamp(event.clientY, area.top, area.bottom);
    const left = Math.min(drag.x0, x);
    const right = Math.max(drag.x0, x);
    const top = Math.min(drag.y0, y);
    const bottom = Math.max(drag.y0, y);
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });

    drag.next = new Set();
    for (const key of drag.keys) {
      const touches = key.rect.left < right && key.rect.right > left && key.rect.top < bottom && key.rect.bottom > top;
      const on = touches || (drag.additive && drag.base.has(key.code));
      if (on) drag.next.add(key.code);
      key.el.classList.toggle(selectedClass, on);
      key.el.setAttribute('aria-pressed', String(on));
    }
  }

  function finish() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    box.hidden = true;
    marqueeActive = false;
    const state = drag;
    drag = null;
    return state;
  }

  function onUp() {
    const state = finish();
    if (!state) return;
    if (state.moved) apply(state.next);
    else if (state.code) toggle(state.code);
    else if (!state.additive && getSelection().size) apply(new Set());
  }

  function onCancel() {
    const state = finish();
    if (state?.moved) apply(state.base);
  }

  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    drag = {
      x0: event.clientX,
      y0: event.clientY,
      moved: false,
      additive: event.ctrlKey || event.shiftKey || event.metaKey,
      base: new Set(getSelection()),
      code: event.target.closest?.('[data-key-code]')?.dataset.keyCode ?? null,
      keys: [],
      next: new Set(),
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}

function renderProfiles() {
  const root = $('profiles');
  root.replaceChildren(...appState.config.profiles.map((profile) => {
    const label = profileDisplayName(profile);
    const item = document.createElement('div');
    item.className = 'profile-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-button${profile.id === activeProfileId ? ' active' : ''}`;
    button.textContent = label + (profile.remap ? ' ●' : '');
    if (profile.remap) button.title = tr('main.profileRemapTitle');
    button.oncontextmenu = (event) => { event.preventDefault(); startProfileRename(button, profile); };
    button.onclick = () => {
      activeProfileId = profile.id;
      selectedKeys.clear();
      render();
    };
    item.append(button);
    if (profile.id.startsWith('custom-')) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-profile';
      remove.textContent = '×';
      remove.title = tr('main.removeProfileTitle', { name: label });
      remove.setAttribute('aria-label', tr('main.removeProfileTitle', { name: label }));
      remove.onclick = async () => {
        try {
          appState.config = await bridge.removeProfile(profile.id);
          if (activeProfileId === profile.id) activeProfileId = 'default';
          render();
          setMessage(tr('main.profileDeleted'));
        } catch (error) {
          setMessage(error.message);
        }
      };
      item.append(remove);
    }
    return item;
  }));

  const selector = $('gameProfile');
  const selected = selector.value;
  selector.replaceChildren(...appState.config.profiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profileDisplayName(profile);
    return option;
  }));
  if (appState.config.profiles.some((profile) => profile.id === selected)) selector.value = selected;
}

function renderKeyboard() {
  const configuredKeys = new Map((currentProfile()?.keys_array || []).map((entry) => [entry.keyname, entry]));
  $('keyboard').replaceChildren(...keyRows.map((row) => {
    const rowElement = document.createElement('div');
    rowElement.className = 'key-row';
    for (const [code, label, width] of row) {
      if (code === 'gap') {
        const gap = document.createElement('span');
        gap.className = 'key-gap';
        rowElement.append(gap);
        continue;
      }
      const keyname = officialKeyName(code);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `key${selectedKeys.has(code) ? ' selected' : ''}${configuredKeys.has(keyname) ? ' configured' : ''}`;
      button.dataset.keyCode = code;
      button.textContent = label;
      button.style.setProperty('--width', width);
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(selectedKeys.has(code)));
      button.title = code;
      button.onclick = (event) => {
        if (event.detail !== 0) return;
        if (selectedKeys.has(code)) selectedKeys.delete(code);
        else selectedKeys.add(code);
        button.classList.toggle('selected', selectedKeys.has(code));
        button.setAttribute('aria-pressed', String(selectedKeys.has(code)));
        updateMainKeySelection();
      };
      rowElement.append(button);
    }
    return rowElement;
  }));
  updateMainKeySelection();
}

function selectionLabel(count) {
  if (!count) return tr('editor.noneSelected');
  return count === 1 ? tr('editor.oneSelected') : tr('editor.manySelected', { n: count });
}

function updateMainKeySelection() {
  $('selectionCount').textContent = selectionLabel(selectedKeys.size);
  renderSelectionSettings();
}

function renderSelectionSettings() {
  const context = `${activeProfileId}:${[...selectedKeys].sort().join(',')}`;
  if (context === sliderContext) return;
  sliderContext = context;
  changedSliders.clear();
  const firstKey = selectedKeys.values().next().value;
  const keyname = firstKey ? officialKeyName(firstKey) : null;
  const settings = keyname ? currentProfile()?.keys_array.find((entry) => entry.keyname === keyname) : null;
  // Un 0 guardado en el perfil significa "sin definir": el slider muestra su valor por defecto.
  for (const { id, setting, fallback } of KEY_SLIDERS) {
    const stored = Number(settings?.[setting]);
    sliderStored[id] = stored > 0;
    $(id).value = stored > 0 ? stored : fallback;
  }
  applySensitivityLimits();
  updateSliderValues();
}

function refreshSlider(id) {
  $(`${id}Value`).value = `${Number($(id).value).toFixed(1)}mm`;
  paintRange($(id));
}

function updateSliderValues() {
  KEY_SLIDERS.forEach(({ id }) => refreshSlider(id));
}

// El máximo de "Press to activate" sigue al punto de actuación; con actuación ≥ 3.1 mm no hay recorrido y queda en 0.
function applySensitivityLimits(fromUser = false) {
  const down = $('downstroke');
  const max = maxDownstroke(Number($('actionPoint').value));
  const unavailable = max < SENSITIVITY_RANGE.min;
  down.disabled = unavailable;
  down.min = unavailable ? '0' : String(SENSITIVITY_RANGE.min);
  down.max = String(unavailable ? 0 : max);
  if (unavailable) down.value = '0';
  else if (Number(down.value) > max) {
    down.value = String(max);
    if (fromUser && sliderStored.downstroke) changedSliders.add('downstroke'); // había un valor guardado y ya no cabe: se reescribe
  }
  refreshSlider('downstroke');
}

function renderRemapKeyboard() {
  const assignments = remapAssignments[activeRemapLayer];
  $('remapKeyboard').replaceChildren(...keyRows.map((row) => {
    const rowElement = document.createElement('div');
    rowElement.className = 'key-row';
    for (const [code, label, width] of row) {
      if (code === 'gap') {
        const gap = document.createElement('span');
        gap.className = 'key-gap';
        rowElement.append(gap);
        continue;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `key remap-key${remapSelectedKeys.has(code) ? ' drag-selected' : ''}`;
      button.dataset.keyCode = code;
      button.style.setProperty('--width', width);
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(remapSelectedKeys.has(code)));
      const keyLabel = document.createElement('span');
      keyLabel.className = 'remap-key-label';
      keyLabel.textContent = label;
      button.append(keyLabel);

      const assignment = assignments.get(code);
      const fallback = activeRemapLayer === 'fn2' && !assignment ? FN2_DEFAULTS[code] : null;
      if (assignment || fallback) {
        const assignmentLabel = document.createElement('span');
        assignmentLabel.className = 'remap-key-action';
        if (assignment) {
          button.classList.add('has-assignment');
          fillActionContent(assignmentLabel, assignment);
        } else {
          assignmentLabel.classList.add('default-action');
          fillActionContent(assignmentLabel, fallback[0], fallback[1]);
        }
        button.append(assignmentLabel);
      }

      button.onclick = (event) => {
        if (event.detail === 0) setRemapKeySelected(code, !remapSelectedKeys.has(code));
      };
      rowElement.append(button);
    }
    return rowElement;
  }));
  updateRemapSelectionCount();
}

function setRemapKeySelected(code, selected) {
  if (selected) remapSelectedKeys.add(code);
  else remapSelectedKeys.delete(code);
  const key = $('remapKeyboard').querySelector(`[data-key-code="${code}"]`);
  if (key) {
    key.classList.toggle('drag-selected', selected);
    key.setAttribute('aria-pressed', String(selected));
  }
  updateRemapSelectionCount();
}

function updateRemapSelectionCount() {
  $('remapSelectionCount').textContent = selectionLabel(remapSelectedKeys.size);
}

function assignRemapAction(action) {
  if (!remapSelectedKeys.size) {
    $('remapStatus').textContent = tr('remap.needSelectionPreview');
    return;
  }
  const assignments = remapAssignments[activeRemapLayer];
  for (const key of remapSelectedKeys) assignments.set(key, action);
  renderRemapKeyboard();
  $('remapStatus').textContent = tr('remap.previewAssigned', { action, n: remapSelectedKeys.size, layer: activeRemapLayer });
}

function setRemapLayer(layer) {
  if (!remapAssignments[layer]) return;
  activeRemapLayer = layer;
  remapSelectedKeys.clear();
  document.querySelectorAll('.remap-layer').forEach((button) => {
    const active = button.dataset.layer === layer;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('remapLayerTitle').textContent = layer === 'fn2' ? 'Fn2' : layer === 'fn' ? 'Fn' : 'Default';
  $('remapStatus').textContent = tr('remap.pendingStatus');
  renderRemapKeyboard();
}

// Acciones del panel derecho: [id, etiqueta, icono opcional]. Los iconos se buscan en public/icons/<icono>.svg (o .png);
// si el archivo no existe se muestra la etiqueta de texto.
const FUNCTION_ACTIONS = [
  ['LIGHT_BUTTON', 'Light button', 'light-button'], ['LIGHTING_CYCLE', 'Lighting Cycle', 'lighting-cycle'],
  ['COLOR_CYCLE', 'Color cycle', 'color-cycle'], ['PAUSE_LIGHT', 'Pause light effect', 'pause-light-effect'],
  ['MODE_MINUS', 'Lighting Mode-', 'lighting-mode-minus'], ['MODE_PLUS', 'Lighting Mode+', 'lighting-mode-plus'],
  ['BR+', 'BR+'], ['BR-', 'BR-'], ['SP+', 'SP+'], ['SP-', 'SP-'],
  ['LOCK_WIN', 'Lock Win', 'lock-win'], ['RDT', 'RDT'], ['LW', 'LW'],
];
const ACTION_GROUPS = {
  function: FUNCTION_ACTIONS,
  characters: [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => [l, l]),
    ['=+', '= +'], ['-_', '- _'], ['[{', '[ {'], [']}', '] }'], ['\\|', '\\ |'], [';:', '; :'], ["'\"", "'"], [',<', ', <'], ['.>', '. >'], ['`~', '` ~'], ['/?', '/ ?'],
  ],
  numerals: ['1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)'].map((n) => [n, n]),
  numpad: [
    ['KP1', '1'], ['KP2', '2'], ['KP3', '3'], ['KP4', '4'], ['KP5', '5'], ['KP6', '6'], ['KP7', '7'],
    ['KP8', '8'], ['KP9', '9'], ['KP0', '0'], ['KP+', '+'], ['KP-', '−'], ['KP*', '*'], ['KP/', '/'],
    ['KP.', '.'], ['KPENTER', 'Enter'], ['NUMLOCK', 'Num Lock'],
  ],
  large: [
    ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]),
    ['ESC', 'ESC'], ['TAB', 'Tab'], ['APP', 'APP'], ['INS', 'Ins'], ['END', 'End'], ['DEL', 'Del'], ['BACK', 'Back'],
    ['LEFT', 'Left'], ['RIGHT', 'Right'], ['UP', 'Up'], ['DOWN', 'Down'], ['ENTER', 'Enter'], ['HOME', 'Home'],
    ['PAUSE', 'Pause'], ['SPACE', 'Space'], ['CAPS', 'Caps'], ['PRTSC', 'Print'], ['PGDN', 'PgDn'], ['PGUP', 'PgUp'],
    ['SECTION', '§'], ['K56', 'K56'],
  ],
  modify: [
    ['LCTRL', 'LCtrl'], ['LSHIFT', 'LShift'], ['LALT', 'LAlt'], ['WIN', 'Win'], ['RCTRL', 'RCtrl'], ['RSHIFT', 'RShift'], ['RALT', 'RAlt'],
    ['FN', 'FN'], ['FN2', 'menu Fn2'], ['SCROLLLK', 'ScrollLK'],
  ],
  media: [
    ['VOL+', 'Vol+', 'vol-up'], ['VOL-', 'Vol-', 'vol-down'], ['PREV', 'Prev', 'prev'], ['NEXT', 'Next', 'next'],
    ['MUTE', 'Mute', 'mute'], ['MEDIA_PAUSE', 'Pause', 'media-pause'], ['STOP', 'Stop', 'stop'],
  ],
  mouse: [
    ['MOUSE_LCLICK', 'Clic izq.', 'mouse-left'], ['MOUSE_MCLICK', 'Rueda', 'mouse-wheel'], ['MOUSE_RCLICK', 'Clic der.', 'mouse-right'],
    ['MOUSE_UP', '↑', 'mouse-move-up'], ['MOUSE_DOWN', '↓', 'mouse-move-down'], ['MOUSE_LEFT', '←', 'mouse-move-left'], ['MOUSE_RIGHT', '→', 'mouse-move-right'],
  ],
};
const ACTION_INFO = new Map(Object.values(ACTION_GROUPS).flat().map(([id, label, icon]) => [id, { label, icon }]));
// Fn2 trae de fábrica estas funciones (solo se muestran; el teclado ya las tiene, no se envían).
const FN2_DEFAULTS = {
  Tab: ['COLOR_CYCLE'], KeyQ: ['RDT'], KeyT: ['TBO', 'TBO'], KeyZ: ['LW'], MetaLeft: ['LOCK_WIN'],
  ArrowUp: ['BR+'], ArrowLeft: ['MODE_MINUS'], ArrowDown: ['BR-'], ArrowRight: ['MODE_PLUS'],
};

/** Rellena `target` con el icono de la acción (si existe el archivo) o con su texto. */
function fillActionContent(target, action, fallbackLabel) {
  const info = ACTION_INFO.get(action) || { label: fallbackLabel || action };
  const text = info.label;
  target.title = text;
  if (!info.icon) { target.textContent = text; return; }
  target.textContent = text;
  const tryLoad = (extensions) => {
    if (!extensions.length) return;
    const url = `icons/${info.icon}.${extensions[0]}`;
    const probe = new Image();
    probe.onload = () => {
      const icon = document.createElement('span');
      icon.className = 'remap-icon';
      icon.style.setProperty('--icon', `url("${url}")`);
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', text);
      target.replaceChildren(icon);
      target.classList.add('has-icon');
    };
    probe.onerror = () => tryLoad(extensions.slice(1));
    probe.src = url;
  };
  tryLoad(['svg', 'png']);
}

function renderRemapActionGroups() {
  for (const [group, actions] of Object.entries(ACTION_GROUPS)) {
    const root = document.querySelector(`[data-action-group="${group}"]`);
    if (!root) continue;
    root.replaceChildren(...actions.map(([action, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'remap-action';
      button.dataset.action = action;
      fillActionContent(button, action, label);
      button.onclick = () => assignRemapAction(action);
      return button;
    }));
  }
}

const dualGroups = () => (currentProfile()?.rtp.rdt_rtpSettings || [])
  .filter((group) => group?.mainKey?.keyname && group?.triggerKey?.keyname);
const lastWinGroups = () => currentProfile()?.features.lastWinGroups || [];
const keyRef = (code) => ({ keyname: officialKeyName(code), name: labelByCode.get(code) || code });
let rtpSignature = '';

function renderAdvancedControls() {
  const profile = currentProfile();
  if (!profile) return;
  // Release Dual-Trigger = rtp.rdt_open (grupos en rtp.rdt_rtpSettings); Last Win = rtp.lw_open
  // Last Win y Release Dual-Trigger activan Rapid Trigger solos (no se puede apagar mientras estén activos) y son excluyentes.
  const dualOn = Boolean(profile.rtp.rdt_open);
  const lastWinOn = Boolean(profile.rtp.lw_open);
  $('rapidTriggerMode').checked = Boolean(profile.features.rapidTrigger) || dualOn || lastWinOn;
  $('rapidTriggerMode').disabled = dualOn || lastWinOn;
  // Bajada/subida solo existen con Rapid Trigger; sin él solo se ve el punto de actuación.
  // Con Release Dual-Trigger los sliders los sustituyen sus propios valores (Press to activate / Press to reset).
  const showSensitivity = Boolean(profile.features.rapidTrigger) && !dualOn;
  $('downstrokeField').hidden = !showSensitivity;
  $('upstrokeField').hidden = !showSensitivity;
  $('releaseDualTrigger').checked = Boolean(profile.rtp.rdt_open);
  $('lastWinMode').checked = Boolean(profile.rtp.lw_open);
  $('turboMode').checked = Boolean(profile.features.turboMode);
  $('keystrokeTracking').checked = Boolean(profile.features.keystrokeTracking);
  syncTrackPanel();
  renderRtpPanels();
}

async function saveRtp(patch, okMessage) {
  try {
    appState.config = await bridge.updateProfileFeatures(activeProfileId, patch);
    renderAdvancedControls();
    setMessage(okMessage);
  } catch (error) {
    setMessage(error.message);
  }
}

function miniButton(text, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini';
  button.textContent = text;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.onclick = onClick;
  return button;
}

function chip(text) {
  const element = document.createElement('span');
  element.className = 'chip';
  element.textContent = text;
  return element;
}

function sliderField(label, value, onCommit) {
  const row = document.createElement('label');
  row.className = 'mini-field';
  const text = document.createElement('span');
  text.textContent = label;
  const output = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(SENSITIVITY_RANGE.min);
  input.max = String(SENSITIVITY_RANGE.max);
  input.step = String(SENSITIVITY_RANGE.step);
  input.value = Number(value).toFixed(1);
  const refreshView = () => { output.textContent = `${Number(input.value).toFixed(1)}mm`; paintRange(input); };
  refreshView();
  input.oninput = refreshView;
  input.onchange = () => onCommit(Number(input.value)); // se guarda al soltar, no en cada paso
  row.append(text, output, input);
  return row;
}

function dualGroupCard(group, index, groups) {
  const save = (next) => saveRtp({ rdt_rtpSettings: next }, tr('main.groupSaved'));
  const change = (patch) => save(groups.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const card = document.createElement('div');
  card.className = 'group-card';
  const head = document.createElement('div');
  head.className = 'group-head';
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = group.isRdtEnabled !== false;
  enabled.title = tr('main.enableGroup');
  enabled.onchange = () => change({ isRdtEnabled: enabled.checked });
  head.append(
    chip(group.mainKey.name || group.mainKey.keyname), '→', chip(group.triggerKey.name || group.triggerKey.keyname), spacer, enabled,
    miniButton('⇄', tr('main.swapKeys'), () => change({ mainKey: group.triggerKey, triggerKey: group.mainKey })),
    miniButton('×', tr('main.deleteGroup'), () => save(groups.filter((_, i) => i !== index))),
  );
  card.append(
    head,
    sliderField('Press to activate', group.x2Active ?? 1.5, (value) => change({ x2Active: value })),
    sliderField('Release reset', Math.max(0.1, group.x2Reset ?? 0.1), (value) => change({ x2Reset: value })),
  );
  return card;
}

function lastWinCard(group, index, groups) {
  const card = document.createElement('div');
  card.className = 'group-card';
  const head = document.createElement('div');
  head.className = 'group-head';
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  head.append(
    ...group.keys.map((key) => chip(key.name || key.keyname)), spacer,
    miniButton('×', tr('main.deleteGroup'), () => saveRtp({ lastWinGroups: groups.filter((_, i) => i !== index) }, tr('main.groupDeleted'))),
  );
  card.append(head);
  return card;
}

function renderRtpPanels() {
  $('dualPanel').hidden = !$('releaseDualTrigger').checked;
  $('lastWinPanel').hidden = !$('lastWinMode').checked;
  const dual = dualGroups();
  const lastWin = lastWinGroups();
  // Solo se reconstruye si cambian los datos: refresh() corre cada 2 s y no debe soltar un slider a medias.
  const signature = JSON.stringify([activeProfileId, dual, lastWin]);
  if (signature === rtpSignature) return;
  rtpSignature = signature;
  $('dualGroups').replaceChildren(...dual.map((group, index) => dualGroupCard(group, index, dual)));
  $('lastWinGroups').replaceChildren(...lastWin.map((group, index) => lastWinCard(group, index, lastWin)));
}

function renderGames() {
  const names = new Map(appState.config.profiles.map((profile) => [profile.id, profileDisplayName(profile)]));
  const root = $('gamesList');
  root.replaceChildren(...appState.config.games.map((game) => {
    const row = document.createElement('div');
    row.className = 'game-item';
    const description = document.createElement('div');
    description.className = 'game-meta';
    const process = document.createElement('strong');
    process.className = 'game-process';
    process.textContent = game.processName;
    const profile = document.createElement('span');
    profile.className = 'game-profile';
    profile.textContent = names.get(game.profileId) || game.profileId;
    description.append(process, profile);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-game';
    remove.textContent = '×';
    remove.title = tr('auto.removeGame', { name: game.processName });
    remove.setAttribute('aria-label', tr('auto.removeGame', { name: game.processName }));
    remove.onclick = async () => {
      try {
        appState.config.games = await bridge.removeGame(game.id);
        renderGames();
      } catch (error) {
        setMessage(error.message);
      }
    };
    row.append(description, remove);
    return row;
  }));
}

function render() {
  if (!appState) return;
  applyTranslations();
  renderProfiles();
  renderKeyboard();
  renderSelectionSettings();
  renderAdvancedControls();
  enforceTurboLightState();
  renderGames();
  $('profileName').textContent = profileDisplayName(currentProfile());
  $('removeProfile').hidden = !activeProfileId.startsWith('custom-');
  $('autoMode').checked = appState.config.autoEnabled;
  $('statusDot').classList.toggle('online', appState.keyboard.connected);
  $('connection').textContent = tr(appState.keyboard.connected ? 'status.connected' : 'status.disconnected');
  const shownProfile = appState.config.profiles.find((p) => p.id === appState.keyboard.currentProfile);
  $('currentProfile').textContent = tr('status.profile', { name: shownProfile ? profileDisplayName(shownProfile) : tr('status.none') });
  renderSettings();
  $('activeProcess').textContent = tr('status.process', { name: appState.auto.lastProcess || tr('status.desktop') });
  if (appState.keyboard.connected && appState.keyboard.lastWriteInfo) {
    const write = appState.keyboard.lastWriteInfo;
    $('deviceError').textContent = tr('status.lastWrite', {
      cmd: write.command.toString(16).padStart(2, '0'),
      len: write.bufferLength,
      written: write.bytesWritten,
      echo: write.echoed === true ? 'OK' : write.echoed === false ? 'NO' : '—',
    });
  } else {
    $('deviceError').textContent = appState.keyboard.error || tr('status.searchingInterface');
  }
}

let lightingSynced = false;
async function refresh() {
  if (marqueeActive) return;
  try {
    appState = await bridge.getStatus();
    if (!appState.config.profiles.some((profile) => profile.id === activeProfileId)) activeProfileId = 'default';
    if (!lightingSynced && appState?.config?.settings) {
      lightingSynced = true;
      const saved = appState.config.settings.lastLighting;
      if (saved?.effect) {
        lightingBrightness = saved.brightness ?? 9;
        lightingSpeed = saved.speed ?? 5;
        if (saved.colour) lightingColourIndex = saved.colour;
        $('lightingBrightness').value = String(lightingBrightness);
        $('brightnessValue').value = String(lightingBrightness);
        paintRange($('lightingBrightness'));
        $('lightingSpeed').value = String(lightingSpeed);
        $('speedValue').value = String(lightingSpeed);
        paintRange($('lightingSpeed'));
        preTurboEffect = saved.effect;
        if (!isTurboModeActive()) setLightingEffect(saved.effect, false);
      }
    }
    render();
  } catch (error) {
    setMessage(tr('status.loadError', { error: error.message }));
  }
}

$('autoMode').onchange = async (event) => {
  try {
    appState.config = await bridge.setAutoEnabled(event.target.checked);
    setMessage();
  } catch (error) {
    setMessage(error.message);
  }
};

$('profileForm').onsubmit = async (event) => {
  event.preventDefault();
  try {
    appState.config = await bridge.addProfile($('newProfileName').value);
    activeProfileId = appState.config.profiles.at(-1).id;
    selectedKeys.clear();
    $('newProfileName').value = '';
    render();
    setMessage(tr('main.profileCreated'));
  } catch (error) {
    setMessage(error.message);
  }
};

$('removeProfile').onclick = async () => {
  try {
    appState.config = await bridge.removeProfile(activeProfileId);
    activeProfileId = 'default';
    render();
    setMessage(tr('main.profileDeleted'));
  } catch (error) {
    setMessage(error.message);
  }
};

for (const [id, toPatch] of [
  ['rapidTriggerMode', (on) => ({ rapidTrigger: on })],
  ['releaseDualTrigger', (on) => ({ rdt_open: on })],
  ['lastWinMode', (on) => ({ lw_open: on, lastWinMode: on })],
  ['turboMode', (on) => ({ turboMode: on })],
  ['keystrokeTracking', (on) => ({ keystrokeTracking: on })],
]) {
  $(id).onchange = async (event) => {
    const checked = event.target.checked;
    if (id === 'turboMode') return toggleTurboMode(checked);
    try {
      appState.config = await bridge.updateProfileFeatures(activeProfileId, toPatch(checked));
      if (id === 'keystrokeTracking') await bridge.setKeyTracking(checked);
      renderAdvancedControls();
      setMessage(tr('main.prefSaved'));
    } catch (error) {
      setMessage(error.message);
    }
  };
}

// Turbo Mode: la interfaz solo pide el estado final; el proceso principal lo aplica en la cola HID (coalesciendo clics rápidos).
let turboUiSeq = 0;
async function toggleTurboMode(checked) {
  const seq = ++turboUiSeq;
  turboTransitionPending = true;
  if (checked && lightingEffect !== 'turbo') preTurboEffect = lightingEffect || 'off';
  try {
    const config = await bridge.setTurboMode(activeProfileId, checked);
    if (seq !== turboUiSeq) return; // hay un clic más reciente: él manda
    appState.config = config;
    resetTurboProtection();
    if (checked) {
      await setLightingEffect('turbo', false);
      $('colorStatus').textContent = tr('colour.turboOnStatus');
    } else {
      const savedEffect = appState?.config?.settings?.lastLighting?.effect;
      const restoreTo = (preTurboEffect && preTurboEffect !== 'turbo') ? preTurboEffect : (savedEffect || 'custom');
      await setLightingEffect(restoreTo, false);
      $('colorStatus').textContent = tr('colour.turboOffStatus', { title: $('lightingTitle').textContent });
    }
    renderAdvancedControls();
    setMessage(tr('main.prefSaved'));
  } catch (error) {
    setMessage(cleanError(error));
  } finally {
    if (seq === turboUiSeq) turboTransitionPending = false;
  }
}

$('dualAdd').onclick = () => {
  const codes = [...selectedKeys];
  if (codes.length !== 2) return setMessage(tr('main.dualNeedTwo'));
  const [mainKey, triggerKey] = codes.map(keyRef);
  const usedDual = new Set(dualGroups().flatMap((g) => [g.mainKey.keyname, g.triggerKey.keyname]));
  if ([mainKey, triggerKey].some((k) => usedDual.has(k.keyname))) return setMessage(tr('main.dualAlreadyUsed'));
  return saveRtp({
    rdt_rtpSettings: [...dualGroups(), { mainKey, triggerKey, x2Active: 1.5, x2Reset: 0.1, isRdtEnabled: true }],
  }, tr('main.groupAdded'));
};

$('lastWinAdd').onclick = () => {
  const codes = [...selectedKeys];
  if (codes.length !== 2) return setMessage(tr('main.lwNeedTwo'));
  const usedLw = new Set(lastWinGroups().flatMap((g) => g.keys.map((k) => k.keyname)));
  if (codes.some((code) => usedLw.has(officialKeyName(code)))) return setMessage(tr('main.lwAlreadyUsed'));
  return saveRtp({ lastWinGroups: [...lastWinGroups(), { keys: codes.map(keyRef) }] }, tr('main.groupAdded'));
};

// Cada slider es independiente: su valor, su relleno y su marca de "modificado" no dependen de los demás.
// Press to activate y Release Reset comparten rango fijo (0.1–3.3 mm) sea cual sea el punto de actuación.
for (const id of ['downstroke', 'upstroke']) Object.assign($(id), SENSITIVITY_RANGE);
for (const { id } of KEY_SLIDERS) {
  const slider = $(id);
  slider.oninput = () => {
    changedSliders.add(id);
    refreshSlider(id);
    if (id === 'actionPoint') applySensitivityLimits(true); // el máximo de bajada depende de la actuación
  };
  // Pulsar el slider también cuenta como elegir su valor (permite fijar justo el valor que muestra por defecto).
  slider.onpointerdown = () => changedSliders.add(id);
}

$('importProfile').onclick = async () => {
  try {
    const result = await bridge.importProfile();
    if (result.canceled) return;
    appState.config = result.config;
    activeProfileId = appState.config.profiles.at(-1).id;
    selectedKeys.clear();
    render();
    setMessage(tr('editor.imported'));
  } catch (error) {
    setMessage(tr('editor.importErr', { error: error.message }));
  }
};

$('exportProfile').onclick = async () => {
  try {
    const result = await bridge.exportProfile(activeProfileId);
    if (!result.canceled) setMessage(tr('editor.exported'));
  } catch (error) {
    setMessage(tr('editor.exportErr', { error: error.message }));
  }
};

$('selectWasd').onclick = () => {
  selectedKeys.clear();
  ['KeyW', 'KeyA', 'KeyS', 'KeyD'].forEach((key) => selectedKeys.add(key));
  renderKeyboard();
  renderSelectionSettings();
};

$('selectAll').onclick = () => {
  selectedKeys.clear();
  keyRows.flat().filter(([code]) => code !== 'gap').forEach(([code]) => selectedKeys.add(code));
  renderKeyboard();
  renderSelectionSettings();
};

$('clearSelection').onclick = () => {
  selectedKeys.clear();
  renderKeyboard();
  renderSelectionSettings();
};

$('saveKeys').onclick = async () => {
  if (!selectedKeys.size) return setMessage(tr('editor.needKey'));
  try {
    const settings = {};
    // Bajada y subida se escriben siempre juntas (0 = Rapid Trigger apagado: no se activa por accidente con solo una).
    const touched = new Set(changedSliders);
    const rtp = currentProfile();
    if (!rtp?.features.rapidTrigger || rtp.rtp.rdt_open) { touched.delete('downstroke'); touched.delete('upstroke'); }
    if (touched.has('downstroke') || touched.has('upstroke')) { touched.add('downstroke'); touched.add('upstroke'); }
    for (const { id, setting } of KEY_SLIDERS) {
      if (touched.has(id)) settings[setting] = Number($(id).value);
    }
    if (!Object.keys(settings).length) return setMessage(tr('editor.needSlider'));
    const allNames = [...selectedKeys].map((code) => officialKeyName(code));
    if (allNames.some((keyname) => !keyname)) {
      throw new Error(tr('editor.invalidKey'));
    }
    const selectedKeyNames = allNames.filter((keyname) => !UNMAPPED_KEYS.has(keyname));
    const skipped = allNames.filter((keyname) => UNMAPPED_KEYS.has(keyname));
    if (!selectedKeyNames.length) throw new Error(tr('editor.unmappedOnly'));
    appState.config = await bridge.updateKeys(activeProfileId, selectedKeyNames, settings);
    changedSliders.clear();
    renderKeyboard();
    const note = skipped.length ? tr('editor.skippedNote', { keys: skipped.join(', ') }) : '';
    try {
      const result = await bridge.applyProfile(activeProfileId);
      appState.keyboard = result.keyboard;
      appState.config = result.config;
      const echoed = result.keyboard?.lastWriteInfo?.echoed;
      const echoMsg = echoed === false ? tr('editor.echoNo') : echoed ? tr('editor.echoOk') : '';
      setMessage(tr('editor.savedOk', { echo: echoMsg, note }));
    } catch (error) {
      setMessage(tr('editor.savedLocalErr', { error: error.message, note }));
    }
  } catch (error) {
    setMessage(error.message);
  }
};

$('applyProfile').onclick = async () => {
  try {
    const result = await bridge.applyProfile(activeProfileId);
    appState.keyboard = result.keyboard;
    appState.config = result.config;
    render();
    setMessage(tr('editor.appliedNote'));
  } catch (error) {
    setMessage(error.message);
  }
};

$('gameForm').onsubmit = async (event) => {
  event.preventDefault();
  try {
    appState.config.games = await bridge.addGame($('processName').value, $('gameProfile').value);
    $('processName').value = '';
    renderGames();
    setMessage(tr('auto.added'));
  } catch (error) {
    setMessage(error.message);
  }
};

$('mainTab').onclick = () => showView('main');
$('colourTab').onclick = () => showView('colour');
$('remapTab').onclick = () => showView('remap');

document.querySelectorAll('.lighting-effect').forEach((button) => {
  button.onclick = () => setLightingEffect(button.dataset.effect, true);
});

document.querySelectorAll('.color-swatch').forEach((button) => {
  button.onclick = () => setLightingColor(button.dataset.color, button);
});

$('customColor').oninput = (event) => setLightingColor(event.target.value);
$('lightingBrightness').oninput = (event) => {
  lightingBrightness = Number(event.target.value);
  $('brightnessValue').value = String(lightingBrightness);
  paintRange(event.target);
  renderColorKeyboard();
  scheduleBrightnessSend();
};
$('lightingSpeed').oninput = (event) => {
  lightingSpeed = Number(event.target.value);
  $('speedValue').value = String(lightingSpeed);
  paintRange(event.target);
  scheduleBrightnessSend();
};

$('selectAllColorKeys').onclick = () => {
  colorAllKeys = true;
  colorSelectedKeys.clear();
  updateColorSelection();
  renderColorKeyboard();
};
$('clearColorKeys').onclick = () => {
  colorAllKeys = false;
  colorSelectedKeys.clear();
  updateColorSelection();
  renderColorKeyboard();
};

document.querySelectorAll('.remap-layer').forEach((button) => {
  button.onclick = () => setRemapLayer(button.dataset.layer);
});

$('clearRemap').onclick = () => {
  const assignments = remapAssignments[activeRemapLayer];
  if (remapSelectedKeys.size) {
    for (const key of remapSelectedKeys) assignments.delete(key);
    $('remapStatus').textContent = tr('remap.clearedSelected', { n: remapSelectedKeys.size });
  } else {
    for (const map of Object.values(remapAssignments)) map.clear();
    $('remapStatus').textContent = tr('remap.clearedAll');
  }
  renderRemapKeyboard();
};

attachMarquee('keyboardViewport', 'keyboard', {
  getSelection: () => selectedKeys,
  selectedClass: 'selected',
  apply: (codes) => {
    selectedKeys.clear();
    codes.forEach((code) => selectedKeys.add(code));
    syncSelectionClasses('keyboard', selectedKeys, 'selected');
    updateMainKeySelection();
  },
  toggle: (code) => {
    if (selectedKeys.has(code)) selectedKeys.delete(code);
    else selectedKeys.add(code);
    syncSelectionClasses('keyboard', selectedKeys, 'selected');
    updateMainKeySelection();
  },
});

attachMarquee('colorViewport', 'colorKeyboard', {
  getSelection: () => (colorAllKeys ? new Set(allKeyCodes()) : colorSelectedKeys),
  selectedClass: 'color-selected',
  apply: (codes) => {
    colorAllKeys = false;
    colorSelectedKeys.clear();
    codes.forEach((code) => colorSelectedKeys.add(code));
    updateColorSelection();
    renderColorKeyboard();
  },
  toggle: toggleColorKey,
});

attachMarquee('remapViewport', 'remapKeyboard', {
  getSelection: () => remapSelectedKeys,
  selectedClass: 'drag-selected',
  apply: (codes) => {
    remapSelectedKeys.clear();
    codes.forEach((code) => remapSelectedKeys.add(code));
    syncSelectionClasses('remapKeyboard', remapSelectedKeys, 'drag-selected');
    updateRemapSelectionCount();
  },
  toggle: (code) => setRemapKeySelected(code, !remapSelectedKeys.has(code)),
});

// Keystroke tracking: lista de teclas con la hora del PC (HH:MM:SS.d), como el software oficial. Solo con el foco en esta ventana.
const TRACK_MAX = 60;
function trackTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${Math.floor(date.getMilliseconds() / 100)}`;
}
function trackEvent(event, type) {
  if (!$('keystrokeTracking').checked || (type === 'keydown' && event.repeat)) return;
  const name = event.key === ' ' ? 'SPACE' : event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase();
  const row = document.createElement('li');
  const key = document.createElement('span');
  key.className = 'tk'; key.textContent = name;
  const kind = document.createElement('span');
  kind.textContent = type;
  const time = document.createElement('time');
  const now = new Date();
  time.dateTime = now.toISOString(); time.textContent = trackTime(now);
  row.append(key, kind, time);
  const log = $('trackLog');
  log.prepend(row);
  while (log.children.length > TRACK_MAX) log.lastElementChild.remove();
}
window.addEventListener('keydown', (event) => trackEvent(event, 'keydown'), true);
window.addEventListener('keyup', (event) => trackEvent(event, 'keyup'), true);
function syncTrackPanel() {
  const on = $('keystrokeTracking').checked;
  $('trackPanel').hidden = !on;
  if (!on) $('trackLog').replaceChildren();
}
$('keystrokeTracking').addEventListener('change', syncTrackPanel);

document.querySelectorAll('input[type="range"]').forEach(paintRange);
renderRemapActionGroups();
setLightingEffect('off');
$('lightingSpeed').value = '5';

if (!bridge) {
  setMessage(tr('status.requireElectron'));
} else {
  refresh();
  setInterval(refresh, 2000);
  setInterval(enforceTurboLightState, 800);
}

function renderColorKeyboard() {
  let keyIndex = 0;
  $('colorKeyboard').replaceChildren(...keyRows.map((row) => {
    const rowElement = document.createElement('div');
    rowElement.className = 'key-row';
    for (const [code, label, width] of row) {
      if (code === 'gap') {
        const gap = document.createElement('span');
        gap.className = 'key-gap';
        rowElement.append(gap);
        continue;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key color-key';
      button.style.setProperty('--width', width);
      button.textContent = label;
      button.title = code;
      button.dataset.keyCode = code;
      const isSelected = colorAllKeys || colorSelectedKeys.has(code);
      button.classList.toggle('color-selected', !colorAllKeys && isSelected);
      if (lightingEffect !== 'off' && COLOR_EFFECTS.has(lightingEffect) && isSelected) {
        const perKey = lightingEffect === 'custom' || lightingEffect === 'turbo';
        const activeMap = lightingEffect === 'turbo' ? turboCustomColors : customColors;
        const color = perKey
          ? (activeMap.get(code) || (lightingEffect === 'turbo' ? (code === 'KeyW' ? '#ff0000' : '#ffffff') : '#ffffff'))
          : lightingColor;
        button.classList.add('lit');
        button.style.setProperty('--key-light', color);
        button.style.boxShadow = `0 0 ${3 + lightingBrightness}px ${color}bb, inset 0 0 ${Math.round(lightingBrightness / 2)}px ${color}44`;
      }
      button.onclick = (event) => {
        if (event.detail === 0) toggleColorKey(code);
      };
      rowElement.append(button);
      keyIndex += 1;
    }
    return rowElement;
  }));
  updateColorSelection();
}

function updateColorSelection() {
  const selectedCount = colorAllKeys ? keyRows.flat().filter(([code]) => code !== 'gap').length : colorSelectedKeys.size;
  $('colorSelectionCount').textContent = colorAllKeys
    ? tr('colour.allKeys')
    : selectedCount === 0
      ? tr('editor.noneSelected')
      : selectedCount === 1
        ? tr('editor.oneSelected')
        : tr('editor.manySelected', { n: selectedCount });
  $('selectAllColorKeys').classList.toggle('active', colorAllKeys);
}

function toggleColorKey(code) {
  if (colorAllKeys) {
    colorAllKeys = false;
    allKeyCodes().forEach((keyCode) => colorSelectedKeys.add(keyCode));
  }
  if (colorSelectedKeys.has(code)) colorSelectedKeys.delete(code);
  else colorSelectedKeys.add(code);
  updateColorSelection();
  renderColorKeyboard();
}

async function setLightingEffect(effect, userInitiated = false) {
  const targetButton = document.querySelector(`.lighting-effect[data-effect="${effect}"]`);
  const targetLabel = targetButton?.textContent || effect;

  if (userInitiated && isTurboModeActive() && effect !== 'turbo') {
    // Turbo Mode activo: el teclado exige seguir en «Turbo mode light». 3 pulsaciones seguidas en el mismo efecto
    // desactivan Turbo Mode (limpiamente, desde el proceso principal) y entonces sí se aplica el efecto elegido.
    if (turboProtectionTarget === effect) turboProtectionClicks += 1;
    else { turboProtectionTarget = effect; turboProtectionClicks = 1; }

    if (turboProtectionClicks < 3) {
      showTurboBanner(tr('colour.turboProtectClicks', { count: turboProtectionClicks, label: targetLabel }));
      return;
    }

    resetTurboProtection();
    preTurboEffect = effect;
    turboTransitionPending = true;
    const seq = ++turboUiSeq;
    try {
      const config = await bridge.setTurboMode(activeProfileId, false); // espera a que el teclado salga de Turbo
      if (seq !== turboUiSeq) return;
      appState.config = config;
      renderAdvancedControls();
    } catch (error) {
      setMessage(cleanError(error));
      return;
    } finally {
      if (seq === turboUiSeq) turboTransitionPending = false;
    }
    showTurboBanner(tr('colour.turboProtectOff', { label: targetLabel }), 4000);
    applyLightingEffectUi(effect, targetLabel);
    scheduleBrightnessSend({ customMessage: tr('colour.turboProtectMsg', { label: targetLabel }) });
    return;
  }

  if (userInitiated && effect === 'turbo' && !isTurboModeActive()) {
    // Pulsar «Turbo mode light» NO activa Turbo Mode: es Turbo Mode (pestaña Main) quien activa esa luz.
    $('colorStatus').textContent = tr('colour.turboOnlyMain');
    return;
  }

  if (userInitiated && effect === 'turbo') resetTurboProtection();
  if (effect !== 'turbo') preTurboEffect = effect;
  applyLightingEffectUi(effect, targetLabel);
  if (userInitiated) scheduleBrightnessSend();
}

function applyLightingEffectUi(effect, targetLabel) {
  lightingEffect = effect;
  document.querySelectorAll('.lighting-effect').forEach((button) => {
    button.classList.toggle('active', button.dataset.effect === effect);
  });
  $('lightingTitle').textContent = targetLabel;
  updateLightingControlsVisibility(effect);
  renderColorKeyboard();
}

function updateLightingControlsVisibility(effect) {
  // [color, brillo, velocidad] según las marcas de la captura de Colour (los efectos sin marca se suponen brillo + velocidad).
  const controls = {
    off: [false, false, false], turbo: [true, true, false], custom: [true, true, false],
    marquee: [false, true, true], always: [true, true, false], spectrum: [false, true, true], breath: [true, true, true],
    lightByPress: [true, true, false], stars: [false, true, true], waveSpectrum: [true, true, true],
    centerSurfing: [false, true, true], surfingDown: [false, true, true], ripple: [true, true, true],
    glowingFish: [false, true, true], colorfulFountain: [false, true, true], traffic: [false, true, true],
    gluttonousSnake: [false, true, true], repeatSurfing: [false, true, true], surfingCross: [false, true, true],
    laserKey: [true, true, true], randomFountain: [false, true, true],
  }[effect] || [false, false, false];
  $('colorControls').hidden = !controls[0];
  $('brightnessControl').hidden = !controls[1];
  $('speedControl').hidden = !controls[2];
  // Los efectos usan la paleta fija de 7 colores; Custom/Turbo permiten cualquier RGB por tecla.
  $('customColor').hidden = !(effect === 'custom' || effect === 'turbo');
}

function setLightingColor(color, swatch = null) {
  lightingColor = color;
  $('customColor').value = color;
  $('colorHex').value = color.toUpperCase();
  document.querySelectorAll('.color-swatch').forEach((button) => {
    button.classList.toggle('active', button.dataset.color.toLowerCase() === color.toLowerCase());
  });
  if (swatch?.dataset.index) lightingColourIndex = Number(swatch.dataset.index);
  if (lightingEffect === 'custom' || lightingEffect === 'turbo') {
    const targets = colorAllKeys ? allKeyCodes() : [...colorSelectedKeys];
    const activeMap = lightingEffect === 'turbo' ? turboCustomColors : customColors;
    targets.forEach((code) => activeMap.set(code, color));
  }
  renderColorKeyboard();
  scheduleBrightnessSend();
}


// ───────── Renombrar perfil (clic derecho) ─────────
function startProfileRename(button, profile) {
  const input = document.createElement('input');
  input.className = 'profile-rename';
  input.value = profile.name;
  input.maxLength = 32;
  input.setAttribute('aria-label', tr('main.renameAria'));
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (commit && name && name !== profile.name) {
      try { appState.config = await bridge.renameProfile(profile.id, name); setMessage(tr('main.profileRenamed')); }
      catch (error) { setMessage(cleanError(error)); }
    }
    render();
  };
  input.onkeydown = (event) => {
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
  button.replaceWith(input);
  input.focus();
  input.select();
}

// ───────── Ajustes (menú ⚙) y temas ─────────
function applyTheme(theme) { document.documentElement.dataset.theme = theme || 'blue'; }
function renderSettings() {
  const s = appState?.config?.settings;
  if (!s) return;
  applyTheme(s.theme);
  $('setLaunchAtLogin').checked = s.launchAtLogin;
  $('setCloseToBackground').checked = s.closeToBackground;
  $('setResetOnExit').checked = s.resetOnExit;
  $('setKeepLast').checked = s.keepLastProfile;
  $('keepLastRow').hidden = s.resetOnExit; // solo se pregunta si NO se revierte al estándar
  $('languageSelect').value = s.language || 'auto';
  $('themeSelect').value = s.theme;
}
async function saveSetting(patch) {
  try { appState.config = await bridge.setSettings(patch); renderSettings(); }
  catch (error) { setMessage(cleanError(error)); renderSettings(); }
}
$('settingsBtn').onclick = (event) => {
  event.stopPropagation();
  const menu = $('settingsMenu');
  menu.hidden = !menu.hidden;
  $('settingsBtn').setAttribute('aria-expanded', String(!menu.hidden));
};
document.addEventListener('click', (event) => {
  if (!$('settingsMenu').hidden && !event.target.closest('.settings-wrap')) { $('settingsMenu').hidden = true; $('settingsBtn').setAttribute('aria-expanded', 'false'); }
});
$('setLaunchAtLogin').onchange = (e) => saveSetting({ launchAtLogin: e.target.checked });
$('setCloseToBackground').onchange = (e) => saveSetting({ closeToBackground: e.target.checked });
$('setResetOnExit').onchange = (e) => saveSetting({ resetOnExit: e.target.checked });
$('setKeepLast').onchange = (e) => saveSetting({ keepLastProfile: e.target.checked });
$('languageSelect').onchange = (e) => {
  if (appState?.config?.settings) appState.config.settings.language = e.target.value;
  render();
  saveSetting({ language: e.target.value });
};
$('themeSelect').onchange = (e) => { applyTheme(e.target.value); saveSetting({ theme: e.target.value }); };
// Icono del botón: public/icons/settings.svg (si no existe se queda el ⚙)
{
  const probe = new Image();
  probe.onload = () => {
    const glyph = document.createElement('span');
    glyph.className = 'remap-icon';
    glyph.style.setProperty('--icon', 'url("icons/settings.svg")');
    $('settingsBtn').replaceChildren(glyph);
  };
  probe.src = 'icons/settings.svg';
}

// La interfaz entera se escala con el tamaño de la ventana (se rellena la pantalla, no solo el fondo).
function fitToWindow() {
  const zoom = Math.min(2.2, Math.max(1, window.innerWidth / 1280));
  document.body.style.zoom = String(zoom);
  document.documentElement.style.setProperty('--z', String(zoom));
}
window.addEventListener('resize', fitToWindow);
fitToWindow();

const cleanError = (error) => error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Colour: efecto, brillo, velocidad y color se envían al teclado (capturas Colours). Custom/Turbo mandan 82 teclas en 7 tramas.
let brightnessTimer = null;
function scheduleBrightnessSend(options = {}) {
  if (!bridge || (lightingEffect === 'off' && !appState)) return;
  const { customMessage = null } = options;
  clearTimeout(brightnessTimer);
  brightnessTimer = setTimeout(async () => {
    try {
      if (lightingEffect === 'custom' || lightingEffect === 'turbo') {
        const isTurbo = lightingEffect === 'turbo';
        const activeMap = isTurbo ? turboCustomColors : customColors;
        const colors = allKeyCodes().map((code) => [
          code,
          activeMap.get(code) || (isTurbo && code === 'KeyW' ? '#ff0000' : '#ffffff'),
        ]);
        await bridge.setCustomLight({ colors, turbo: isTurbo, brightness: lightingBrightness });
      } else if (lightingEffect === 'off') {
        await bridge.setEffect({ effect: 'off', brightness: lightingBrightness, speed: lightingSpeed, colour: 0 });
      } else {
        await bridge.setEffect({ effect: lightingEffect, brightness: lightingBrightness, speed: lightingSpeed, colour: lightingColourIndex });
      }
      $('colorStatus').textContent = customMessage || tr('colour.sent', { title: $('lightingTitle').textContent });
    } catch (error) {
      $('colorStatus').textContent = tr('colour.sendErr', { error: cleanError(error) });
    }
  }, 150);
}

// Remap: como el software oficial, envía SIEMPRE las 3 capas (Default, Fn, Fn2 = 42 bloques). Lo no asignado vuelve al estado de reset.
$('applyRemap').onclick = async () => {
  const status = $('remapStatus');
  if (!bridge) return;
  status.textContent = tr('remap.sending');
  try {
    const layers = Object.fromEntries(Object.entries(remapAssignments).map(([layer, map]) => [layer, [...map]]));
    const profileId = $('remapBind').checked ? $('remapBindProfile').value : null;
    const result = await bridge.applyRemap(layers, profileId);
    if (result.config) appState.config = result.config;
    const derived = result.derived.length ? tr('remap.derivedNote', { n: result.derived.length, list: result.derived.join(', ') }) : '';
    const target = profileId
      ? tr('remap.savedProfile', { name: profileDisplayName(appState.config.profiles.find((p) => p.id === profileId)) })
      : tr('remap.savedGlobal');
    status.textContent = result.sentNow
      ? tr('remap.appliedNow', { target, frames: result.frames, derived })
      : tr('remap.savedDeferred', { target, derived });
    renderProfiles();
    renderRemapBind(); // el ● del desplegable de perfiles también se actualiza
    await loadRemapEditor(); // muestra lo realmente guardado (sin asignaciones que equivalen a las de fábrica)
  } catch (error) {
    status.textContent = tr('remap.applyErr', { error: cleanError(error) });
  }
};

// Carga en el editor el remap guardado (global o de un perfil).
async function loadRemapEditor() {
  if (!bridge) return;
  const bound = $('remapBind').checked;
  const profileId = bound ? $('remapBindProfile').value : null;
  const saved = await bridge.loadRemap(profileId);
  for (const layer of Object.keys(remapAssignments)) {
    remapAssignments[layer] = new Map((saved && saved[layer]) || []);
  }
  remapSelectedKeys.clear();
  renderRemapKeyboard();
}

function renderRemapBind() {
  if (!appState) return;
  const select = $('remapBindProfile');
  const previous = select.value || activeProfileId;
  select.replaceChildren(...appState.config.profiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profileDisplayName(profile) + (profile.remap ? ' ●' : '');
    return option;
  }));
  select.value = appState.config.profiles.some((p) => p.id === previous) ? previous : 'default';
  select.hidden = !$('remapBind').checked;
}
$('remapBind').onchange = () => { renderRemapBind(); loadRemapEditor(); };
$('remapBindProfile').onchange = loadRemapEditor;

function showView(view) {
  const views = { main: 'managerView', colour: 'colourView', remap: 'remapView' };
  for (const [name, id] of Object.entries(views)) $(id).hidden = name !== view;
  for (const [name, id] of [['colour', 'colourTab'], ['main', 'mainTab'], ['remap', 'remapTab']]) {
    $(id).classList.toggle('active', name === view);
    $(id).setAttribute('aria-pressed', String(name === view));
  }
  if (view === 'colour') renderColorKeyboard();
  if (view === 'remap') { renderRemapBind(); loadRemapEditor(); }
}