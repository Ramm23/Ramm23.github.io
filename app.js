// app.js — UI layer for tuner.js (v7 — CSS gauge)
// No external libraries required.

// ── Element refs ──────────────────────────────────────────────
const elNote        = document.getElementById('noteName');
const elSub         = document.getElementById('noteSub');
const elCents       = document.getElementById('centsLabel');
const elFreq        = document.getElementById('freqLabel');
const elBtn         = document.getElementById('startBtn');
const elGrid        = document.getElementById('stringsGrid');
const elPreset      = document.getElementById('presetSelect');
const elGaugeNeedle  = document.getElementById('gaugeNeedle');
const elGaugeCounter = document.getElementById('gaugeCounter');
const elGaugeUnit    = document.getElementById('gaugeUnit');
const elSettingsTab    = document.getElementById('tabSettings');
const elTunerTab       = document.getElementById('tabTuner');
const elTabBtnTuner    = document.getElementById('tabBtnTuner');
const elTabBtnSettings = document.getElementById('tabBtnSettings');
const elLevelBar    = document.getElementById('levelBar');
const elLevelGate   = document.getElementById('levelGate');
const elLevelRms    = document.getElementById('levelRms');
const elCalBtn      = document.getElementById('calBtn');
const elCalStatus   = document.getElementById('calStatus');
const elCalProgress = document.getElementById('calProgress');
const elResetBtn    = document.getElementById('resetBtn');

const SLIDERS = {
  micGain:      document.getElementById('sl-micGain'),
  rmsGate:      document.getElementById('sl-rmsGate'),
  yinThreshold: document.getElementById('sl-yinThreshold'),
  confThresh:   document.getElementById('sl-confThresh'),
  smoothing:    document.getElementById('sl-smoothing'),
  holdMs:       document.getElementById('sl-holdMs'),
};
const SLIDER_READOUTS = {
  micGain:      document.getElementById('rv-micGain'),
  rmsGate:      document.getElementById('rv-rmsGate'),
  yinThreshold: document.getElementById('rv-yinThreshold'),
  confThresh:   document.getElementById('rv-confThresh'),
  smoothing:    document.getElementById('rv-smoothing'),
  holdMs:       document.getElementById('rv-holdMs'),
};
const SLIDER_FORMAT = {
  micGain:      v => parseFloat(v).toFixed(1) + '×',
  rmsGate:      v => parseFloat(v).toFixed(3),
  yinThreshold: v => parseFloat(v).toFixed(2),
  confThresh:   v => parseFloat(v).toFixed(2),
  smoothing:    v => parseFloat(v).toFixed(2),
  holdMs:       v => Math.round(v) + ' ms',
};

// ── Hold fade ─────────────────────────────────────────────────
const MIN_HOLD_OPACITY = 0.35;
let holdStartedAt = null;

// ── CSS gauge ─────────────────────────────────────────────────
//
//  The needle is a plain <div> rotated with CSS transform.
//  -50 cents → -90deg  (far left)
//    0 cents →   0deg  (pointing straight up, centre)
//  +50 cents → +90deg  (far right)
//
//  The CSS transition on .gauge-needle handles all animation —
//  we just set the rotation value and the browser does the rest,
//  including the springy cubic-bezier easing from the reference.

function centsToRotation(cents) {
  // clamp then scale: 1 cent = 1.8 degrees
  return Math.max(-50, Math.min(50, cents)) * 1.8;
}

function setNeedle(cents, state) {
  const deg = centsToRotation(cents);
  elGaugeNeedle.style.transform = `rotate(${deg}deg)`;

  // Hub counter
  if (state === 'idle') {
    elGaugeCounter.textContent = '—';
    elGaugeCounter.removeAttribute('data-state');
    elGaugeUnit.textContent = '';
  } else {
    const sign = cents >= 0 ? '+' : '';
    elGaugeCounter.textContent = state === 'intune' ? '✓' : `${sign}${Math.round(cents)}`;
    elGaugeCounter.dataset.state = state;
    elGaugeUnit.textContent = state === 'intune' ? '' : '¢';
  }
}

