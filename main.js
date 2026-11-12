'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, session } = require('electron');
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const keyboard = require('./src/keyboard');
const autoMode = require('./src/autoMode');
const configStore = require('./src/configStore');
const protocol = require('./src/protocol');
const remap = require('./src/remap');
const i18n = require('./public/i18n');

let mainWindow = null;
let tray = null;
let quitting = false;
let shutdownStarted = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const currentLang = () => i18n.resolveLang(configStore.getConfig().settings?.language, app.getLocale());
const tr = (key, vars) => i18n.t(currentLang(), key, vars);

app.setName('DrunkBetter Profile Manager');
app.setAppUserModelId('com.drunkbetter.profilemanager');

// Evita el aviso de Windows/Chromium («permitir acceso a la red local / abrir aplicaciones»): se desactiva el descubrimiento
// de dispositivos de Chromium (Media Router/DIAL, que abre sockets SSDP) y se rechaza cualquier petición de permisos.
app.commandLine.appendSwitch('disable-features', 'MediaRouter,DialMediaRouteProvider,LocalNetworkAccessChecks,PrivateNetworkAccessPermissionPrompt');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

// Los cambios de tecla y modos de rendimiento (Rapid Trigger, Last Win, Dual-Trigger, Turbo)
// se envían al teclado en cuanto el usuario los modifica en la interfaz. Debounce para no inundar el HID al mover sliders.
let reapplyTimer = null;
function scheduleReapply(profileId) {
  clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => {
    keyboard.applyProfile(profileId, true).catch((error) => console.error('No se pudo reenviar el perfil:', error.message));
  }, 200);
}

