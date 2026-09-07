/**
 * app.js — DuoCast Control renderer process
 *
 * Responsibilities:
 *  - Bootstrap UI from persisted settings
 *  - Mic gain slider + real-time VU meter (Web Audio API AnalyserNode)
 *  - Mute toggle + keyboard shortcut Cmd+Shift+M
 *  - Headphone monitor volume slider
 *  - Sample rate selector
 *  - Polar pattern toggle
 *  - 10-band parametric EQ (BiquadFilterNode chain) with presets
 *  - RGB LED color picker + effect selector + speed slider
 *  - Settings/debug panel: HID device list, raw HID sender, CoreAudio device list
 *  - Mic auto-detect: show empty state when not connected
 */

// ── IPC bridge (injected by preload.js) ──────────────────────────────────────
const api = window.duoCast;

// ── State ────────────────────────────────────────────────────────────────────
let state = {
  gain: 0.7,
  muted: false,
  headphoneVolume: 0.8,
  sampleRate: 44100,
  polarPattern: 'cardioid',
  rgb: { r: 229, g: 41, b: 42, effect: 'solid', speed: 50 },
  eq: {
    preset: 'flat',
    bands: { 32: 0, 64: 0, 125: 0, 250: 0, 500: 0, 1000: 0, 2000: 0, 4000: 0, 8000: 0, 16000: 0 },
  },
  micConnected: false,
};

// ── EQ built-in presets ───────────────────────────────────────────────────────
const EQ_PRESETS = {
  flat:    { 32: 0,  64: 0,  125: 0,  250: 0, 500: 0,  1000: 0, 2000: 0, 4000: 0,  8000: 0,  16000: 0 },
  voice:   { 32: -3, 64: -2, 125: 0,  250: 2, 500: 4,  1000: 5, 2000: 4, 4000: 2,  8000: 1,  16000: 0 },
  podcast: { 32: -4, 64: -2, 125: 0,  250: 1, 500: 3,  1000: 4, 2000: 3, 4000: 1,  8000: -1, 16000: -2 },
  bass:    { 32: 8,  64: 7,  125: 5,  250: 3, 500: 1,  1000: 0, 2000: 0, 4000: 0,  8000: 0,  16000: 0 },
  bright:  { 32: -2, 64: -1, 125: 0,  250: 0, 500: 0,  1000: 1, 2000: 2, 4000: 4,  8000: 6,  16000: 8 },
};

const EQ_BANDS_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// ── Web Audio EQ chain ────────────────────────────────────────────────────────
let audioCtx = null;
let analyser = null;
let eqFilters = []; // BiquadFilterNode[]
let mediaStream = null;
let vuAnimFrame = null;

async function initWebAudio() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(mediaStream);

    // Build 10-band EQ chain
    eqFilters = EQ_BANDS_HZ.map((freq, i) => {
      const filter = audioCtx.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === EQ_BANDS_HZ.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = state.eq.bands[freq] ?? 0;
      return filter;
    });

    // Chain: source → filter[0] → filter[1] → … → analyser → destination
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.7;

    source.connect(eqFilters[0]);
    for (let i = 0; i < eqFilters.length - 1; i++) {
      eqFilters[i].connect(eqFilters[i + 1]);
    }
    eqFilters[eqFilters.length - 1].connect(analyser);
    // Do NOT connect to destination — we don't want to hear ourselves

    startVUMeter();
  } catch (err) {
    console.warn('[audio] getUserMedia failed:', err.message);
    // Non-fatal — VU meter simply stays dark
  }
}