function resetNeedle() {
  elGaugeNeedle.style.transform = 'rotate(0deg)';
  elGaugeCounter.textContent = '—';
  elGaugeCounter.removeAttribute('data-state');
  elGaugeUnit.textContent = '';
}

// ── Tab switching ─────────────────────────────────────────────

elTabBtnTuner.addEventListener('click',    () => switchTab('tuner'));
elTabBtnSettings.addEventListener('click', () => switchTab('settings'));

function switchTab(tab) {
  const isTuner = tab === 'tuner';
  elTunerTab.hidden    = !isTuner;
  elSettingsTab.hidden =  isTuner;
  elTabBtnTuner.classList.toggle('active',  isTuner);
  elTabBtnSettings.classList.toggle('active', !isTuner);
}

// ── Boot ──────────────────────────────────────────────────────

document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setMode(btn.dataset.mode);
  });
});

elBtn.addEventListener('click',     () => toggleListening());
elPreset.addEventListener('change', () => applyPreset(elPreset.value));
elCalBtn.addEventListener('click',  () => startCalibration());

elResetBtn.addEventListener('click', () => {
  updateDetection({
    micGain: 2.0, rmsGate: 0.012, yinThreshold: 0.12,
    confThresh: 0.50, smoothing: 0.18, holdMs: 1800,
  });
});

Object.entries(SLIDERS).forEach(([key, el]) => {
  if (!el) return;
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    SLIDER_READOUTS[key].textContent = SLIDER_FORMAT[key](v);
    updateDetection({ [key]: key === 'holdMs' ? Math.round(v) : v });
  });
});

onModeChanged('guitar', getCurrentPresets(), getCurrentStrings(), activePresetKey);
syncSliders(getDetection());

// ── Slider sync ───────────────────────────────────────────────

function syncSliders(params) {
  Object.entries(SLIDERS).forEach(([key, el]) => {
    if (!el) return;
    el.value = params[key];
    if (SLIDER_READOUTS[key])
      SLIDER_READOUTS[key].textContent = SLIDER_FORMAT[key](params[key]);
  });
}

// ── Level meter ───────────────────────────────────────────────

function updateLevelMeter(rms, gate) {
  const MAX_RMS = 0.15;
  const rmsP    = Math.min(1, rms  / MAX_RMS) * 100;
  const gateP   = Math.min(1, gate / MAX_RMS) * 100;
  elLevelBar.style.width      = rmsP + '%';
  elLevelBar.style.background = rms >= gate ? '#eb5e28' : '#6b6560';
  elLevelGate.style.left      = gateP + '%';
  elLevelRms.textContent      = rms.toFixed(4);
}

// ── Calibration UI ────────────────────────────────────────────

function onCalibrationStart(durationMs) {
  elCalBtn.disabled       = true;
  elCalBtn.textContent    = 'Listening…';
  elCalStatus.textContent = 'Keep instrument silent — measuring noise floor…';
  elCalProgress.style.width = '0%';
  elCalProgress.parentElement.style.display = '';
}
function onCalibrationProgress(p) {
  elCalProgress.style.width = (p * 100).toFixed(1) + '%';
}
function onCalibrationDone(newGate, noiseFloor) {
  elCalBtn.disabled       = false;
  elCalBtn.textContent    = 'Auto-calibrate';
  elCalStatus.textContent =
    `Done — noise floor ${noiseFloor.toFixed(4)}, gate set to ${newGate.toFixed(4)}`;
  elCalProgress.parentElement.style.display = 'none';
}
function onCalibrationError(msg) { elCalStatus.textContent = msg; }

// ── Preset dropdown ───────────────────────────────────────────

function renderPresetDropdown(presetsForMode, selectedKey) {
  elPreset.innerHTML = '';
  for (const key of Object.keys(presetsForMode.tunings)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = key; opt.selected = key === selectedKey;
    elPreset.appendChild(opt);
  }
  const chromatic = Object.keys(presetsForMode.tunings).length <= 1;
  elPreset.closest('.preset-row').style.display = chromatic ? 'none' : '';
}

// ── String grid ───────────────────────────────────────────────

