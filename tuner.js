// ============================================================
//  tuner.js — YIN-based Guitar/Bass Tuner  (v3)
//  Ported from yin.c / yin.h
// ============================================================


// ── Note table ───────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function noteDesc(str) {
  const name = str.replace(/\d+$/, '');
  const oct  = parseInt(str.match(/\d+$/)[0], 10);
  const pc   = NOTE_NAMES.indexOf(name);
  return { note: str, midi: (oct + 1) * 12 + pc };
}
function n(s) { return noteDesc(s); }


// ── Tuning presets ────────────────────────────────────────────

const PRESETS = {
  guitar: {
    label: 'Guitar',
    tunings: {
      'Standard (EADGBe)':   [n('E2'),n('A2'),n('D3'),n('G3'),n('B3'),n('E4')],
      'Drop D (DADGBe)':     [n('D2'),n('A2'),n('D3'),n('G3'),n('B3'),n('E4')],
      'Open G (DGDGBd)':     [n('D2'),n('G2'),n('D3'),n('G3'),n('B3'),n('D4')],
      'Open D (DADf#Ad)':    [n('D2'),n('A2'),n('D3'),n('F#3'),n('A3'),n('D4')],
      'Open E (EBE G#Be)':   [n('E2'),n('B2'),n('E3'),n('G#3'),n('B3'),n('E4')],
      'DADGAD':              [n('D2'),n('A2'),n('D3'),n('G3'),n('A3'),n('D4')],
      'Half Step Down (Eb)': [n('D#2'),n('G#2'),n('C#3'),n('F#3'),n('A#3'),n('D#4')],
      'Full Step Down (D)':  [n('D2'),n('G2'),n('C3'),n('F3'),n('A3'),n('D4')],
      'Drop C (CGCFAd)':     [n('C2'),n('G2'),n('C3'),n('F3'),n('A3'),n('D4')],
      'Open A (EAEAc#e)':    [n('E2'),n('A2'),n('E3'),n('A3'),n('C#4'),n('E4')],
    },
  },
  bass: {
    label: 'Bass',
    tunings: {
      'Standard 4 (EADg)':   [n('E1'),n('A1'),n('D2'),n('G2')],
      'Standard 5 (BEADg)':  [n('B0'),n('E1'),n('A1'),n('D2'),n('G2')],
      'Standard 6 (BEADgc)': [n('B0'),n('E1'),n('A1'),n('D2'),n('G2'),n('C3')],
      'Drop D (DADg)':       [n('D1'),n('A1'),n('D2'),n('G2')],
      'Half Step Down (Eb)': [n('D#1'),n('G#1'),n('C#2'),n('F#2')],
      'Full Step Down (D)':  [n('D1'),n('G1'),n('C2'),n('F2')],
    },
  },
  chromatic: {
    label: 'Chromatic',
    tunings: { 'Detect all notes': [] },
  },
};


// ── Runtime tuning state ──────────────────────────────────────

let mode            = 'guitar';
let activePresetKey = 'Standard (EADGBe)';
let activeStrings   = deepCopyStrings(PRESET_STRINGS('guitar', 'Standard (EADGBe)'));

function PRESET_STRINGS(inst, key) {
  return PRESETS[inst].tunings[key] || Object.values(PRESETS[inst].tunings)[0];
}
function deepCopyStrings(arr) { return arr.map(s => ({ ...s })); }
function getPresetKeys()      { return Object.keys(PRESETS[mode].tunings); }

function applyPreset(key) {
  activePresetKey = key;
  activeStrings   = deepCopyStrings(PRESET_STRINGS(mode, key));
  targetMidi      = null;
  onTuningChanged(activeStrings, activePresetKey);
}

function overrideString(index, midiOrNote) {
  if (index < 0 || index >= activeStrings.length) return;
  let midi, note;
  if (typeof midiOrNote === 'string') {
    const d = noteDesc(midiOrNote); midi = d.midi; note = midiOrNote;
  } else {
    midi = midiOrNote;
    note = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }
  activeStrings[index] = { note, midi };
  onTuningChanged(activeStrings, activePresetKey);
}


