'use strict';

/**
 * hid.js — USB HID communication for HyperX DuoCast
 *
 * Uses node-hid to communicate with the DuoCast over USB HID.
 * vendorId: 0x0951 (Kingston / HyperX)
 *
 * ─── HOW TO FIND THE CORRECT COMMAND BYTES ────────────────────────────────
 *
 * 1. Install Wireshark + USBPcap on a Windows machine (or Windows VM).
 * 2. Open NGenuity, plug in the DuoCast.
 * 3. In Wireshark, start capturing on the USBPcap interface for the DuoCast.
 * 4. Change RGB color / polar pattern in NGenuity.
 * 5. Filter by: `usb.transfer_type == 0x01` (interrupt transfers)
 * 6. Look for URB_INTERRUPT OUT packets to the DuoCast's HID interface.
 * 7. Copy the data payload (64 bytes typically) into the TODO arrays below.
 *
 * The HID Debug panel in the app lets you send raw byte arrays to test commands.
 */

// Try to load node-hid (native module — requires compilation on macOS)
let HID = null;
try {
  HID = require('node-hid');
} catch (e) {
  console.warn('[hid] node-hid not available:', e.message);
  console.warn('[hid] RGB and polar pattern control will be unavailable.');
  console.warn('[hid] Run: npm run postinstall  to rebuild native modules.');
}

const HYPERX_VENDOR_ID = 0x0951;

// Opened HID devices, keyed by "vendorId:productId:path"
const openDevices = new Map();

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Enumerate all connected HyperX USB HID devices and log them.
 * Called on app startup so the user can identify the correct productId.
 */
function init() {
  if (!HID) return;
  const devices = listHyperXDevices();
  console.log('[hid] Found HyperX HID devices:', JSON.stringify(devices, null, 2));
  if (devices.length === 0) {
    console.warn('[hid] No HyperX HID devices found. Make sure the DuoCast is connected.');
  }
}

// ─── Device enumeration ───────────────────────────────────────────────────────

/**
 * Returns all connected HID devices with vendorId 0x0951 (HyperX).
 */
function listHyperXDevices() {
  if (!HID) return [];
  try {
    return HID.devices().filter(d => d.vendorId === HYPERX_VENDOR_ID);
  } catch (e) {
    console.error('[hid] listHyperXDevices error:', e);
    return [];
  }
}

/**
 * Opens (or re-uses) a HID device by its path.
 * @param {string} devicePath
 * @returns {HID.HID|null}
 */
function openDevice(devicePath) {
  if (!HID) return null;
  if (openDevices.has(devicePath)) return openDevices.get(devicePath);
  try {
    const dev = new HID.HID(devicePath);
    openDevices.set(devicePath, dev);
    return dev;
  } catch (e) {
    console.error('[hid] openDevice error:', e);
    return null;
  }
}

/**
 * Finds the first HyperX device that looks like the DuoCast.
 * Falls back to the first HyperX device if none match by name.
 */
function findDuoCastHID() {
  const devices = listHyperXDevices();
  // Try to match by product name
  let device = devices.find(d =>
    (d.product || '').toLowerCase().includes('duocast')
  );
  // Fall back to first HyperX device on usage page 0xFF00 (vendor-specific)
  if (!device) {
    device = devices.find(d => d.usagePage === 0xFF00);
  }
  // Last resort: first HyperX device
  if (!device) device = devices[0];
  return device || null;
}

// ─── Polar pattern ────────────────────────────────────────────────────────────

/**
 * Sets the microphone polar pattern (cardioid or omnidirectional).
 * @param {'cardioid'|'omni'} pattern
 *
 * TODO: Fill in the correct 64-byte HID command arrays after USB sniffing.
 * See the file header comment for sniffing instructions.
 *
 * Example packet structure (placeholder — DO NOT USE AS-IS):
 *   Byte 0:    Report ID (often 0x00 for non-numbered reports)
 *   Byte 1:    Command category (e.g. 0x04 for mic settings)
 *   Byte 2:    Sub-command (e.g. 0x01 for polar pattern)
 *   Byte 3:    Value (e.g. 0x01 = cardioid, 0x02 = omni)
 *   Bytes 4–63: Padding (0x00)
 */