// ── VU Meter ──────────────────────────────────────────────────────────────────
function startVUMeter() {
  if (!analyser) return;
  const vuBar = document.getElementById('vuBar');
  const buffer = new Float32Array(analyser.fftSize);

  function tick() {
    vuAnimFrame = requestAnimationFrame(tick);
    analyser.getFloatTimeDomainData(buffer);

    // RMS
    let sum = 0;
    for (const s of buffer) sum += s * s;
    const rms = Math.sqrt(sum / buffer.length);
    const dB = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    // Map -60 dB … 0 dB → 0 % … 100 %
    const pct = Math.max(0, Math.min(100, (dB + 60) / 60 * 100));
    vuBar.style.width = pct + '%';

    // Colour: green → yellow → red
    if (dB > -3) {
      vuBar.className = 'vu-bar vu-clip';
    } else if (dB > -12) {
      vuBar.className = 'vu-bar vu-warn';
    } else {
      vuBar.className = 'vu-bar';
    }
  }
  tick();
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Gain ──────────────────────────────────────────────────────────────────────
function initGain() {
  const slider = $('gainSlider');
  const label  = $('gainValue');

  slider.value = Math.round(state.gain * 100);
  label.textContent = slider.value + '%';

  slider.addEventListener('input', () => {
    label.textContent = slider.value + '%';
  });
  slider.addEventListener('change', () => {
    const v = parseInt(slider.value, 10) / 100;
    state.gain = v;
    api?.setGain(v);
  });
}

// ── Mute ──────────────────────────────────────────────────────────────────────
function setMuteUI(muted) {
  state.muted = muted;
  const btn  = $('muteBtn');
  const icon = $('muteIcon');
  const lbl  = $('muteLabel');
  if (muted) {
    btn.classList.add('muted');
    icon.textContent = '🔇';
    lbl.textContent  = 'Muted';
  } else {
    btn.classList.remove('muted');
    icon.textContent = '🎙';
    lbl.textContent  = 'Live';
  }
}

function initMute() {
  setMuteUI(state.muted);
  $('muteBtn').addEventListener('click', () => {
    const next = !state.muted;
    setMuteUI(next);
    api?.setMute(next);
  });

  // Keyboard shortcut handled in main process, but also handle via preload event
  api?.onMuteChanged((muted) => setMuteUI(muted));
  api?.onTrayToggleMute(() => {
    const next = !state.muted;
    setMuteUI(next);
    api?.setMute(next);
  });
}

// ── Headphone volume ──────────────────────────────────────────────────────────
function initHeadphone() {
  const slider = $('headphoneSlider');
  const label  = $('headphoneValue');

  slider.value = Math.round(state.headphoneVolume * 100);
  label.textContent = slider.value + '%';

  slider.addEventListener('input', () => {
    label.textContent = slider.value + '%';
  });
  slider.addEventListener('change', () => {
    const v = parseInt(slider.value, 10) / 100;
    state.headphoneVolume = v;
    api?.setHeadphoneVolume(v);
  });
}

// ── Sample rate ───────────────────────────────────────────────────────────────
function initSampleRate() {
  const sel = $('sampleRateSelect');
  sel.value = String(state.sampleRate);

  sel.addEventListener('change', () => {
    const rate = parseInt(sel.value, 10);
    state.sampleRate = rate;
    api?.setSampleRate(rate).then(res => {
      if (res && !res.ok) {
        showToast('⚠️ ' + (res.error || 'Could not set sample rate'));
      }
    });
  });
}

// ── Polar pattern ─────────────────────────────────────────────────────────────
function initPolar() {
  const btns = document.querySelectorAll('#polarGroup .btn-choice');
  btns.forEach(btn => {
    if (btn.dataset.pattern === state.polarPattern) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.polarPattern = btn.dataset.pattern;
      api?.setPolarPattern(btn.dataset.pattern);
    });
  });
}

// ── EQ ────────────────────────────────────────────────────────────────────────
function applyEQBands(bands) {
  EQ_BANDS_HZ.forEach((freq, i) => {
    const gain = bands[freq] ?? 0;
    state.eq.bands[freq] = gain;
    if (eqFilters[i]) eqFilters[i].gain.value = gain;

    // Update slider + label in DOM
    const slider = document.querySelector(`.eq-band-slider[data-freq="${freq}"]`);
    const label  = document.querySelector(`.eq-band-value[data-freq="${freq}"]`);
    if (slider) slider.value = gain;
    if (label)  label.textContent = (gain >= 0 ? '+' : '') + gain + ' dB';
  });
}