// ── Detection parameters (all mutable at runtime) ────────────
//
//  These are the knobs the Settings tab exposes.
//  Change them at any time — processFrame() reads them live.

const SAMPLE_RATE = 44100;
const FRAME_SIZE  = 2048;

const DETECTION = {
  // Noise gate — RMS amplitude below which the frame is treated as silence.
  // Lower picks up quieter signals but risks false triggers from room noise.
  // Acoustic guitar through a laptop mic often needs 0.006–0.015.
  rmsGate:      0.012,
  RMS_GATE_MIN: 0.001,
  RMS_GATE_MAX: 0.08,

  // YIN aperiodicity threshold — controls how strict the pitch test is.
  // Lower = stricter (may miss soft notes). Higher = more permissive.
  yinThreshold:    0.12,
  YIN_THRESH_MIN:  0.05,
  YIN_THRESH_MAX:  0.30,

  // Minimum detection confidence (1 - aperiodicity) to show a reading.
  confThresh:       0.50,
  CONF_THRESH_MIN:  0.20,
  CONF_THRESH_MAX:  0.85,

  // IIR smoothing alpha for the cents display (needle speed).
  smoothing:       0.18,
  SMOOTHING_MIN:   0.05,
  SMOOTHING_MAX:   0.50,

  // How long (ms) to hold the last detected note after signal drops out.
  holdMs:       1800,
  HOLD_MS_MIN:  300,
  HOLD_MS_MAX:  4000,

  // Frequency detection range in Hz.
  fMin: 28,
  fMax: 1500,

  // Microphone pre-amplification gain applied before YIN sees the signal.
  // 1.0 = unity. 2-5 suits acoustic guitar on a laptop mic.
  // Above ~8 loud notes may clip.
  micGain:      2.0,
  MIC_GAIN_MIN: 1.0,
  MIC_GAIN_MAX: 10.0,
};

function updateDetection(patch) {
  Object.assign(DETECTION, patch);
  // If gain changed and the pipeline is running, apply it immediately
  if ('micGain' in patch) _applyMicGain();
  onDetectionChanged({ ...DETECTION });
}

function getDetection() { return { ...DETECTION }; }


// ── Auto-calibrate ────────────────────────────────────────────
//
//  Samples the mic for CALIBRATE_MS ms while the instrument is silent.
//  Measures the 95th-percentile RMS as the noise floor estimate,
//  then sets rmsGate = noiseFloor * GATE_MULTIPLIER.

const CALIBRATE_MS    = 2500;
const GATE_MULTIPLIER = 4.5;
const GATE_FLOOR      = 0.002;

let calibrating      = false;
let calibrateSamples = [];
let calibrateStart   = 0;

function startCalibration() {
  if (!listening) { onCalibrationError('Start the tuner first, then calibrate.'); return; }
  calibrating      = true;
  calibrateSamples = [];
  calibrateStart   = performance.now();
  onCalibrationStart(CALIBRATE_MS);
}

function _calibrationTick(rmsValue) {
  if (!calibrating) return;
  calibrateSamples.push(rmsValue);
  const elapsed  = performance.now() - calibrateStart;
  const progress = Math.min(1, elapsed / CALIBRATE_MS);
  onCalibrationProgress(progress);

  if (elapsed >= CALIBRATE_MS) {
    calibrating = false;
    const sorted  = [...calibrateSamples].sort((a, b) => a - b);
    const p95     = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
    const newGate = Math.max(GATE_FLOOR, parseFloat((p95 * GATE_MULTIPLIER).toFixed(4)));
    updateDetection({ rmsGate: newGate });
    onCalibrationDone(newGate, p95);
  }
}


// ── Runtime state ─────────────────────────────────────────────

let targetMidi     = null;
let audioCtx       = null;
let analyser       = null;
let micStream      = null;
let rafId          = null;
let listening      = false;
let smoothCents    = 0;
let lastDetected   = null;
let lastDetectedAt = 0;

const pcmBuf = new Float32Array(FRAME_SIZE * 2);


// ── YIN core ──────────────────────────────────────────────────

function differenceFunction(buf, W, tauMax, d) {
  for (let tau = 0; tau <= tauMax; tau++) {
    d[tau] = 0;
    for (let j = 0; j < W; j++) {
      const tmp = buf[j] - buf[j + tau];
      d[tau] += tmp * tmp;
    }
  }
}

