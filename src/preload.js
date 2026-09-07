'use strict';

/**
 * preload.js — Electron contextBridge IPC bindings
 *
 * Exposes a safe `window.duoCast` API to the renderer process,
 * bridging all IPC channels defined in src/main/index.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('duoCast', {
  // ── Audio ────────────────────────────────────────────────────────────────
  /** @returns {Promise<Array>} CoreAudio device list */
  getDevices: () => ipcRenderer.invoke('audio:getDevices'),

  /** @param {number} value 0–1 */
  setGain: (value) => ipcRenderer.invoke('audio:setGain', value),

  /** @param {boolean} muted */
  setMute: (muted) => ipcRenderer.invoke('audio:setMute', muted),

  /** @param {number} value 0–1 */
  setHeadphoneVolume: (value) => ipcRenderer.invoke('audio:setHeadphoneVolume', value),

  /** @param {44100|48000|96000} rate */
  setSampleRate: (rate) => ipcRenderer.invoke('audio:setSampleRate', rate),

  // ── HID ──────────────────────────────────────────────────────────────────
  /** @param {'cardioid'|'omni'} pattern */
  setPolarPattern: (pattern) => ipcRenderer.invoke('hid:setPolarPattern', pattern),

  /**
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {'solid'|'pulse'|'rainbow'|'off'} effect
   * @param {number} speed 0–100
   */
  setRGB: (r, g, b, effect, speed) =>
    ipcRenderer.invoke('hid:setRGB', r, g, b, effect, speed),

  /** @param {number[]} bytes */
  sendRaw: (bytes) => ipcRenderer.invoke('hid:sendRaw', bytes),

  /** @returns {Promise<Array>} list of HyperX HID devices */
  listHIDDevices: () => ipcRenderer.invoke('hid:listDevices'),

  // ── EQ ───────────────────────────────────────────────────────────────────
  /**
   * @param {number} band  Frequency in Hz (32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)
   * @param {number} gain  -12 to +12 dB
   */
  setEQBand: (band, gain) => ipcRenderer.invoke('eq:setBand', band, gain),

  /** @param {string} name  Built-in or custom preset name */
  setEQPreset: (name) => ipcRenderer.invoke('eq:setPreset', name),

  /**
   * @param {string} name
   * @param {Object} bands  { [freq]: gain }
   */
  saveEQPreset: (name, bands) => ipcRenderer.invoke('eq:savePreset', name, bands),

  /** @returns {Promise<Object>} map of custom preset name → bands */
  getEQPresets: () => ipcRenderer.invoke('eq:getPresets'),

  // ── Settings ─────────────────────────────────────────────────────────────
  /** @returns {Promise<Object>} all persisted settings */
  getSettings: () => ipcRenderer.invoke('settings:get'),

  /** @param {Object} partial */
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),

  // ── Window controls ───────────────────────────────────────────────────────
  hideWindow: () => ipcRenderer.send('window:hide'),
  toggleDevTools: () => ipcRenderer.send('window:toggleDevTools'),

  // ── Event listeners ───────────────────────────────────────────────────────
  /**
   * @param {(settings: Object) => void} cb
   */
  onSettingsLoaded: (cb) => ipcRenderer.on('settings:loaded', (_e, s) => cb(s)),

  /**
   * @param {(connected: boolean) => void} cb
   */
  onMicConnectionChanged: (cb) =>
    ipcRenderer.on('mic:connectionChanged', (_e, connected) => cb(connected)),

  /**
   * @param {(muted: boolean) => void} cb
   */
  onMuteChanged: (cb) =>
    ipcRenderer.on('audio:muteChanged', (_e, muted) => cb(muted)),

  /**
   * Fired from tray "Mute/Unmute" context menu item.
   * @param {() => void} cb
   */
  onTrayToggleMute: (cb) => ipcRenderer.on('tray:toggleMute', () => cb()),
});