function initEQ() {
  // Build band sliders
  const container = $('eqBands');
  EQ_BANDS_HZ.forEach(freq => {
    const gain = state.eq.bands[freq] ?? 0;
    const label = freq >= 1000 ? (freq / 1000) + 'k' : String(freq);

    const col = document.createElement('div');
    col.className = 'eq-band';
    col.innerHTML = `
      <input type="range" class="eq-band-slider" data-freq="${freq}"
             min="-12" max="12" step="0.5" value="${gain}"
             orient="vertical" title="${label} Hz" />
      <span class="eq-band-value" data-freq="${freq}">${gain >= 0 ? '+' : ''}${gain} dB</span>
      <span class="eq-band-label">${label}</span>
    `;
    container.appendChild(col);

    const slider = col.querySelector('.eq-band-slider');
    const valEl  = col.querySelector('.eq-band-value');

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valEl.textContent = (v >= 0 ? '+' : '') + v + ' dB';
    });
    slider.addEventListener('change', () => {
      const v = parseFloat(slider.value);
      state.eq.bands[freq] = v;
      if (eqFilters[EQ_BANDS_HZ.indexOf(freq)]) {
        eqFilters[EQ_BANDS_HZ.indexOf(freq)].gain.value = v;
      }
      api?.setEQBand(freq, v);
    });
  });

  // Preset buttons (built-in)
  document.querySelectorAll('#eqPresets .preset-btn').forEach(btn => {
    if (btn.dataset.preset === state.eq.preset) btn.classList.add('active');
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (!EQ_PRESETS[preset]) return;
      document.querySelectorAll('#eqPresets .preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.eq.preset = preset;
      $('eqPresetLabel').textContent = btn.textContent.trim();
      applyEQBands(EQ_PRESETS[preset]);
      api?.setEQPreset(preset);
    });
  });

  // Load & show custom presets
  refreshCustomPresets();

  // Save custom preset
  $('btnSavePreset').addEventListener('click', async () => {
    const name = $('presetNameInput').value.trim();
    if (!name) { showToast('Enter a preset name'); return; }
    await api?.saveEQPreset(name, { ...state.eq.bands });
    showToast(`Preset "${name}" saved`);
    $('presetNameInput').value = '';
    refreshCustomPresets();
  });

  // Apply initial preset
  applyEQBands(state.eq.bands);
  $('eqPresetLabel').textContent = state.eq.preset;
}

async function refreshCustomPresets() {
  const presets = await api?.getEQPresets() || {};
  // Remove old custom preset buttons
  document.querySelectorAll('#eqPresets .preset-btn-custom').forEach(el => el.remove());
  Object.keys(presets).forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn preset-btn-custom';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      document.querySelectorAll('#eqPresets .preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.eq.preset = name;
      $('eqPresetLabel').textContent = name;
      applyEQBands(presets[name]);
      api?.setEQPreset(name);
    });
    $('eqPresets').appendChild(btn);
  });
}

// ── RGB ───────────────────────────────────────────────────────────────────────
function hexToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function initRGB() {
  const colorPicker = $('colorPicker');
  const hexInput    = $('hexInput');
  const speedSlider = $('speedSlider');
  const speedValue  = $('speedValue');

  // Init from state
  const initialHex = rgbToHex(state.rgb.r, state.rgb.g, state.rgb.b);
  colorPicker.value = initialHex;
  hexInput.value    = initialHex;
  speedSlider.value = state.rgb.speed;
  speedValue.textContent = state.rgb.speed + '%';

  // Sync color picker ↔ hex input
  colorPicker.addEventListener('input', () => {
    hexInput.value = colorPicker.value;
  });
  hexInput.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
      colorPicker.value = hexInput.value;
    }
  });

  // Effect buttons
  const effectBtns = document.querySelectorAll('#effectGroup .btn-choice');
  effectBtns.forEach(btn => {
    if (btn.dataset.effect === state.rgb.effect) btn.classList.add('active');
    btn.addEventListener('click', () => {
      effectBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.rgb.effect = btn.dataset.effect;
      // Hide speed row for non-animated effects
      $('speedRow').style.display = (btn.dataset.effect === 'solid' || btn.dataset.effect === 'off')
        ? 'none' : '';
    });
  });
  // Initial visibility of speed row
  const initEffect = state.rgb.effect;
  $('speedRow').style.display = (initEffect === 'solid' || initEffect === 'off') ? 'none' : '';

  speedSlider.addEventListener('input', () => {
    speedValue.textContent = speedSlider.value + '%';
    state.rgb.speed = parseInt(speedSlider.value, 10);
  });

  $('btnApplyRGB').addEventListener('click', () => {
    const hex = colorPicker.value;
    const { r, g, b } = hexToRGB(hex);
    const effect = state.rgb.effect;
    const speed  = parseInt(speedSlider.value, 10);
    state.rgb = { r, g, b, effect, speed };
    api?.setRGB(r, g, b, effect, speed);
    showToast('RGB applied');
  });
}