function cmndf(d, tauMax) {
  d[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    d[tau] = runningSum > 0 ? d[tau] / (runningSum / tau) : 1;
  }
}

function absoluteThreshold(d, tauMin, tauMax, thresh) {
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (d[tau] < thresh) {
      while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
      return tau;
    }
  }
  let minTau = tauMin;
  for (let tau = tauMin + 1; tau <= tauMax; tau++) {
    if (d[tau] < d[minTau]) minTau = tau;
  }
  return minTau;
}

function parabolicInterpolation(d, tau, tauMax) {
  if (tau <= 0 || tau >= tauMax) return tau;
  const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
  const denom = s0 - 2 * s1 + s2;
  if (Math.abs(denom) < 1e-20) return tau;
  return tau + 0.5 * (s0 - s2) / denom;
}

function computeRms(buf, W) {
  let sumSq = 0;
  for (let i = 0; i < W; i++) sumSq += buf[i] * buf[i];
  return Math.sqrt(sumSq / W);
}

function yinDetect(buf) {
  const W      = FRAME_SIZE;
  const tauMin = Math.max(2, Math.ceil(SAMPLE_RATE / DETECTION.fMax));
  const tauMax = Math.floor(SAMPLE_RATE / DETECTION.fMin);
  const d      = new Float32Array(tauMax + 1);

  differenceFunction(buf, W, tauMax, d);
  cmndf(d, tauMax);

  const tauInt    = absoluteThreshold(d, tauMin, tauMax, DETECTION.yinThreshold);
  const tauHat    = parabolicInterpolation(d, tauInt, tauMax);
  const aperiodic = d[tauInt];
  const conf      = Math.max(0, Math.min(1, 1 - aperiodic));
  const f0        = tauHat > 0 ? SAMPLE_RATE / tauHat : 0;

  return { f0, confidence: conf };
}


// ── Music helpers ─────────────────────────────────────────────

function hzToMidi(hz) {
  return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : -1;
}

function midiToName(midi) {
  const pc  = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return { name: NOTE_NAMES[pc], octave: oct, full: NOTE_NAMES[pc] + oct };
}

function resolveTarget(midiFloat) {
  if (targetMidi !== null) return targetMidi;
  if (!activeStrings.length) return Math.round(midiFloat);
  let best = activeStrings[0].midi, bestDist = Math.abs(midiFloat - best);
  for (const s of activeStrings) {
    const dist = Math.abs(midiFloat - s.midi);
    if (dist < bestDist) { best = s.midi; bestDist = dist; }
  }
  return best;
}


// ── Audio pipeline ────────────────────────────────────────────

// gainNode is kept in module scope so setMicGain() can update it live
// without restarting the audio pipeline.
let gainNode = null;

async function startListening() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const src = audioCtx.createMediaStreamSource(micStream);

  // GainNode sits between the mic source and the analyser.
  // Boosting gain here amplifies the signal before any processing,
  // which is the most effective way to help quiet/distant microphones.
  gainNode = audioCtx.createGain();
  gainNode.gain.value = DETECTION.micGain;

  analyser  = audioCtx.createAnalyser();
  analyser.fftSize               = FRAME_SIZE * 2;
  analyser.smoothingTimeConstant = 0;

  // Chain: mic → gain → analyser
  src.connect(gainNode);
  gainNode.connect(analyser);

  listening = true; lastDetected = null; lastDetectedAt = 0;
  scheduleFrame();
}

/** Update the GainNode live — called by updateDetection when micGain changes. */
function _applyMicGain() {
  if (gainNode && audioCtx) {
    // Use setTargetAtTime for a smooth ramp instead of a click
    gainNode.gain.setTargetAtTime(DETECTION.micGain, audioCtx.currentTime, 0.05);
  }
}

function stopListening() {
  listening = false; calibrating = false;
  if (rafId)     { cancelAnimationFrame(rafId); rafId = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx)  { audioCtx.close(); audioCtx = null; }
  gainNode = null;
  smoothCents = 0; lastDetected = null;
}

