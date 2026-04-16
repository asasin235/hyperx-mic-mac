'use strict';

const { app, BrowserWindow, ipcMain, nativeImage, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const trayManager = require('./tray');
const audio = require('./audio');
const hid = require('./hid');

// ─── Settings persistence ────────────────────────────────────────────────────

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  gain: 0.7,
  muted: false,
  headphoneVolume: 0.8,
  sampleRate: 44100,
  polarPattern: 'cardioid',
  rgb: { r: 229, g: 41, b: 42, effect: 'solid', speed: 50 },
  eq: {
    preset: 'flat',
    bands: {
      32: 0, 64: 0, 125: 0, 250: 0, 500: 0,
      1000: 0, 2000: 0, 4000: 0, 8000: 0, 16000: 0,
    },
  },
  eqPresets: {},
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE(), 'utf8');
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] write error:', err);
  }
}

let settings = loadSettings();

// ─── Window management ───────────────────────────────────────────────────────

let mainWindow = null;
const isDev = process.env.ELECTRON_IS_DEV === '1' || !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 420,
    maxWidth: 420,
    resizable: false,
    frame: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Restore settings on open
    mainWindow.webContents.send('settings:loaded', settings);
  });

  mainWindow.on('blur', () => {
    // Hide window when focus is lost (menu-bar style)
    if (!isDev) mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Audio: get devices
ipcMain.handle('audio:getDevices', async () => {
  return audio.getDevices();
});

// Audio: set mic gain (0–1)
ipcMain.handle('audio:setGain', async (_e, value) => {
  settings.gain = value;
  saveSettings(settings);
  return audio.setGain(value);
});

// Audio: toggle mute
ipcMain.handle('audio:setMute', async (_e, muted) => {
  settings.muted = muted;
  saveSettings(settings);
  const result = await audio.setMute(muted);
  // Update tray icon colour
  trayManager.setMuted(muted);
  return result;
});

// Audio: headphone monitoring volume
ipcMain.handle('audio:setHeadphoneVolume', async (_e, value) => {
  settings.headphoneVolume = value;
  saveSettings(settings);
  return audio.setHeadphoneVolume(value);
});

// Audio: sample rate
ipcMain.handle('audio:setSampleRate', async (_e, rate) => {
  settings.sampleRate = rate;
  saveSettings(settings);
  return audio.setSampleRate(rate);
});

// HID: polar pattern
ipcMain.handle('hid:setPolarPattern', async (_e, pattern) => {
  settings.polarPattern = pattern;
  saveSettings(settings);
  return hid.setPolarPattern(pattern);
});

// HID: RGB
ipcMain.handle('hid:setRGB', async (_e, r, g, b, effect, speed) => {
  settings.rgb = { r, g, b, effect, speed };
  saveSettings(settings);
  return hid.setRGB(r, g, b, effect, speed);
});

// HID: send raw bytes (debug)
ipcMain.handle('hid:sendRaw', async (_e, bytes) => {
  return hid.sendRaw(bytes);
});

// HID: list all HyperX HID devices (debug)
ipcMain.handle('hid:listDevices', async () => {
  return hid.listHyperXDevices();
});

// EQ: set band gain
ipcMain.handle('eq:setBand', async (_e, band, gain) => {
  if (!settings.eq.bands) settings.eq.bands = {};
  settings.eq.bands[band] = gain;
  saveSettings(settings);
  return { ok: true };
});

// EQ: set preset
ipcMain.handle('eq:setPreset', async (_e, name) => {
  settings.eq.preset = name;
  saveSettings(settings);
  return { ok: true };
});

// EQ: save custom preset
ipcMain.handle('eq:savePreset', async (_e, name, bands) => {
  if (!settings.eqPresets) settings.eqPresets = {};
  settings.eqPresets[name] = bands;
  saveSettings(settings);
  return { ok: true };
});

// EQ: get custom presets
ipcMain.handle('eq:getPresets', async () => {
  return settings.eqPresets || {};
});

// Settings: get all
ipcMain.handle('settings:get', async () => settings);

// Settings: save all (bulk update from renderer)
ipcMain.handle('settings:save', async (_e, partial) => {
  settings = Object.assign(settings, partial);
  saveSettings(settings);
  return { ok: true };
});

// Window controls
ipcMain.on('window:hide', () => {
  mainWindow?.hide();
});

ipcMain.on('window:toggleDevTools', () => {
  mainWindow?.webContents.toggleDevTools();
});

// ─── Mic auto-detect polling ─────────────────────────────────────────────────

let micConnected = false;
let pollTimer = null;

async function pollForMic() {
  const devices = audio.getDevices();
  const found = devices.some(d =>
    (d.name || '').toLowerCase().includes('hyperx duocast')
  );

  if (found !== micConnected) {
    micConnected = found;
    mainWindow?.webContents.send('mic:connectionChanged', found);

    if (found) {
      // Restore last settings on reconnect
      try {
        await audio.setGain(settings.gain);
        await audio.setMute(settings.muted);
        await audio.setHeadphoneVolume(settings.headphoneVolume);
        await audio.setSampleRate(settings.sampleRate);
        hid.setPolarPattern(settings.polarPattern);
        const { r, g, b, effect, speed } = settings.rgb;
        hid.setRGB(r, g, b, effect, speed);
      } catch (err) {
        console.error('[poll] restore settings error:', err);
      }
    }
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Hide dock icon — menu bar only
  if (app.dock) app.dock.hide();

  // Init native modules (best-effort)
  try { hid.init(); } catch (e) { console.warn('[hid] init error:', e.message); }

  // Register global shortcut Cmd+Shift+M → toggle mute
  globalShortcut.register('CommandOrControl+Shift+M', async () => {
    settings.muted = !settings.muted;
    saveSettings(settings);
    await audio.setMute(settings.muted).catch(() => {});
    trayManager.setMuted(settings.muted);
    mainWindow?.webContents.send('audio:muteChanged', settings.muted);
  });

  createWindow();
  trayManager.create(app, mainWindow);
  trayManager.setMuted(settings.muted);

  // Start mic polling
  await pollForMic();
  pollTimer = setInterval(pollForMic, 3000);
});

app.on('window-all-closed', (e) => {
  // Prevent quit — stay in menu bar
  e.preventDefault();
});

app.on('before-quit', () => {
  clearInterval(pollTimer);
  globalShortcut.unregisterAll();
  hid.closeAll();
  saveSettings(settings);
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});
