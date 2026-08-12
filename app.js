import { analyzeRecording, getMethodologyHtml } from './analysis.js?v=18';
import { t, initI18n } from './i18n.js?v=18';

const micSelect = document.getElementById('mic-select');
const permissionBtn = document.getElementById('permission-btn');
const rawModeCheck = document.getElementById('raw-mode');
const recordBtn = document.getElementById('record-btn');
const recordStatus = document.getElementById('record-status');
const waveformCanvas = document.getElementById('waveform');
const levelBar = document.getElementById('level-bar');
const resultCard = document.getElementById('result-card');
const retryBtn = document.getElementById('retry-btn');

const RECORD_SECONDS = 8;      // recording length before auto-stop
const SILENCE_GUIDE_SEC = 1.5; // initial "stay quiet" guidance period

let audioContext = null;
let mediaStream = null;
let recording = false;  // for the UI (guidance text, draw loop)
let capturing = false;  // for chunk collection (keeps accepting in-flight chunks after stop)
let chunks = [];
let recordStartTime = 0;
let animationId = 0;
let analyserNode = null;
let stopTimer = 0;

// ---------- Microphone enumeration ----------

async function requestPermissionAndList() {
  try {
    // Device labels are only available after permission has been granted once.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await refreshDeviceList();
    permissionBtn.classList.add('hidden');
    recordBtn.disabled = false;
    startMonitor();
  } catch (err) {
    recordStatus.textContent = t('err_denied', { msg: err.message });
  }
}

const MIC_STORAGE_KEY = 'mic-quality-check:deviceId';

async function refreshDeviceList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const current = micSelect.value;
  micSelect.innerHTML = '';
  for (const mic of mics) {
    const opt = document.createElement('option');
    opt.value = mic.deviceId;
    opt.textContent = mic.label || t('mic_fallback', { id: mic.deviceId.slice(0, 8) });
    micSelect.appendChild(opt);
  }
  // Priority: current selection > previously saved selection > first device.
  const saved = localStorage.getItem(MIC_STORAGE_KEY);
  if (current && mics.some((m) => m.deviceId === current)) {
    micSelect.value = current;
  } else if (saved && mics.some((m) => m.deviceId === saved)) {
    micSelect.value = saved;
  }
  micSelect.disabled = mics.length === 0;
}

micSelect.addEventListener('change', () => {
  if (micSelect.value) localStorage.setItem(MIC_STORAGE_KEY, micSelect.value);
  restartMonitor();
});
rawModeCheck.addEventListener('change', restartMonitor);

navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList);

function buildConstraints() {
  return {
    audio: {
      deviceId: micSelect.value ? { exact: micSelect.value } : undefined,
      echoCancellation: !rawModeCheck.checked,
      noiseSuppression: !rawModeCheck.checked,
      autoGainControl: !rawModeCheck.checked,
      channelCount: 1,
    },
  };
}

// ---------- Live monitor (visualizer active before recording) ----------

let monitorCtx = null;
let monitorStream = null;
let monitorAnimId = 0;

