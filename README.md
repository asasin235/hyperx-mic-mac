# DuoCast Control

A native macOS **menu bar application** for controlling the **HyperX DuoCast USB microphone** — replacing the Windows-only HyperX NGenuity software on macOS.

![DuoCast Control](assets/tray-icon.svg)

---

## Features

| Feature | Details |
|---|---|
| **Mic Gain** | Slider 0–100 %, real-time VU meter (Web Audio API) |
| **Mute Toggle** | One-click or ⌘⇧M global shortcut, tray icon turns to 🔇 |
| **Headphone Monitor** | Separate slider for the DuoCast's built-in headphone output |
| **Sample Rate** | 44 100 / 48 000 / 96 000 Hz dropdown |
| **Polar Pattern** | Cardioid / Omnidirectional buttons (via USB HID) |
| **10-Band EQ** | BiquadFilterNode chain: 32 Hz – 16 kHz, ±12 dB per band |
| **EQ Presets** | Flat, Voice Boost, Podcast, Bass Boost, Bright + save custom |
| **RGB LED** | Color picker, Solid / Pulse / Rainbow / Off, speed control |
| **Menu Bar** | No Dock icon; lives in the macOS menu bar |
| **Auto-detect** | Polls for DuoCast every 3 s; restores settings on reconnect |
| **Settings persist** | JSON file in `~/Library/Application Support/DuoCast Control/` |
| **Debug panel** | HID device list, raw HID byte sender, CoreAudio device list |

---

## Prerequisites

