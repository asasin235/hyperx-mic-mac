'use strict';

const { Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let _app = null;
let _win = null;
let _muted = false;

// Build a simple mic SVG as a NativeImage template for macOS menu bar
function buildTrayImage(muted) {
  // 22×22 SVG for macOS menu bar (template image = auto-adapts to light/dark)
  const svg = muted
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
        <!-- Mic body -->
        <rect x="8" y="2" width="6" height="10" rx="3" fill="black"/>
        <!-- Mic stand arc -->
        <path d="M5 10 Q5 16 11 16 Q17 16 17 10" fill="none" stroke="black" stroke-width="1.5"/>
        <!-- Stand line -->
        <line x1="11" y1="16" x2="11" y2="20" stroke="black" stroke-width="1.5"/>
        <line x1="8" y1="20" x2="14" y2="20" stroke="black" stroke-width="1.5"/>
        <!-- Mute slash -->
        <line x1="3" y1="3" x2="19" y2="19" stroke="black" stroke-width="2" stroke-linecap="round"/>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
        <!-- Mic body -->
        <rect x="8" y="2" width="6" height="10" rx="3" fill="black"/>
        <!-- Mic stand arc -->
        <path d="M5 10 Q5 16 11 16 Q17 16 17 10" fill="none" stroke="black" stroke-width="1.5"/>
        <!-- Stand line -->
        <line x1="11" y1="16" x2="11" y2="20" stroke="black" stroke-width="1.5"/>
        <line x1="8" y1="20" x2="14" y2="20" stroke="black" stroke-width="1.5"/>
      </svg>`;

  return nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  ).resize({ width: 22, height: 22 });
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: _muted ? '🔇 Unmute (⌘⇧M)' : '🎙 Mute (⌘⇧M)',
      click: () => {
        _win?.webContents.send('tray:toggleMute');
      },
    },
    { type: 'separator' },
    {
      label: 'Open DuoCast Control',
      click: () => {
        _win?.show();
        _win?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      role: 'quit',
    },
  ]);
}

function create(app, win) {
  _app = app;
  _win = win;

  const icon = buildTrayImage(false);
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('DuoCast Control');

  tray.on('click', () => {
    if (_win) {
      if (_win.isVisible()) {
        _win.hide();
      } else {
        // Position the window near the tray icon
        const { x, y, width, height } = tray.getBounds();
        const winBounds = _win.getBounds();
        // Place below tray icon (menu bar is at top on macOS)
        const posX = Math.round(x + width / 2 - winBounds.width / 2);
        const posY = Math.round(y + height + 4);
        _win.setPosition(posX, Math.max(posY, 30));
        _win.show();
        _win.focus();
      }
    }
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(buildContextMenu());
  });

  return tray;
}

function setMuted(muted) {
  _muted = muted;
  if (!tray) return;
  const icon = buildTrayImage(muted);
  icon.setTemplateImage(true);
  tray.setImage(icon);
  tray.setToolTip(muted ? 'DuoCast Control — Muted' : 'DuoCast Control');
  // Rebuild context menu so label reflects current state
  tray.setContextMenu(buildContextMenu());
}

function destroy() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { create, setMuted, destroy };