async function startMonitor() {
  if (recording || monitorCtx) return;
  try {
    monitorStream = await navigator.mediaDevices.getUserMedia(buildConstraints());
  } catch {
    return; // device busy or denied — just skip monitoring
  }
  // Recording may have started while getUserMedia was pending.
  if (recording || monitorCtx) {
    monitorStream.getTracks().forEach((tr) => tr.stop());
    monitorStream = null;
    return;
  }
  monitorCtx = new AudioContext();
  if (monitorCtx.state === 'suspended') {
    // Without a user gesture (e.g. permission remembered from a previous visit),
    // the context starts suspended — resume on the first interaction.
    const resume = () => { if (monitorCtx) monitorCtx.resume(); };
    document.addEventListener('pointerdown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }
  const source = monitorCtx.createMediaStreamSource(monitorStream);
  analyserNode = monitorCtx.createAnalyser();
  analyserNode.fftSize = 4096;
  analyserNode.smoothingTimeConstant = 0.72;
  initSpectrumBars(monitorCtx.sampleRate);
  source.connect(analyserNode);
  monitorLoop();
}

function stopMonitor() {
  cancelAnimationFrame(monitorAnimId);
  if (monitorStream) {
    monitorStream.getTracks().forEach((tr) => tr.stop());
    monitorStream = null;
  }
  if (monitorCtx) {
    monitorCtx.close();
    monitorCtx = null;
  }
}

function restartMonitor() {
  if (recording) return;
  stopMonitor();
  startMonitor();
}

function monitorLoop() {
  if (!monitorCtx || recording) return;
  drawFrame();
  monitorAnimId = requestAnimationFrame(monitorLoop);
}

// ---------- Recording ----------

async function startRecording() {
  // Release the monitor stream first — the device may not open twice.
  stopMonitor();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia(buildConstraints());
  } catch (err) {
    recordStatus.textContent = t('err_open', { msg: err.message });
    startMonitor();
    return;
  }

  // Recreate the AudioContext per recording (the worklet module must be re-registered too).
  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule('recorder-worklet.js');

  const source = audioContext.createMediaStreamSource(mediaStream);
  const recorder = new AudioWorkletNode(audioContext, 'recorder-processor');
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 4096; // low-frequency resolution for the spectrum display
  analyserNode.smoothingTimeConstant = 0.72;
  initSpectrumBars(audioContext.sampleRate);

  chunks = [];
  capturing = true;
  recorder.port.onmessage = (e) => {
    if (capturing) chunks.push(e.data);
  };

  source.connect(recorder);
  source.connect(analyserNode);
  // The recorder node produces no output (no need to route silence to the destination).

  recording = true;
  recordStartTime = performance.now();
  recordBtn.textContent = t('btn_stop');
  recordBtn.classList.add('recording');
  resultCard.classList.add('hidden');

  drawLoop();
  stopTimer = setTimeout(stopRecording, RECORD_SECONDS * 1000);
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  clearTimeout(stopTimer);
  cancelAnimationFrame(animationId);

  recordBtn.textContent = t('btn_record');
  recordBtn.classList.remove('recording');
  recordBtn.disabled = true;
  recordStatus.textContent = t('status_analyzing');
  levelBar.style.width = '0%';

  // Collect in-flight worklet messages before closing.
  await new Promise((r) => setTimeout(r, 80));
  capturing = false;
  const sampleRate = audioContext.sampleRate;
  mediaStream.getTracks().forEach((t) => t.stop());
  await audioContext.close();

  // Concatenate chunks.
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const samples = new Float32Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    samples.set(c, offset);
    offset += c.length;
  }
  chunks = [];

  if (totalLen < sampleRate * 2) {
    recordStatus.textContent = t('err_short');
    recordBtn.disabled = false;
    startMonitor();
    return;
  }

  // Analyze (not heavy, but let the UI update paint first).
  await new Promise((r) => setTimeout(r, 30));
  let result;
  try {
    result = analyzeRecording(samples, sampleRate);
  } catch (err) {
    // The analysis module throws i18n keys (t() returns unknown keys verbatim).
    recordStatus.textContent = t('err_analysis', { msg: t(err.message) });
    recordBtn.disabled = false;
    startMonitor();
    return;
  }

  renderResult(result, samples, sampleRate);
  recordStatus.textContent = '';
  recordBtn.disabled = false;
  startMonitor();
}

// ---------- Live drawing ----------

// Log-scale frequency bars: precompute the FFT bin range each bar covers.
const NUM_BARS = 64;
const BAR_MIN_HZ = 50;
const BAR_MAX_HZ = 16000;
let barBins = [];        // [ [startBin, endBin], ... ]
let barPeaks = new Float32Array(NUM_BARS);  // peak-hold values (0-1)
let barHues = [];

function initSpectrumBars(sampleRate) {
  const binHz = sampleRate / analyserNode.fftSize;
  const maxHz = Math.min(BAR_MAX_HZ, sampleRate / 2);
  barBins = [];
  barHues = [];
  for (let i = 0; i < NUM_BARS; i++) {
    const f0 = BAR_MIN_HZ * Math.pow(maxHz / BAR_MIN_HZ, i / NUM_BARS);
    const f1 = BAR_MIN_HZ * Math.pow(maxHz / BAR_MIN_HZ, (i + 1) / NUM_BARS);
    const b0 = Math.max(1, Math.floor(f0 / binHz));
    const b1 = Math.max(b0, Math.floor(f1 / binHz));
    barBins.push([b0, b1]);
    // Lows = teal → mids = blue → highs = violet/pink.
    barHues.push(170 + (i / NUM_BARS) * 130);
  }
  barPeaks.fill(0);
}

