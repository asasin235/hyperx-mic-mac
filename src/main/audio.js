'use strict';

/**
 * audio.js — CoreAudio integration for DuoCast Control
 *
 * Uses naudiodon (PortAudio wrapper) for device enumeration and audio I/O.
 * Uses macOS `osascript` (AppleScript) for setting input volume and mute,
 * which maps to CoreAudio kAudioDevicePropertyVolumeScalar /
 * kAudioDevicePropertyMute on the default input device.
 *
 * For sample rate changes and precise per-device targeting we use the
 * `switchaudio-osx` CLI if installed, falling back to osascript.
 *
 * NOTE: Full per-device CoreAudio property access (kAudioDevicePropertyNominalSampleRate,
 * etc.) can be achieved by compiling a small Swift helper that uses the
 * AudioHardware framework. A TODO is left below for that integration.
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Try to load naudiodon (native module — requires compilation on macOS)
let naudiodon = null;
try {
  naudiodon = require('naudiodon');
} catch (e) {
  console.warn('[audio] naudiodon not available:', e.message);
  console.warn('[audio] Device enumeration will return an empty list.');
  console.warn('[audio] Run: npm run postinstall  to rebuild native modules.');
}

// ─── Device enumeration ───────────────────────────────────────────────────────

/**
 * Returns all PortAudio/CoreAudio devices as reported by naudiodon.
 * Each device has: id, name, maxInputChannels, maxOutputChannels, defaultSampleRate.
 */
function getDevices() {
  if (!naudiodon) return [];
  try {
    return naudiodon.getDevices();
  } catch (e) {
    console.error('[audio] getDevices error:', e);
    return [];
  }
}

/**
 * Finds the HyperX DuoCast device by name (case-insensitive).
 * Returns the device object or null if not found.
 */
function findDuoCast() {
  return getDevices().find(d =>
    (d.name || '').toLowerCase().includes('hyperx duocast')
  ) || null;
}

// ─── Mic gain (input volume) ──────────────────────────────────────────────────

/**
 * Sets the macOS input volume for the default input device.
 * @param {number} value  0.0 – 1.0
 *
 * TODO: Target the DuoCast specifically using CoreAudio AudioHardware API
 * (kAudioDevicePropertyVolumeScalar on the input scope) via a Swift helper.
 */
async function setGain(value) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  try {
    await execAsync(`osascript -e 'set volume input volume ${percent}'`);
    return { ok: true, value: percent };
  } catch (err) {
    console.error('[audio] setGain error:', err);
    return { ok: false, error: err.message };
  }
}

// ─── Mute ─────────────────────────────────────────────────────────────────────

/**
 * Mutes or unmutes the default input device.
 * @param {boolean} muted
 *
 * TODO: Target the DuoCast specifically using kAudioDevicePropertyMute.
 */
async function setMute(muted) {
  const val = muted ? 'true' : 'false';
  try {
    await execAsync(`osascript -e 'set volume input muted ${val}'`);
    return { ok: true, muted };
  } catch (err) {
    console.error('[audio] setMute error:', err);
    return { ok: false, error: err.message };
  }
}

// ─── Headphone monitoring volume ──────────────────────────────────────────────

/**
 * Sets the output volume of the DuoCast's built-in headphone monitor.
 * @param {number} value  0.0 – 1.0
 *
 * TODO: Use kAudioDevicePropertyVolumeScalar on the *output* scope of the
 * DuoCast device via the Swift CoreAudio helper described above.
 * For now, this sets the system output volume as a placeholder.
 */
async function setHeadphoneVolume(value) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  try {
    await execAsync(`osascript -e 'set volume output volume ${percent}'`);
    return { ok: true, value: percent };
  } catch (err) {
    console.error('[audio] setHeadphoneVolume error:', err);
    return { ok: false, error: err.message };
  }
}

// ─── Sample rate ──────────────────────────────────────────────────────────────

/**
 * Sets the nominal sample rate of the DuoCast input device.
 * @param {44100|48000|96000} rate
 *
 * Uses the `SwitchAudioSource` CLI (Homebrew: brew install switchaudio-osx)
 * if available, which supports `--sample-rate` on modern macOS.
 *
 * TODO: Implement via kAudioDevicePropertyNominalSampleRate using a Swift helper.
 */
async function setSampleRate(rate) {
  const allowed = [44100, 48000, 96000];
  if (!allowed.includes(rate)) {
    return { ok: false, error: `Invalid sample rate: ${rate}` };
  }

  // Try SwitchAudioSource first (brew install switchaudio-osx)
  try {
    const device = findDuoCast();
    const name = device ? device.name : 'HyperX DuoCast';
    await execAsync(`SwitchAudioSource -t input -n "${name}" -s ${rate}`);
    return { ok: true, rate };
  } catch {
    // SwitchAudioSource not installed — log and continue
  }

  // TODO: Call a bundled Swift helper that calls AudioObjectSetPropertyData
  // with kAudioDevicePropertyNominalSampleRate.
  console.warn(`[audio] setSampleRate: SwitchAudioSource not found.`);
  console.warn(`[audio] Please install it: brew install switchaudio-osx`);
  return {
    ok: false,
    error: 'SwitchAudioSource not installed. Run: brew install switchaudio-osx',
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getDevices,
  findDuoCast,
  setGain,
  setMute,
  setHeadphoneVolume,
  setSampleRate,
};