function registerIpcHandlers() {
  ipcMain.handle('app:status', () => ({
    keyboard: keyboard.getStatus(),
    auto: autoMode.getStatus(),
    config: configStore.getConfig(),
    locale: app.getLocale(),
  }));

  ipcMain.handle('profile:apply', async (_event, profileId) => {
    if (!configStore.getConfig().profiles.some((profile) => profile.id === profileId)) {
      throw new Error('Perfil desconocido');
    }
    clearTimeout(reapplyTimer);
    // No desactivamos autoMode al aplicar un perfil o guardar teclas: si el usuario activó
    // la detección automática, debe permanecer guardada siempre hasta que él la apague.
    configStore.updateSettings({ manualProfileId: profileId });
    await keyboard.applyProfile(profileId, true);
    return { keyboard: keyboard.getStatus(), config: configStore.getConfig() };
  });

  ipcMain.handle('auto:set', (_event, enabled) => {
    autoMode.setEnabled(enabled);
    return configStore.getConfig();
  });

  ipcMain.handle('profiles:add', (_event, name) => configStore.addProfile(name));

  ipcMain.handle('profiles:remove', async (_event, profileId) => {
    const config = configStore.removeProfile(profileId);
    if (keyboard.getStatus().currentProfile === profileId) {
      await keyboard.applyProfile('default', true);
    }
    return config;
  });

  ipcMain.handle('profile:features', (_event, { profileId, features }) => {
    const config = configStore.updateProfileFeatures(profileId, features);
    // Turbo, Rapid Trigger, Last Win, Dual-Trigger… forman parte del perfil y se aplican inmediatamente al teclado.
    // Turbo Mode NO pasa por aquí: tiene su propio canal serializado (turbo:set) para no dejar el teclado pillado.
    const relevant = ['rapidTrigger', 'lw_open', 'rdt_open', 'lastWinGroups', 'rdt_rtpSettings'];
    if (features && relevant.some((field) => features[field] !== undefined)) {
      configStore.updateSettings({ manualProfileId: profileId });
      scheduleReapply(profileId);
    }
    return configStore.getConfig();
  });

  ipcMain.handle('profile:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: tr('dialog.importTitle'),
      properties: ['openFile'],
      filters: [{ name: tr('dialog.jsonFilter'), extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const imported = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    return { canceled: false, config: configStore.importOfficialProfile(imported) };
  });

  ipcMain.handle('profile:export', async (_event, profileId) => {
    const officialProfile = configStore.exportOfficialProfile(profileId);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: tr('dialog.exportTitle'),
      defaultPath: `${officialProfile.storagename}.json`,
      filters: [{ name: tr('dialog.jsonFilter'), extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, `${JSON.stringify(officialProfile, null, 2)}\n`, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('keys:update', (_event, { profileId, keys, settings }) => {
    if (!Array.isArray(keys) || keys.length > 100 || !settings || typeof settings !== 'object') {
      throw new Error('La selección de teclas no es válida');
    }
    const config = configStore.updateKeySettingsBatch(profileId, keys, settings);
    scheduleReapply(profileId);
    return config;
  });

  // Colour: solo el brillo (ae 01 00 00 02 05 <nivel>) tiene trama capturada.
  ipcMain.handle('lighting:brightness', async (_event, level) => {
    await keyboard.sendRaw([protocol.buildBrightnessFrame(level)], 'brillo');
    return keyboard.getStatus();
  });

  // Remap: valida TODO antes de guardar/escribir. Con profileId se asocia a ese perfil (se reaplica cada vez que se
  // active, a mano o por detección automática); sin él es el remap global, que se restaura al salir de un perfil con remap propio.
  ipcMain.handle('remap:apply', async (_event, { layers: rawLayers, profileId }) => {
    remap.build(rawLayers); // lanza error si algo no es seguro
    // Lo que queda igual que de fábrica no cuenta como remap: si no queda nada, el perfil vuelve a «sin remap» (sin ●).
    const layers = remap.stripDefaults(rawLayers);
    const built = remap.build(layers);
    if (profileId) {
      if (!configStore.getConfig().profiles.some((profile) => profile.id === profileId)) throw new Error('Perfil desconocido');
      configStore.setProfileRemap(profileId, layers);
    } else {
      configStore.setBaseRemap(layers);
    }
    const status = keyboard.getStatus();
    const affectsNow = !profileId || status.currentProfile === profileId || !status.currentProfile;
    let frames = 0;
    if (affectsNow && status.connected) {
      const sent = await keyboard.refreshRemap();
      frames = sent ? sent.frames : 0;
    }
    return { frames, derived: built.derived, stored: true, sentNow: frames > 0, config: configStore.getConfig() };
  });

  ipcMain.handle('remap:load', (_event, profileId) => {
    const config = configStore.getConfig();
    if (!profileId) return config.baseRemap;
    return config.profiles.find((profile) => profile.id === profileId)?.remap || null;
  });

  // Rendimiento: Turbo (b5 00 1e 01 …) y Keystroke Tracking (b6 03 <0|1>)
  // Turbo Mode: un único punto de entrada. Guarda en config y aplica el estado FINAL al teclado dentro de la cola HID.
  // Si llegan varias órdenes seguidas (activar/desactivar rápido) solo la última se envía, así nunca queda a medias.
  let turboSeq = 0;
  ipcMain.handle('turbo:set', async (_event, { profileId, on }) => {
    if (!configStore.getConfig().profiles.some((profile) => profile.id === profileId)) throw new Error('Perfil desconocido');
    const seq = ++turboSeq;
    configStore.updateProfileFeatures(profileId, { turboMode: Boolean(on) });
    configStore.updateSettings({ manualProfileId: profileId });
    await sleep(150);
    if (seq !== turboSeq) return configStore.getConfig(); // ya hay una orden más reciente: esa será la que se aplique
    clearTimeout(reapplyTimer);
    try {
      await keyboard.applyTurbo(profileId);
    } catch (error) {
      console.error('No se pudo aplicar Turbo Mode:', error.message);
    }
    return configStore.getConfig();
  });
  ipcMain.handle('perf:tracking', (_event, on) => keyboard.sendRaw([protocol.buildKeyTrackingFrame(Boolean(on))], 'tracking'));


  // Renombrar perfil (clic derecho)
  ipcMain.handle('profiles:rename', (_event, { profileId, name }) => configStore.renameProfile(profileId, name));

  // Ajustes de la app
  ipcMain.handle('settings:set', async (_event, patch) => {
    const before = configStore.getConfig().settings;
    if (patch.launchAtLogin === true && !before.launchAtLogin) {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [tr('dialog.loginYesBg'), tr('dialog.loginNoWin')],
        defaultId: 0,
        cancelId: 1,
        message: tr('dialog.loginMsg'),
        detail: tr('dialog.loginDetail'),
      });
      patch.startHidden = answer.response === 0;
    }
    if (patch.launchAtLogin === false) patch.startHidden = false;
    const config = configStore.updateSettings(patch);
    applyLoginItem(config.settings);
    updateTrayMenu();
    return config;
  });

  // Iluminación por efecto (ae 01 00 00 <efecto> <vel> <brillo> <color>) y Custom light (7 tramas por teclas).
  // Turbo Mode / Turbo mode light NO se tocan aquí: los gestiona turbo:set de forma serializada.
  const turboOn = () => {
    const cfgData = configStore.getConfig();
    const currentId = keyboard.getStatus().currentProfile || cfgData.settings?.manualProfileId || 'default';
    return Boolean(cfgData.profiles.find((p) => p.id === currentId)?.features?.turboMode);
  };

  ipcMain.handle('lighting:effect', async (_event, params) => {
    // Con Turbo Mode activo el teclado exige seguir en Turbo mode light: no se manda ningún otro efecto.
    if (turboOn()) return keyboard.getStatus();
    const cfgData = configStore.getConfig();
    const currentId = keyboard.getStatus().currentProfile || cfgData.settings?.manualProfileId || 'default';
    const activeProf = cfgData.profiles.find((p) => p.id === currentId);
    const frames = [];

    if (params.effect === 'off') {
      // Captura oficial drunkdeer_capture_Colours_lightning_turn_off.json:
      // b5 -> b6 03 00 -> ae 01 00 00 00 <speed> <brightness> 00 -> a0 02
      frames.push(keyboard.performanceFrame(activeProf || { features: {} }));
      frames.push(protocol.buildKeyTrackingFrame(Boolean(activeProf?.features?.keystrokeTracking)));
      frames.push(protocol.buildEffectFrame({ effect: 'off', speed: params.speed ?? 5, brightness: params.brightness ?? 9, colour: 0 }));
      const a0 = new Array(protocol.REPORT_LENGTH).fill(0);
      a0.splice(0, 3, protocol.REPORT_ID, 0xa0, 0x02);
      frames.push(a0);
    } else {
      frames.push(protocol.buildEffectFrame(params));
    }

    await keyboard.sendRaw(frames, `efecto ${params.effect}`);
    // Se guarda como «último modo» solo si el envío tuvo éxito: es lo que se restaura al apagar Turbo Mode.
    keyboard.setLastActiveLighting({ effect: params.effect, speed: params.speed ?? 5, brightness: params.brightness ?? 9, colour: params.colour ?? 0 });
    return keyboard.getStatus();
  });

  ipcMain.handle('lighting:custom', async (_event, { colors, turbo, brightness }) => {
    const map = new Map();
    for (const [code, hex] of colors || []) {
      const slot = protocol.remapSlotFor(code, configStore.officialKeyName(code));
      const match = /^#?([0-9a-f]{6})$/i.exec(String(hex));
      if (slot === undefined || !match) continue;
      const value = parseInt(match[1], 16);
      map.set(slot, [(value >> 16) & 255, (value >> 8) & 255, value & 255]);
    }
    const cleanBrightness = Number.isFinite(Number(brightness)) ? Number(brightness) : 9;
    const active = turboOn();
    if (Boolean(turbo) !== active) return keyboard.getStatus(); // «Turbo mode light» solo existe con Turbo Mode activo (y al revés)
    if (active) {
      // Colores de Turbo mode light (caché separada de Custom light) con el Turbo ya activo.
      keyboard.setTurboColorsCache(map, cleanBrightness);
      await keyboard.sendRaw(protocol.buildCustomLightFrames(keyboard.defaultTurboColors(map), { turbo: true, brightness: cleanBrightness }), 'turbo light', { echo: false });
    } else {
      keyboard.setCustomColorsCache(map, cleanBrightness);
      await keyboard.sendRaw(protocol.buildCustomLightFrames(map, { turbo: false, brightness: cleanBrightness }), 'custom light');
      keyboard.setLastActiveLighting({ effect: 'custom', speed: 5, brightness: cleanBrightness, colour: 0 });
    }
    return keyboard.getStatus();
  });

  ipcMain.handle('games:add', (_event, { processName, profileId }) =>
    configStore.addGame(processName, profileId)
  );

  ipcMain.handle('games:remove', (_event, gameId) => configStore.removeGame(gameId));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'DrunkBetter Profile Manager',
    icon: path.join(__dirname, 'public', 'icons', 'icon.ico'),
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#2D1E17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
  mainWindow.on('close', (event) => {
    // La X deja la app en segundo plano (Rapid Trigger, detección automática y remaps siguen activos).
    if (!quitting && configStore.getConfig().settings.closeToBackground) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showWindow() {
  if (!mainWindow) createWindow();
  else { mainWindow.show(); mainWindow.focus(); }
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tr('tray.open'), click: showWindow },
    { label: tr('tray.quit'), click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(path.join(__dirname, 'public', 'icons', 'tray.png'));
  tray = new Tray(image);
  tray.setToolTip('DrunkBetter Profile Manager');
  updateTrayMenu();
  tray.on('click', showWindow);
}

function applyLoginItem(settings) {
  // En modo desarrollo (npm start) NUNCA se registra en el inicio de Windows para no registrar node_modules\electron.exe
  if (!app.isPackaged) return;
  // Si se ejecuta desde una carpeta temporal (por ejemplo la versión portable), tampoco se registra con la ruta efímera
  if (process.execPath.toLowerCase().includes('\\appdata\\local\\temp\\')) return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(settings?.launchAtLogin),
    path: process.execPath,
    args: settings?.startHidden ? ['--hidden'] : [],
  });
}

async function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  autoMode.stop();
  // Al cerrar del todo: por defecto vuelve a "Escritura estándar". Si se desactiva, se queda el último perfil activo
  // (o el último elegido a mano, si "mantener el último perfil" está apagado).
  const { settings } = configStore.getConfig();
  const last = keyboard.getStatus().currentProfile;
  if (settings.resetOnExit) await keyboard.stop({ reset: true, profileId: 'default' });
  else if (settings.keepLastProfile) await keyboard.stop({ reset: false });
  else await keyboard.stop({ reset: true, profileId: settings.manualProfileId || last || 'default' });
  app.exit(0);
}

app.whenReady().then(async () => {
  // Nunca se concede ningún permiso del navegador (red local, notificaciones, etc.): la app solo muestra su propia interfaz.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  configStore.initialize(path.join(app.getPath('userData'), 'config.json'));
  registerIpcHandlers();
  applyLoginItem(configStore.getConfig().settings);
  await keyboard.start();
  autoMode.start();
  createTray();
  if (!process.argv.includes('--hidden')) createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error('No se pudo iniciar DrunkBetter Profile Manager:', error);
  app.quit();
});

app.on('before-quit', (event) => {
  quitting = true;
  if (shutdownStarted) return;
  event.preventDefault();
  shutdown();
});

app.on('window-all-closed', () => {
  // Con la bandeja activa la app sigue en segundo plano aunque no haya ventanas.
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', showWindow);