'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drunkdeer', {
  getStatus: () => ipcRenderer.invoke('app:status'),
  applyProfile: (profileId) => ipcRenderer.invoke('profile:apply', profileId),
  setAutoEnabled: (enabled) => ipcRenderer.invoke('auto:set', enabled),
  addProfile: (name) => ipcRenderer.invoke('profiles:add', name),
  removeProfile: (profileId) => ipcRenderer.invoke('profiles:remove', profileId),
  updateProfileFeatures: (profileId, features) =>
    ipcRenderer.invoke('profile:features', { profileId, features }),
  importProfile: () => ipcRenderer.invoke('profile:import'),
  exportProfile: (profileId) => ipcRenderer.invoke('profile:export', profileId),
  updateKeys: (profileId, keys, settings) =>
    ipcRenderer.invoke('keys:update', { profileId, keys, settings }),
  renameProfile: (profileId, name) => ipcRenderer.invoke('profiles:rename', { profileId, name }),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setEffect: (params) => ipcRenderer.invoke('lighting:effect', params),
  setCustomLight: (params) => ipcRenderer.invoke('lighting:custom', params),
  setBrightness: (level) => ipcRenderer.invoke('lighting:brightness', level),
  applyRemap: (layers, profileId) => ipcRenderer.invoke('remap:apply', { layers, profileId }),
  loadRemap: (profileId) => ipcRenderer.invoke('remap:load', profileId),
  setTurboMode: (profileId, on) => ipcRenderer.invoke('turbo:set', { profileId, on }),
  setKeyTracking: (on) => ipcRenderer.invoke('perf:tracking', on),
  addGame: (processName, profileId) =>
    ipcRenderer.invoke('games:add', { processName, profileId }),
  removeGame: (gameId) => ipcRenderer.invoke('games:remove', gameId),
});