function setPolarPattern(pattern) {
  const device = findDuoCastHID();
  if (!device) {
    console.warn('[hid] setPolarPattern: No HyperX HID device found');
    return { ok: false, error: 'Device not found' };
  }

  // TODO: Replace these placeholder byte arrays with the actual HID commands
  // obtained by sniffing NGenuity with Wireshark (see header comment above).
  const POLAR_CARDIOID = [
    0x00, // Report ID
    // TODO: fill in remaining 63 bytes from USB sniff
    ...new Array(63).fill(0x00),
  ];

  const POLAR_OMNI = [
    0x00, // Report ID
    // TODO: fill in remaining 63 bytes from USB sniff
    ...new Array(63).fill(0x00),
  ];

  const payload = pattern === 'omni' ? POLAR_OMNI : POLAR_CARDIOID;

  try {
    const dev = openDevice(device.path);
    if (!dev) return { ok: false, error: 'Could not open device' };
    dev.write(payload);
    return { ok: true, pattern };
  } catch (e) {
    console.error('[hid] setPolarPattern error:', e);
    return { ok: false, error: e.message };
  }
}

// ─── RGB LED control ──────────────────────────────────────────────────────────

/**
 * Sets the RGB LED color and effect.
 * @param {number} r  0–255
 * @param {number} g  0–255
 * @param {number} b  0–255
 * @param {'solid'|'pulse'|'rainbow'|'off'} effect
 * @param {number} speed  0–100
 *
 * TODO: Replace placeholder byte arrays with actual HID commands from USB sniff.
 *
 * Common RGB HID packet structure (placeholder — DO NOT USE AS-IS):
 *   Byte 0:    Report ID
 *   Byte 1:    Command (e.g. 0x01 for RGB)
 *   Byte 2:    Effect (e.g. 0x00=off, 0x01=solid, 0x02=pulse, 0x03=rainbow)
 *   Byte 3:    Red (0x00–0xFF)
 *   Byte 4:    Green (0x00–0xFF)
 *   Byte 5:    Blue (0x00–0xFF)
 *   Byte 6:    Speed (0x00–0x64)
 *   Bytes 7–63: Padding (0x00)
 */
function setRGB(r, g, b, effect, speed) {
  const device = findDuoCastHID();
  if (!device) {
    console.warn('[hid] setRGB: No HyperX HID device found');
    return { ok: false, error: 'Device not found' };
  }

  // Effect byte map (placeholder — verify via USB sniff)
  const EFFECT_MAP = { off: 0x00, solid: 0x01, pulse: 0x02, rainbow: 0x03 };
  const effectByte = EFFECT_MAP[effect] ?? 0x01;

  // TODO: Replace with actual packet structure from USB sniff
  const payload = [
    0x00,          // Report ID
    0x01,          // TODO: verify command byte for RGB
    effectByte,    // TODO: verify effect encoding
    r & 0xFF,      // Red
    g & 0xFF,      // Green
    b & 0xFF,      // Blue
    Math.round(Math.max(0, Math.min(100, speed))), // Speed
    ...new Array(57).fill(0x00), // Padding to 64 bytes total
  ];

  try {
    const dev = openDevice(device.path);
    if (!dev) return { ok: false, error: 'Could not open device' };
    dev.write(payload);
    return { ok: true };
  } catch (e) {
    console.error('[hid] setRGB error:', e);
    return { ok: false, error: e.message };
  }
}

// ─── Raw HID send (debug) ─────────────────────────────────────────────────────

/**
 * Sends a raw byte array to the first found HyperX HID device.
 * Used by the "Send Raw HID" debug panel in settings.
 * @param {number[]} bytes  Array of byte values (0–255)
 */
function sendRaw(bytes) {
  const device = findDuoCastHID();
  if (!device) {
    return { ok: false, error: 'No HyperX HID device found' };
  }
  try {
    const dev = openDevice(device.path);
    if (!dev) return { ok: false, error: 'Could not open device' };
    // Ensure the buffer is exactly the HID report size
    const payload = Array.from(bytes).map(b => b & 0xFF);
    dev.write(payload);
    return { ok: true, bytesSent: payload.length };
  } catch (e) {
    console.error('[hid] sendRaw error:', e);
    return { ok: false, error: e.message };
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function closeAll() {
  for (const [path, dev] of openDevices) {
    try { dev.close(); } catch {}
  }
  openDevices.clear();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  init,
  listHyperXDevices,
  setPolarPattern,
  setRGB,
  sendRaw,
  closeAll,
};