function renderStrings(strings) {
  if (!strings.length) {
    elGrid.style.gridTemplateColumns = '1fr';
    elGrid.innerHTML = '<p class="chromatic-label">All notes detected automatically</p>';
    return;
  }
  elGrid.style.gridTemplateColumns = `repeat(${strings.length}, 1fr)`;
  elGrid.innerHTML = strings.map((s, i) => {
    const opts = STRING_NOTE_OPTIONS.map(o =>
      `<option value="${o.midi}"${o.midi === s.midi ? ' selected' : ''}>${o.note}</option>`
    ).join('');
    return `
      <div class="string-cell" id="sc-${i}">
        <button class="string-btn" data-midi="${s.midi}"
          onclick="handleStringClick(${s.midi})"
        >${s.note.replace(/\d+$/, '')}</button>
        <span class="str-num">${i + 1}</span>
        <select class="string-select"
          onchange="handleStringOverride(${i}, this.value)"
          title="Override string ${i + 1}"
        >${opts}</select>
      </div>`;
  }).join('');
}

function handleStringClick(midi)    { selectString(midi); }
function handleStringOverride(i, v) { overrideString(i, parseInt(v, 10)); }

function syncStringHighlight(lockedMidi) {
  document.querySelectorAll('.string-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.midi) === lockedMidi);
  });
}

// ── State helpers ─────────────────────────────────────────────

function tuningState(cents) {
  const a = Math.abs(cents);
  return a < 5 ? 'intune' : a < 20 ? 'close' : 'off';
}

function setDisplayState(state) {
  elNote.dataset.state  = state;
  elCents.dataset.state = state;
}

function setOpacity(o) {
  const els = [elNote, elSub, elCents, elFreq,
               document.querySelector('.gauge-wrap')];
  els.forEach(el => { if (el) el.style.opacity = o; });
}

function resetDisplay() {
  elNote.textContent  = '—';
  elSub.textContent   = '';
  elCents.textContent = '';
  elFreq.textContent  = '—';
  elNote.removeAttribute('data-state');
  elCents.removeAttribute('data-state');
  setOpacity(1);
  holdStartedAt = null;
  resetNeedle();
}

// ── Engine callbacks ──────────────────────────────────────────

function onPitchDetected(data) {
  const state = tuningState(data.cents);

  if (data.held) {
    if (!holdStartedAt) holdStartedAt = performance.now();
    const progress = Math.min(1, (performance.now() - holdStartedAt) / DETECTION.holdMs);
    setOpacity(1 - progress * (1 - MIN_HOLD_OPACITY));
    return;
  }

  holdStartedAt = null;
  setOpacity(1);

  // Note display
  elNote.textContent = data.note;
  setDisplayState(state);
  elSub.textContent  = data.noteWithOct;

  // Text readout below gauge
  const sign = data.cents >= 0 ? '+' : '';
  elCents.textContent =
    state === 'intune' ? 'In tune ✓' : `${sign}${data.cents.toFixed(1)} cents`;
  elFreq.textContent = `${data.frequency.toFixed(1)} Hz`;

  // Move the needle
  setNeedle(data.cents, state);
}

function onSilence() { resetDisplay(); }

function onTunerStart() {
  elBtn.textContent = 'Stop';
  elBtn.classList.add('listening');
}

function onTunerStop() {
  elBtn.textContent = 'Start tuning';
  elBtn.classList.remove('listening');
  resetDisplay();
}

function onMicError() {
  alert('Microphone access was denied. Please allow microphone access and try again.');
}

function onModeChanged(newMode, presetsForMode, strings, presetKey) {
  renderPresetDropdown(presetsForMode, presetKey);
  renderStrings(strings);
  resetDisplay();
}

function onTuningChanged(strings, presetKey) {
  renderStrings(strings);
  syncStringHighlight(targetMidi);
  elPreset.value = presetKey;
}

function onStringSelected(midi) { syncStringHighlight(midi); }

function onRmsUpdate(rms, gateLevel) {
  if (!elSettingsTab.hidden) updateLevelMeter(rms, gateLevel);
}

function onDetectionChanged(params) { syncSliders(params); }