// ── Collapsible cards ─────────────────────────────────────────────────────────
function initCollapsibles() {
  document.querySelectorAll('.card-toggle').forEach(toggle => {
    const bodyId = toggle.dataset.target;
    const body   = document.getElementById(bodyId);
    const arrow  = toggle.querySelector('.collapse-arrow');

    toggle.addEventListener('click', () => {
      const collapsed = body.classList.toggle('hidden');
      if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
    });
  });
}

// ── Settings / Debug panel ────────────────────────────────────────────────────
function initDebug() {
  // HID device list
  $('btnRefreshHID').addEventListener('click', async () => {
    const devices = await api?.listHIDDevices() || [];
    $('hidDeviceList').textContent = devices.length
      ? JSON.stringify(devices, null, 2)
      : 'No HyperX HID devices found (vendorId 0x0951).';
  });

  // Send raw HID
  $('btnSendRaw').addEventListener('click', async () => {
    const raw = $('rawHIDInput').value.trim();
    if (!raw) return;
    const bytes = raw.split(/[\s,]+/).map(h => parseInt(h, 16)).filter(n => !isNaN(n));
    if (bytes.length === 0) { showToast('No valid hex bytes entered'); return; }
    const result = await api?.sendRaw(bytes);
    $('rawResult').textContent = result?.ok
      ? `✅ Sent ${result.bytesSent} bytes`
      : `❌ ${result?.error || 'Error'}`;
  });

  // CoreAudio device list
  $('btnRefreshAudio').addEventListener('click', async () => {
    const devices = await api?.getDevices() || [];
    $('audioDeviceList').textContent = devices.length
      ? JSON.stringify(devices, null, 2)
      : 'No audio devices found (naudiodon may not be compiled).';
  });
}

// ── Mic connection state ──────────────────────────────────────────────────────
function setMicConnected(connected) {
  state.micConnected = connected;
  $('emptyState').classList.toggle('hidden', connected);
  $('mainContent').classList.toggle('hidden', !connected);
}

// ── Toast notification ────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ── Window close button ───────────────────────────────────────────────────────
function initWindowControls() {
  $('btnClose').addEventListener('click', () => api?.hideWindow());
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  // Load persisted settings
  let savedSettings = {};
  try {
    savedSettings = (await api?.getSettings()) || {};
  } catch {}

  // Merge saved settings into state
  state = {
    ...state,
    gain: savedSettings.gain ?? state.gain,
    muted: savedSettings.muted ?? state.muted,
    headphoneVolume: savedSettings.headphoneVolume ?? state.headphoneVolume,
    sampleRate: savedSettings.sampleRate ?? state.sampleRate,
    polarPattern: savedSettings.polarPattern ?? state.polarPattern,
    rgb: { ...state.rgb, ...(savedSettings.rgb || {}) },
    eq: {
      preset: savedSettings.eq?.preset ?? state.eq.preset,
      bands: { ...state.eq.bands, ...(savedSettings.eq?.bands || {}) },
    },
  };

  // Init all UI sections
  initGain();
  initMute();
  initHeadphone();
  initSampleRate();
  initPolar();
  initEQ();
  initRGB();
  initCollapsibles();
  initDebug();
  initWindowControls();

  // Listen for settings loaded event (fired after window shows)
  api?.onSettingsLoaded((s) => {
    // Already loaded above, but re-apply if main sends updated settings
    if (s.muted !== undefined) setMuteUI(s.muted);
  });

  // Listen for mic connection changes
  api?.onMicConnectionChanged((connected) => {
    setMicConnected(connected);
    if (connected) showToast('🎙 HyperX DuoCast connected');
    else showToast('⚠️ HyperX DuoCast disconnected');
  });

  // Start Web Audio (VU meter + EQ chain)
  await initWebAudio();

  // Initial connection check — assume connected until polling says otherwise
  // Show main content by default; main process polling will hide if needed
  setMicConnected(true);
}

// Run when DOM is ready
document.addEventListener('DOMContentLoaded', init);