- **macOS 13 Ventura** or later (Apple Silicon M-series primary; universal binary)
- **Node.js 20+** — [https://nodejs.org](https://nodejs.org)
- **Xcode Command Line Tools** (required for native modules):
  ```bash
  xcode-select --install
  ```
- **npm 10+** (ships with Node 20)

Optional (for sample rate control):
```bash
brew install switchaudio-osx
```

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/asasin235/hyperx-mic-mac.git
cd hyperx-mic-mac

# 2. Install dependencies (this also runs electron-rebuild for native modules)
npm install

# 3. Start in development mode
npm run dev
```

`npm run dev` launches Vite's dev server and Electron concurrently.  
The app appears as a mic icon 🎙 in the macOS menu bar — click it to open the control panel.

---

## Build a DMG

```bash
# Build renderer with Vite, then package as a .dmg (arm64 + x64 universal)
npm run build
```

The output `.dmg` file will be in the `dist/` directory.

> **Signing**: For notarization/distribution outside the App Store, set
> `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables with your
> Developer ID certificate. For local testing, `CSC_IDENTITY_AUTO_DISCOVERY=false`
> skips signing.

---

## Architecture

```
duocast-control/
├── src/
│   ├── main/
│   │   ├── index.js      # Electron main process, IPC handlers, settings
│   │   ├── tray.js       # macOS menu bar tray (SVG icon, context menu)
│   │   ├── audio.js      # CoreAudio via naudiodon + osascript
│   │   └── hid.js        # node-hid USB HID (RGB + polar pattern)
│   ├── renderer/
│   │   ├── index.html    # Main control panel UI
│   │   ├── app.js        # Renderer logic, Web Audio EQ chain, VU meter
│   │   └── style.css     # Dark-mode frosted glass UI
│   └── preload.js        # contextBridge IPC bindings
├── assets/
│   ├── tray-icon.svg     # Menu bar icon (normal)
│   └── tray-icon-muted.svg  # Menu bar icon (muted state)
├── .github/workflows/
│   └── build.yml         # CI: builds DMG on push to main
├── package.json
├── vite.config.js        # Vite config for renderer
└── electron-builder.yml  # Packaging config (macOS DMG, arm64+x64)
```

### IPC Channels

| Channel | Direction | Payload |
|---|---|---|
| `audio:getDevices` | renderer→main | — |
| `audio:setGain` | renderer→main | `value: 0–1` |
| `audio:setMute` | renderer→main | `muted: bool` |
| `audio:setHeadphoneVolume` | renderer→main | `value: 0–1` |
| `audio:setSampleRate` | renderer→main | `rate: 44100\|48000\|96000` |
| `hid:setPolarPattern` | renderer→main | `pattern: 'cardioid'\|'omni'` |
| `hid:setRGB` | renderer→main | `r, g, b, effect, speed` |
| `hid:sendRaw` | renderer→main | `bytes: number[]` |
| `hid:listDevices` | renderer→main | — |
| `eq:setBand` | renderer→main | `band: Hz, gain: -12–+12` |
| `eq:setPreset` | renderer→main | `name: string` |
| `eq:savePreset` | renderer→main | `name, bands` |
| `settings:get` | renderer→main | — |
| `settings:save` | renderer→main | `partial: Object` |
| `mic:connectionChanged` | main→renderer | `connected: bool` |
| `audio:muteChanged` | main→renderer | `muted: bool` |
| `settings:loaded` | main→renderer | `settings: Object` |

---

## Native Modules

Two native npm packages require compilation against Electron's Node.js runtime:

| Package | Purpose |
|---|---|
| `node-hid` | USB HID communication (RGB, polar pattern) |
| `naudiodon` | PortAudio wrapper for CoreAudio device enumeration |

`npm install` automatically runs `electron-rebuild` via the `postinstall` script.  
If you ever need to rebuild manually:

```bash
npx electron-rebuild -f -w node-hid
```

If `naudiodon` fails to compile (it's less critical), the app will still launch — the VU meter and EQ chain use the browser's `getUserMedia` / Web Audio API instead.

---

## How to Reverse-Engineer RGB Commands

The HID command bytes for RGB and polar pattern are **placeholders** (all zeros) in `src/main/hid.js`. Here is how to discover the real bytes:

### What you need

- A **Windows machine or VM** (VirtualBox/Parallels/UTM with Windows 11)
- **HyperX NGenuity** installed on Windows
- **Wireshark** + **USBPcap** — [https://www.wireshark.org](https://www.wireshark.org)
- Your **HyperX DuoCast** plugged into the Windows machine via USB

### Step-by-step

1. **Install Wireshark** on Windows and enable the USBPcap driver during installation.

2. **Plug in the DuoCast** and open NGenuity. Wait for it to recognise the mic.

3. **Open Wireshark** and start a capture on the **USBPcap** interface that corresponds to the USB controller the DuoCast is connected to.  
   (You can identify it by looking at Device Manager → Universal Serial Bus controllers.)

4. **Change the RGB color** in NGenuity (e.g., set it to pure red `#FF0000`).

5. **Stop the capture** and apply the filter:
   ```
   usb.transfer_type == 0x01
   ```
   This shows only interrupt transfers (the type used by HID).

6. Look for **URB_INTERRUPT out** packets sent to the DuoCast's endpoint.  
   The `Leftover Capture Data` field contains the 64-byte HID report.

7. **Right-click → Copy → … as Hex Stream** and note the bytes.

8. Repeat for each RGB effect (solid, pulse, rainbow, off) and polar pattern.

9. Open `src/main/hid.js` and replace the placeholder arrays with the real bytes.  
   The file contains clearly marked `// TODO` comments showing exactly where to paste them.

### Testing with the Debug Panel

The app includes a **"Send Raw HID"** panel in Settings & Debug. You can:
1. Open DuoCast Control
2. Expand **Settings & Debug**
3. Enter hex bytes in the raw HID textarea (space-separated, e.g. `00 04 01 FF 00 00 …`)
4. Click **Send** — the bytes are sent immediately to the first detected HyperX HID device

This lets you iterate quickly without rebuilding.

---

## CoreAudio Notes

Full per-device CoreAudio property access (`kAudioDevicePropertyNominalSampleRate`,
`kAudioDevicePropertyVolumeScalar` scoped to the DuoCast specifically) requires
calling the `AudioHardware` C API. The current implementation uses:

- **`osascript` (AppleScript)** — for input volume and mute (affects the default input device)
- **`SwitchAudioSource`** (Homebrew) — for sample rate (`brew install switchaudio-osx`)

For a fully native per-device implementation, a small Swift CLI helper can be
compiled and bundled with the app. See the `TODO` comments in `src/main/audio.js`.

---

## Settings File

Settings are persisted as JSON at:
```
~/Library/Application Support/DuoCast Control/settings.json
```

You can edit this file manually (while the app is closed) to reset or migrate settings.

---

## CI / CD

GitHub Actions builds a macOS DMG on every push to `main`:

```
.github/workflows/build.yml
```

Artifacts are uploaded as `DuoCast-Control-arm64-dmg` and `DuoCast-Control-x64-dmg`.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| App doesn't appear in menu bar | Check that macOS allows the app to run: System Settings → Privacy & Security |
| "node-hid not available" | Run `npm run postinstall` to rebuild native modules |
| "naudiodon not available" | Same as above. VU meter will still work via getUserMedia |
| Mic gain/mute doesn't work | Make sure DuoCast is set as the default input in System Settings → Sound |
| Sample rate change fails | Install switchaudio-osx: `brew install switchaudio-osx` |
| RGB/polar pattern does nothing | The HID command bytes are placeholders — see the reverse-engineering section above |
| DMG build fails on signing | Set `CSC_IDENTITY_AUTO_DISCOVERY=false` in your environment |

---

## License

MIT © DuoCast Control Contributors