async function toggleListening() {
  if (listening) { stopListening(); onTunerStop(); }
  else {
    try { await startListening(); onTunerStart(); }
    catch (err) { onMicError(err); }
  }
}


// ── Frame loop ────────────────────────────────────────────────

function scheduleFrame() {
  if (!listening) return;
  rafId = requestAnimationFrame(processFrame);
}

function processFrame() {
  if (!listening) return;

  analyser.getFloatTimeDomainData(pcmBuf);
  const energy = computeRms(pcmBuf.subarray(0, FRAME_SIZE), FRAME_SIZE);
  const now    = performance.now();

  if (calibrating) _calibrationTick(energy);

  // Broadcast raw RMS every frame so the level meter in Settings stays live
  onRmsUpdate(energy, DETECTION.rmsGate);

  if (energy < DETECTION.rmsGate) {
    if (lastDetected && (now - lastDetectedAt) < DETECTION.holdMs) {
      onPitchDetected({ ...lastDetected, held: true });
    } else {
      lastDetected = null;
      onSilence();
    }
    scheduleFrame();
    return;
  }

  const { f0, confidence } = yinDetect(pcmBuf);
  if (confidence < DETECTION.confThresh || f0 < DETECTION.fMin || f0 > DETECTION.fMax) {
    scheduleFrame();
    return;
  }

  const midiFloat = hzToMidi(f0);
  const refMidi   = resolveTarget(midiFloat);
  const cents     = (midiFloat - refMidi) * 100;
  smoothCents    += (cents - smoothCents) * DETECTION.smoothing;

  const noteInfo = midiToName(refMidi);
  const payload  = {
    frequency: f0, confidence,
    cents: smoothCents, rawCents: cents,
    midi: refMidi,
    note: noteInfo.name, octave: noteInfo.octave, noteWithOct: noteInfo.full,
    inTune: Math.abs(smoothCents) < 5,
    held: false,
  };

  lastDetected = payload; lastDetectedAt = now;
  onPitchDetected(payload);
  scheduleFrame();
}


// ── Mode & string selection ───────────────────────────────────

function setMode(newMode) {
  mode            = newMode;
  targetMidi      = null;
  activePresetKey = Object.keys(PRESETS[newMode].tunings)[0];
  activeStrings   = deepCopyStrings(PRESET_STRINGS(newMode, activePresetKey));
  onModeChanged(newMode, PRESETS[newMode], activeStrings, activePresetKey);
}

function selectString(midi) {
  targetMidi = (targetMidi === midi) ? null : midi;
  onStringSelected(targetMidi);
}

function getCurrentStrings() { return activeStrings; }
function getCurrentPresets() { return PRESETS[mode]; }

function noteRange(midiLow, midiHigh) {
  const out = [];
  for (let m = midiLow; m <= midiHigh; m++) out.push({ midi: m, note: midiToName(m).full });
  return out;
}
const STRING_NOTE_OPTIONS = noteRange(12, 84);


// ── Callbacks ─────────────────────────────────────────────────

function onPitchDetected(data)  { /* override */ }
function onSilence()            { /* override */ }
function onTunerStart()         { /* override */ }
function onTunerStop()          { /* override */ }
function onMicError(err)        { console.error('Mic error:', err); }
function onModeChanged(m,p,s,k) { /* override */ }
function onTuningChanged(s,k)   { /* override */ }
function onStringSelected(midi) { /* override */ }

/** Called every frame. Use to drive the level meter.
 *  @param {number} rms current frame RMS
 *  @param {number} gateLevel current DETECTION.rmsGate */
function onRmsUpdate(rms, gateLevel) { /* override */ }

/** Called when any detection param changes.
 *  @param {object} params full copy of DETECTION */
function onDetectionChanged(params) { /* override */ }

/** @param {number} durationMs */
function onCalibrationStart(durationMs) { /* override */ }

/** @param {number} progress 0–1 */
function onCalibrationProgress(progress) { /* override */ }

/** @param {number} newGate @param {number} noiseFloor */
function onCalibrationDone(newGate, noiseFloor) { /* override */ }

/** @param {string} msg */
function onCalibrationError(msg) { /* override */ }