function drawSpectrum(ctx, w, h) {
  const freqData = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(freqData);

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, w, h);

  const gap = 2;
  const barW = (w - gap * (NUM_BARS - 1)) / NUM_BARS;

  for (let i = 0; i < NUM_BARS; i++) {
    const [b0, b1] = barBins[i];
    let maxV = 0;
    for (let b = b0; b <= b1 && b < freqData.length; b++) {
      if (freqData[b] > maxV) maxV = freqData[b];
    }
    const v = maxV / 255;

    // Peak hold: rise instantly, fall slowly.
    if (v > barPeaks[i]) barPeaks[i] = v;
    else barPeaks[i] = Math.max(0, barPeaks[i] - 0.012);

    const x = i * (barW + gap);
    const barH = Math.max(2, v * (h - 8));
    const hue = barHues[i];

    // Bar body: darker at the base, brighter at the top.
    const grad = ctx.createLinearGradient(0, h, 0, h - barH);
    grad.addColorStop(0, `hsl(${hue} 75% 38%)`);
    grad.addColorStop(1, `hsl(${hue} 95% ${55 + v * 20}%)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, h - barH, barW, barH, 2);
    ctx.fill();

    // Peak cap.
    if (barPeaks[i] > 0.02) {
      const py = h - Math.max(2, barPeaks[i] * (h - 8)) - 3;
      ctx.fillStyle = `hsl(${hue} 100% 78% / 0.9)`;
      ctx.fillRect(x, py, barW, 2);
    }
  }

  // Overlay a faint waveform on top.
  const buf = new Float32Array(1024);
  analyserNode.getFloatTimeDomainData(buf);
  ctx.strokeStyle = 'rgba(232, 236, 244, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < buf.length; i++) {
    const x = (i / buf.length) * w;
    const y = h / 2 + buf[i] * (h / 2) * 0.85;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// One visualizer frame: spectrum + waveform overlay + level meter.
// Shared by the recording loop and the idle monitor loop.
function drawFrame() {
  const ctx = waveformCanvas.getContext('2d');
  drawSpectrum(ctx, waveformCanvas.width, waveformCanvas.height);

  // Level meter (RMS → dBFS).
  const buf = new Float32Array(2048);
  analyserNode.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  const db = 20 * Math.log10(rms + 1e-10);
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  levelBar.style.width = `${pct}%`;
}

function drawLoop() {
  if (!recording) return;
  const elapsed = (performance.now() - recordStartTime) / 1000;
  const remain = Math.max(0, RECORD_SECONDS - elapsed).toFixed(0);

  if (elapsed < SILENCE_GUIDE_SEC) {
    recordStatus.textContent = t('status_quiet', { s: remain });
  } else {
    recordStatus.textContent = t('status_speak', { s: remain });
  }

  drawFrame();
  animationId = requestAnimationFrame(drawLoop);
}

// ---------- Result rendering ----------

function verdictClass(rating) {
  return { excellent: 'excellent', good: 'good', fair: 'fair', poor: 'poor' }[rating] || 'fair';
}

// Keep the last analysis result so the view can re-render on language switch.
let lastRender = null;

// Emoji suffix for the overall verdict only (metric badges stay clean).
const RATING_EMOJI = { excellent: ' 🎉', good: ' 🎉', fair: ' 💪', poor: ' 🌱' };

// Confetti for good/excellent overall results. Lightweight canvas overlay,
// self-removing. "excellent" gets the big show: a center burst plus two
// follow-up side cannons, more and larger pieces, longer lifetime.
function celebrate(rating) {
  const big = rating === 'excellent';
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const colors = ['#0ca30c', '#3987e5', '#fab219', '#d55181', '#9085e9', '#34c98e'];
  const parts = [];
  const life = big ? 3.4 : 2.6; // per-particle fade time [s]

  function burst(cx, cy, count, vxBase, vxSpread, scale) {
    const born = performance.now();
    for (let i = 0; i < count; i++) {
      parts.push({
        x: cx + (Math.random() - 0.5) * cv.width * 0.05,
        y: cy,
        vx: vxBase + (Math.random() - 0.5) * vxSpread,
        vy: -7 - Math.random() * 10 * scale,
        w: (5 + Math.random() * 6) * scale,
        h: (8 + Math.random() * 8) * scale,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: colors[i % colors.length],
        born,
      });
    }
  }

  // Center burst (wider spawn area for the modest version).
  if (big) {
    burst(cv.width / 2, cv.height * 0.35, 220, 0, 22, 1.25);
    setTimeout(() => burst(cv.width * 0.04, cv.height * 0.7, 110, 9, 8, 1.1), 400);  // left cannon →
    setTimeout(() => burst(cv.width * 0.96, cv.height * 0.7, 110, -9, 8, 1.1), 800); // right cannon ←
  } else {
    burst(cv.width / 2, cv.height * 0.35, 140, 0, 14, 1);
  }

  const totalSec = big ? 4.8 : 2.8;
  const t0 = performance.now();
  requestAnimationFrame(function tick(now) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      const age = (now - p.born) / 1000;
      if (age < 0 || age > life) continue;
      p.vy += 0.28;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.vx *= 0.99;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if ((now - t0) / 1000 < totalSec) requestAnimationFrame(tick);
    else cv.remove();
  });
}

let playbackUrls = { raw: null, normalized: null };

function setPlaybackSource() {
  const playback = document.getElementById('playback');
  const normalize = document.getElementById('normalize-playback').checked;
  const url = normalize ? playbackUrls.normalized : playbackUrls.raw;
  if (url && playback.src !== url) {
    const pos = playback.currentTime;
    playback.src = url;
    playback.currentTime = pos;
  }
}

function renderResult(result, samples, sampleRate, { scroll = true } = {}) {
  lastRender = { result, samples, sampleRate };
  resultCard.classList.remove('hidden');

  const ring = document.getElementById('score-ring');
  const score = Math.round(result.overallScore);
  document.getElementById('overall-score').textContent = score;
  ring.className = `score-ring ${verdictClass(result.overallRating)}`;
  ring.style.setProperty('--p', score);
  document.getElementById('overall-label').textContent =
    t(`rating_${result.overallRating}`) + (RATING_EMOJI[result.overallRating] || '');
  document.getElementById('overall-desc').textContent = t('overall_desc', {
    mos: result.mos.toFixed(2),
    desc: t(`desc_${result.overallRating}`),
  });

  // Playback WAV: a properly-leveled recording (≈ -18 dBFS) still sounds quiet compared
  // to typical media, so play a version normalized to -1 dBFS peak by default.
  for (const key of Object.keys(playbackUrls)) {
    if (playbackUrls[key]) URL.revokeObjectURL(playbackUrls[key]);
  }
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0.001 ? Math.min(0.89 / peak, 30) : 1;
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) normalized[i] = samples[i] * gain;

  playbackUrls = {
    raw: URL.createObjectURL(encodeWav(samples, sampleRate)),
    normalized: URL.createObjectURL(encodeWav(normalized, sampleRate)),
  };
  const playback = document.getElementById('playback');
  playback.removeAttribute('src');
  setPlaybackSource();

  // Individual metrics.
  const grid = document.getElementById('metrics-grid');
  grid.innerHTML = '';
  for (const m of result.metrics) {
    const valueParams = { ...(m.value.params || {}) };
    if (m.value.labelKey) valueParams.label = t(m.value.labelKey);
    const valueText = t(m.value.key, valueParams);
    const noteText = t(m.note.key, m.note.params) + (m.note.extra ? ' ' + t(m.note.extra) : '');

    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = `
      <div class="metric-head">
        <span class="metric-name">${t(m.nameKey)}</span>
        <span class="badge ${verdictClass(m.rating)}">${t(`rating_${m.rating}`)}</span>
      </div>
      <div class="metric-value-row">
        <span class="metric-value">${valueText}</span>
        <span class="metric-score">${t('points', { n: Math.round(m.score) })}</span>
      </div>
      <div class="metric-bar-bg">
        <div class="metric-bar ${verdictClass(m.rating)}" style="width:${Math.max(3, m.score)}%"></div>
      </div>
      <div class="metric-note">${noteText}</div>
    `;
    grid.appendChild(card);
  }

  // Improvement tips.
  const list = document.getElementById('advice-list');
  list.innerHTML = '';
  const advices = result.advice.length > 0 ? result.advice : [{ key: 'adv_ok', ok: true }];
  for (const a of advices) {
    const li = document.createElement('li');
    if (a.ok) li.classList.add('ok');
    const text = t(a.key, a.params);
    li.innerHTML = a.metric ? `<span class="advice-metric">${t(a.metric)}:</span> ${text}` : text;
    list.appendChild(li);
  }

  if (scroll) {
    resultCard.scrollIntoView({ behavior: 'smooth' });
    // Fresh result only (not a language-switch re-render).
    if (result.overallRating === 'excellent' || result.overallRating === 'good') {
      celebrate(result.overallRating);
    }
  }
}

// ---------- WAV encoding ----------

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// ---------- Events ----------

permissionBtn.addEventListener('click', requestPermissionAndList);
recordBtn.addEventListener('click', () => (recording ? stopRecording() : startRecording()));
document.getElementById('normalize-playback').addEventListener('change', setPlaybackSource);
retryBtn.addEventListener('click', () => {
  resultCard.classList.add('hidden');
  document.getElementById('record-card').scrollIntoView({ behavior: 'smooth' });
});

// i18n init: apply static texts + refresh dynamic texts on language switch.
initI18n(() => {
  document.getElementById('methodology').innerHTML = getMethodologyHtml();
  if (recording) recordBtn.textContent = t('btn_stop');
  if (lastRender && !resultCard.classList.contains('hidden')) {
    renderResult(lastRender.result, lastRender.samples, lastRender.sampleRate, { scroll: false });
  }
});
document.getElementById('methodology').innerHTML = getMethodologyHtml();

// If permission was already granted, populate the device list on page load
// and start the idle monitor right away.
(async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some((d) => d.kind === 'audioinput' && d.label)) {
      await refreshDeviceList();
      permissionBtn.classList.add('hidden');
      recordBtn.disabled = false;
      startMonitor();
    }
  } catch { /* noop */ }
})();
