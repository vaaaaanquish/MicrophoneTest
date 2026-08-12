import { getLang } from './i18n.js?v=16';

// Speech quality analysis module.
// Metrics and thresholds are based on the literature and standards summarized in docs/RESEARCH.md:
//   - Noise: VAD-based blind SNR (NIST STNR / snreval SNR_VAD family), thresholds 30/20/10 dB
//   - Reverb: blind RT60 from free-decay slopes (Ratnam 2003 / ISO 3382 T20 approach),
//     thresholds from room-design standards ANSI S12.60 / WELL v2 (0.3/0.5/0.7 s)
//   - Level: ITU-T P.56-style active speech level, thresholds from EBU R128 / podcast practice (≈ -20 to -14 LUFS)
//   - Clipping: clipped-sample ratio; 0.5% already degrades speaker recognition (Speech Communication 2021)
//   - Spectrum: effective bandwidth (G.711/G.722 templates) + alpha ratio (Byrne 1994 LTASS)
//   - Overall: G.107 E-model-style weighted 0-100 score + weakest-link cap; MOS via the G.107 formula

// ---------- Utilities ----------

function db(x) {
  return 20 * Math.log10(Math.max(x, 1e-10));
}

function powerDb(x) {
  return 10 * Math.log10(Math.max(x, 1e-12));
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

// Piecewise-linear interpolation over control points [[value, score], ...] (ascending by value).
// Values outside the range clamp to the end scores.
function interpScore(value, points) {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (value <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

// Real-input FFT (radix-2 Cooley-Tukey). Returns the magnitude spectrum (first half only).
function fftMag(signal) {
  const n = signal.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(signal);

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

// ---------- Framing and voice activity detection ----------

const FRAME_MS = 25;
const HOP_MS = 10;

function frameSignal(samples, sampleRate) {
  const frameLen = Math.round((FRAME_MS / 1000) * sampleRate);
  const hopLen = Math.round((HOP_MS / 1000) * sampleRate);
  const frames = [];
  for (let start = 0; start + frameLen <= samples.length; start += hopLen) {
    frames.push({ start, len: frameLen });
  }
  return { frames, frameLen, hopLen };
}

function frameRmsDb(samples, frame) {
  let sum = 0;
  for (let i = frame.start; i < frame.start + frame.len; i++) sum += samples[i] * samples[i];
  return db(Math.sqrt(sum / frame.len));
}

// Simple energy-based VAD:
// frames above noise floor (lower percentile) + margin count as speech (snreval SNR_VAD family).
function detectActivity(frameDbs) {
  const sorted = [...frameDbs].sort((a, b) => a - b);
  const noiseFloorDb = percentile(sorted, 0.1);
  const peakDb = percentile(sorted, 0.95);
  const threshold = Math.max(noiseFloorDb + 10, peakDb - 30);
  const isSpeech = frameDbs.map((d) => d > threshold);
  return { isSpeech, noiseFloorDb, threshold };
}

// ---------- Metrics ----------

// Blind SNR: mean speech-frame power vs mean noise-frame power.
function computeSnr(samples, frames, isSpeech) {
  let speechPow = 0, speechN = 0, noisePow = 0, noiseN = 0;
  frames.forEach((f, i) => {
    let sum = 0;
    for (let j = f.start; j < f.start + f.len; j++) sum += samples[j] * samples[j];
    const p = sum / f.len;
    if (isSpeech[i]) { speechPow += p; speechN++; }
    else { noisePow += p; noiseN++; }
  });
  if (speechN === 0 || noiseN === 0) return null;
  return {
    snr: powerDb(speechPow / speechN) - powerDb(noisePow / noiseN),
    noiseLevelDb: powerDb(noisePow / noiseN),
  };
}

// Active speech level (simplified ITU-T P.56: RMS over speech frames only).
function computeSpeechLevel(samples, frames, isSpeech) {
  let sum = 0, n = 0;
  frames.forEach((f, i) => {
    if (!isSpeech[i]) return;
    for (let j = f.start; j < f.start + f.len; j++) sum += samples[j] * samples[j];
    n += f.len;
  });
  if (n === 0) return null;
  return db(Math.sqrt(sum / n));
}

// Clipping ratio: share of samples near full scale [%].
function computeClipping(samples) {
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= 0.985) clipped++;
  }
  return (clipped / samples.length) * 100;
}

// Blind reverb estimation:
// extrapolates RT60 from the slope of the early part (peak -3 dB to -25 dB) of energy
// decay curves after speech offsets (same idea as ISO 3382 T20/T30 and Ratnam 2003).
// - Excludes the flat region near the noise floor, which would bias the estimate upward
// - Uses only peaks that reach near the active speech level as decay origins,
//   because ripples inside a reverb tail produce spurious fast decays (underestimation)
function estimateReverb(frameDbs, noiseFloorDb, speechLevelDb, hopMs) {
  const decays = [];
  const minPeakDb = Math.max(noiseFloorDb + 25, speechLevelDb - 8);
  const floorLimit = noiseFloorDb + 8;

  for (let i = 1; i < frameDbs.length - 3; i++) {
    if (frameDbs[i] < minPeakDb) continue;
    if (frameDbs[i] < frameDbs[i - 1] || frameDbs[i] < frameDbs[i + 1]) continue;

    const peakDb = frameDbs[i];
    const fitTop = peakDb - 3;
    const fitBottom = Math.max(peakDb - 25, floorLimit);
    if (fitTop - fitBottom < 8) continue;

    // Follow the decay forward from the peak (small rebounds allowed, stop on a clear rise).
    const pts = [];
    let j = i + 1;
    let prev = peakDb;
    while (j < frameDbs.length && pts.length < 60) {
      const v = frameDbs[j];
      if (v > prev + 4) break;
      if (v <= fitTop && v >= fitBottom) pts.push([(j - i) * hopMs, v]);
      if (v < fitBottom) break;
      prev = Math.max(prev - 0.5, v);
      j++;
    }
    if (pts.length < 3) continue;
    const spanDb = pts[0][1] - pts[pts.length - 1][1];
    if (spanDb < 8) continue;

    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
    const m = pts.length;
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx); // dB/ms
    if (slope < -0.005) {
      const rt60ms = -60 / slope;
      if (rt60ms > 50 && rt60ms < 3000) decays.push(rt60ms);
    }
    i = j;
  }

  if (decays.length === 0) return null;
  decays.sort((a, b) => a - b);
  // The steep cutoff of the direct sound biases estimates low, so take an upper percentile.
  return { rt60: percentile(decays, 0.7) / 1000, eventCount: decays.length };
}

// RT60 to C50 (clarity index) conversion via the Polack exponential-decay model.
function rt60ToC50(rt60) {
  return 10 * Math.log10(Math.exp((13.8 * 0.05) / rt60) - 1);
}

// ---------- Deep reverb diagnostics (experimental, local branch only) ----------

// dB envelope of a frequency band on the shared frame grid.
// Two cascaded RBJ biquad bandpasses (~24 dB/oct skirts) — steep edges matter here:
// a long low-band tail leaking into the high band would dominate its late decay
// and inflate the high-band RT60 estimate.
function bandFrameDbs(samples, sampleRate, frames, f1, f2) {
  const f0 = Math.sqrt(f1 * f2);
  const Q = f0 / (f2 - f1);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0;

  let band = samples;
  for (let pass = 0; pass < 2; pass++) {
    const y = new Float32Array(samples.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < band.length; i++) {
      const x = band[i];
      const v = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x;
      y2 = y1; y1 = v;
      y[i] = v;
    }
    band = y;
  }
  return frames.map((f) => frameRmsDb(band, f));
}

// Subband RT60: furniture/curtains absorb mid-high frequencies selectively, so a
// high/low RT60 ratio ≥ 1 suggests a bare/hard room, < 0.8 a low-heavy (large) room.
function subbandReverb(samples, sampleRate, frames) {
  const out = {};
  for (const [key, f1, f2] of [['low', 250, 800], ['high', 1500, 4000]]) {
    const dbs = bandFrameDbs(samples, sampleRate, frames, f1, f2);
    const sorted = [...dbs].sort((a, b) => a - b);
    const r = estimateReverb(dbs, percentile(sorted, 0.1), percentile(sorted, 0.95), HOP_MS);
    // Require several decay events per band — single-event estimates carry
    // enough variance to flip the room-type diagnosis.
    out[key] = r && r.eventCount >= 4 ? r.rt60 : null;
  }
  return out;
}

// DRR estimate from the level drop 80 ms after decay-origin peaks.
// Physics: running speech sits at direct+reverb; at the offset the direct part
// vanishes, so drop(80ms) = 10·log10(1 + 10^(DRR/10)) + tail decay over 80 ms.
// Inverting gives a rough direct-to-reverberant ratio.
function estimateDrr(frameDbs, speechLevelDb, rt60) {
  const drops = [];
  for (let i = 1; i < frameDbs.length - 30; i++) {
    if (frameDbs[i] < speechLevelDb - 6) continue;
    // True offset anchor: the LAST high-level frame — everything in the next
    // 80 ms stays below it (mid-burst peaks would still be followed by speech).
    let falling = true;
    for (let j = i + 1; j <= i + 8; j++) {
      if (frameDbs[j] > frameDbs[i] - 2) { falling = false; break; }
    }
    if (!falling) continue;
    // And a deep sustained fall follows (not a syllabic dip).
    let minv = Infinity;
    for (let j = i + 1; j <= i + 30; j++) minv = Math.min(minv, frameDbs[j]);
    if (frameDbs[i] - minv < 12) continue;
    drops.push(frameDbs[i] - frameDbs[i + 8]); // drop at +80 ms
    i += 30;
  }
  if (drops.length < 3) return null;
  drops.sort((a, b) => a - b);
  const medianDrop = percentile(drops, 0.5);
  const x = medianDrop - (60 * 0.08) / rt60; // remove expected tail decay
  return 10 * Math.log10(Math.max(Math.pow(10, x / 10) - 1, 0.01));
}

// Near-reflection detection: a strong single reflection at delay τ imprints a comb
// ripple on the speech LTAS; correlate the log spectrum with cos(2πfτ).
// τ is limited to 0.8-3.5 ms (below the voice-pitch quefrency, 1/F0 ≥ ~4 ms),
// i.e. reflectors within ~60 cm such as the desk surface or a monitor.
function detectNearReflection(ltas) {
  if (!ltas) return null;
  const { speechSpec, binHz } = ltas;
  const b0 = Math.ceil(150 / binHz);
  const b1 = Math.floor(6000 / binHz);
  const logs = [];
  let mean = 0;
  for (let b = b0; b <= b1; b++) {
    const v = Math.log(speechSpec[b] + 1e-20);
    logs.push(v);
    mean += v;
  }
  mean /= logs.length;

  // Correlate over a wider range (0.8-8 ms) for baseline statistics,
  // but only accept peaks in the pitch-safe 0.8-3.5 ms window.
  const vals = [];
  for (let tau = 0.8; tau <= 8; tau += 0.05) {
    let c = 0;
    for (let k = 0; k < logs.length; k++) {
      c += (logs[k] - mean) * Math.cos((2 * Math.PI * (b0 + k) * binHz * tau) / 1000);
    }
    vals.push([tau, c / logs.length]);
  }
  const m = vals.reduce((s, v) => s + v[1], 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v[1] - m) ** 2, 0) / vals.length);
  let best = null;
  for (const [tau, c] of vals) {
    if (tau > 3.5) break;
    if (!best || c > best.c) best = { tau, c };
  }
  if (!best || sd === 0) return null;
  return { tauMs: best.tau, z: (best.c - m) / sd };
}

// Dropout detection (proxy for NISQA's Discontinuity dimension; approach of US patent 11183202):
// (a) constant runs: strictly zero sample-to-sample differences lasting ≥2 ms
//     (zero-fill or constant-fill buffer underruns)
// (b) envelope breaks: 2 ms-window RMS falling sharply and recovering within 100 ms
//     (dropouts that don't reach digital zero)
// To avoid false positives from silence gates, only "holes inside signal" count:
// the 100 ms on both sides must be at active level.
function detectDropouts(samples, sampleRate, noiseFloorDb) {
  const events = [];
  const guard = Math.round(0.1 * sampleRate); // activity-check window on both sides
  const activeDb = noiseFloorDb + 10;

  const isActiveAround = (start, end) => {
    let maxBefore = 0, maxAfter = 0;
    for (let i = Math.max(0, start - guard); i < start; i++) maxBefore = Math.max(maxBefore, Math.abs(samples[i]));
    for (let i = end; i < Math.min(samples.length, end + guard); i++) maxAfter = Math.max(maxAfter, Math.abs(samples[i]));
    return db(maxBefore) > activeDb && db(maxAfter) > activeDb;
  };

  // (a) Constant runs (skip the first 300 ms and last 100 ms — stream startup/teardown
  // can legitimately contain zeros).
  const minRun = Math.round(0.002 * sampleRate);
  const headSkip = Math.round(0.3 * sampleRate);
  const tailSkip = samples.length - Math.round(0.1 * sampleRate);
  let run = 0, runStart = 0;
  for (let i = headSkip + 1; i < tailSkip; i++) {
    if (samples[i] === samples[i - 1]) {
      if (run === 0) runStart = i - 1;
      run++;
    } else {
      if (run >= minRun && isActiveAround(runStart, i)) events.push(runStart);
      run = 0;
    }
  }

  // (b) Envelope breaks: to distinguish from speech pauses (which bottom out at the
  // acoustic noise floor), require the dip to sink at least 10 dB BELOW the noise floor
  // (i.e. a transport-level hole) and recover within 100 ms (word pauses last hundreds of ms).
  const win = Math.round(0.002 * sampleRate);
  const env = [];
  for (let s = 0; s + win <= samples.length; s += win) {
    let sum = 0;
    for (let i = s; i < s + win; i++) sum += samples[i] * samples[i];
    env.push(db(Math.sqrt(sum / win)));
  }
  const holeDb = noiseFloorDb - 10;
  const recoverBlocks = Math.round(0.1 / 0.002);
  for (let i = 1; i < env.length; i++) {
    if (env[i - 1] - env[i] >= 25 && env[i - 1] > activeDb && env[i] < holeDb) {
      for (let j = i + 1; j < Math.min(env.length, i + recoverBlocks); j++) {
        if (env[j] >= env[i - 1] - 10) {
          const start = i * win;
          // Merge with events from (a) within 50 ms.
          if (!events.some((e) => Math.abs(e - start) < 0.05 * sampleRate)) events.push(start);
          i = j;
          break;
        }
      }
    }
  }

  return events.length;
}

// Goertzel algorithm: power (mean square) at a single frequency.
function goertzelMsq(samples, sampleRate, freq) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const p = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  // For a sine of amplitude A, p ≈ (A·N/2)^2 → normalize to mean square A^2/2.
  return (p * 2) / (samples.length * samples.length);
}

// Mains hum detection (simplified version of Fraunhofer Brandt & Bitzer / Dolby WO2022023415A1):
// scan the fundamental of the 50 Hz and 60 Hz families over ±3% on the longest contiguous
// silent stretch, and report hum when ≥3 harmonics exceed the local floor by +10 dB.
function detectHum(samples, sampleRate, frames, isSpeech, hopLen) {
  // Find the longest contiguous non-speech stretch (concatenating segments would smear
  // the tone due to phase discontinuities, so a contiguous region is required).
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < isSpeech.length; i++) {
    if (!isSpeech[i]) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curLen = 0;
    }
  }
  const minSamples = Math.round(0.8 * sampleRate);
  if (bestStart < 0) return { ok: false };
  const s0 = frames[bestStart].start;
  const s1 = Math.min(samples.length, frames[bestStart].start + bestLen * hopLen);
  if (s1 - s0 < minSamples) return { ok: false };
  const noise = samples.subarray(s0, s1);

  let best = null;
  for (const family of [50, 60]) {
    // Scan the fundamental over ±3% (pick the f0 maximizing the total power of harmonics 1-4).
    let f0Best = family, f0Pow = -Infinity;
    for (let f0 = family * 0.97; f0 <= family * 1.03; f0 += 0.25) {
      let pow = 0;
      for (let k = 1; k <= 4; k++) pow += goertzelMsq(noise, sampleRate, f0 * k);
      if (pow > f0Pow) { f0Pow = pow; f0Best = f0; }
    }
    // Measure harmonics k=1..8 individually against a local floor
    // (median of nearby off-harmonic frequencies).
    let strongCount = 0, humPow = 0;
    for (let k = 1; k <= 8; k++) {
      const fk = f0Best * k;
      if (fk > sampleRate / 2 - 100) break;
      const hk = goertzelMsq(noise, sampleRate, fk);
      const floors = [fk - 13, fk - 7, fk + 7, fk + 13]
        .map((f) => goertzelMsq(noise, sampleRate, f))
        .sort((a, b) => a - b);
      const floor = (floors[1] + floors[2]) / 2;
      if (hk > floor * 10) { // +10dB
        strongCount++;
        humPow += hk;
      }
    }
    if (strongCount >= 3 && (!best || humPow > best.humPow)) {
      best = { family, humPow, strongCount };
    }
  }

  if (!best) return { ok: true, detected: false };
  return { ok: true, detected: true, family: best.family, humDb: powerDb(best.humPow) };
}

// True Peak (ITU-R BS.1770-5 Annex 2 approach):
// max absolute value after 4x oversampling (48-tap, 4-phase windowed-sinc FIR).
function computeTruePeak(samples) {
  const PHASES = 4, TAPS_PER_PHASE = 12;
  // Generate per-phase taps (Hann-windowed sinc). Phase 0 is the original samples.
  const phaseTaps = [];
  const total = PHASES * TAPS_PER_PHASE;
  const center = (total - 1) / 2;
  for (let p = 1; p < PHASES; p++) {
    const taps = [];
    let sum = 0;
    for (let j = 0; j < TAPS_PER_PHASE; j++) {
      const n = j * PHASES + p;
      const x = (n - center) / PHASES;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (total - 1));
      const v = sinc * w;
      taps.push(v);
      sum += v;
    }
    phaseTaps.push(taps.map((v) => v / sum)); // normalize to unity DC gain
  }

  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) maxAbs = a;
  }
  // Only search for interpolated peaks near sample peaks (saves computation).
  const threshold = maxAbs * 0.5;
  for (let i = TAPS_PER_PHASE; i < samples.length - TAPS_PER_PHASE; i++) {
    if (Math.abs(samples[i]) < threshold) continue;
    for (const taps of phaseTaps) {
      let acc = 0;
      for (let j = 0; j < TAPS_PER_PHASE; j++) acc += samples[i - j + TAPS_PER_PHASE / 2] * taps[j];
      const a = Math.abs(acc);
      if (a > maxAbs) maxAbs = a;
    }
  }
  return db(maxAbs);
}

// Plosive pop detection (Shiota et al. INTERSPEECH 2015:
// 20-100 ms bursts concentrated below ≈150 Hz).
function detectPops(samples, sampleRate, frames, isSpeech) {
  // Extract the low band with a 2-stage 1st-order IIR LPF at 150 Hz.
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  const low = new Float32Array(samples.length);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    y1 = (1 - a) * samples[i] + a * y1;
    y2 = (1 - a) * y1 + a * y2;
    low[i] = y2;
  }

  // Per-frame low-frequency power ratio and low-band level.
  const lfr = [], lowDbs = [];
  frames.forEach((f) => {
    let lp = 0, tp = 0;
    for (let i = f.start; i < f.start + f.len; i++) {
      lp += low[i] * low[i];
      tp += samples[i] * samples[i];
    }
    lfr.push(tp > 0 ? lp / tp : 0);
    lowDbs.push(powerDb(lp / f.len));
  });

  // Use the median low-band level of speech frames as the reference.
  const speechLow = lowDbs.filter((_, i) => isSpeech[i]).sort((x, y) => x - y);
  if (speechLow.length === 0) return 0;
  const medianLow = percentile(speechLow, 0.5);

  // LFR > 0.5 and low band above median +12 dB for 2-10 consecutive frames → one pop.
  let count = 0, runLen = 0;
  for (let i = 0; i < frames.length; i++) {
    const isPop = isSpeech[i] && lfr[i] > 0.5 && lowDbs[i] > medianLow + 12;
    if (isPop) {
      runLen++;
    } else {
      if (runLen >= 2 && runLen <= 10) count++;
      runLen = 0;
    }
  }
  return count;
}

// Noise-type diagnosis (diagnostic layer): classify by spectral flatness + low-band
// ratio + stationarity.
function classifyNoise(ltas, frameDbs, isSpeech) {
  if (!ltas || !ltas.noiseSpec) return null;
  const { noiseSpec, binHz } = ltas;

  // Spectral flatness (geometric/arithmetic mean) over 100 Hz-6 kHz and low-band (<300 Hz) ratio.
  let logSum = 0, sum = 0, n = 0, lowE = 0, totalE = 0;
  for (let b = 0; b < noiseSpec.length; b++) {
    const hz = b * binHz;
    if (hz < 100 || hz > 6000) continue;
    logSum += Math.log(noiseSpec[b] + 1e-20);
    sum += noiseSpec[b];
    n++;
    totalE += noiseSpec[b];
    if (hz < 300) lowE += noiseSpec[b];
  }
  if (n === 0 || sum === 0) return null;
  const sfm = Math.exp(logSum / n) / (sum / n);
  const lowRatio = lowE / totalE;

  // Stationarity: level standard deviation of non-speech frames.
  const noiseDbs = frameDbs.filter((_, i) => !isSpeech[i]);
  const mean = noiseDbs.reduce((s, v) => s + v, 0) / noiseDbs.length;
  const std = Math.sqrt(noiseDbs.reduce((s, v) => s + (v - mean) ** 2, 0) / noiseDbs.length);

  if (std > 6) return 'adv_noise_env';
  if (lowRatio > 0.6) return 'adv_noise_fan';
  if (sfm > 0.3) return 'adv_noise_hiss';
  return 'adv_noise_fan'; // treat low-tilted noise as fan/HVAC-type
}

// AGC pumping detection (diagnostic layer): AGC is suspected when the noise floor in
// gaps right after speech offsets sits ≥6 dB above the initial silent stretch.
function detectAgcPumping(frameDbs, isSpeech, hopMs) {
  const headFrames = Math.round(1200 / hopMs); // first 1.2 seconds
  const headNoise = [];
  for (let i = 0; i < Math.min(headFrames, frameDbs.length); i++) {
    if (!isSpeech[i]) headNoise.push(frameDbs[i]);
  }
  if (headNoise.length < 30) return false;
  headNoise.sort((a, b) => a - b);
  const headFloor = percentile(headNoise, 0.5);

  const gapDbs = [];
  for (let i = 1; i < isSpeech.length; i++) {
    if (isSpeech[i - 1] && !isSpeech[i]) {
      // 200-500 ms after speech offset (avoids the reverb tail).
      const from = i + Math.round(200 / hopMs);
      const to = i + Math.round(500 / hopMs);
      for (let j = from; j < Math.min(to, frameDbs.length); j++) {
        if (!isSpeech[j]) gapDbs.push(frameDbs[j]);
      }
    }
  }
  if (gapDbs.length < 10) return false;
  gapDbs.sort((a, b) => a - b);
  return percentile(gapDbs, 0.5) - headFloor >= 6;
}

// Spectrum analysis: long-term average spectra (LTAS) of speech and noise.
function computeLtas(samples, sampleRate, frames, isSpeech) {
  const fftSize = 2048;
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));

  const speechSpec = new Float64Array(fftSize / 2);
  const noiseSpec = new Float64Array(fftSize / 2);
  let speechN = 0, noiseN = 0;

  frames.forEach((f, idx) => {
    if (f.start + fftSize > samples.length) return;
    const target = isSpeech[idx] ? speechSpec : noiseSpec;
    if (isSpeech[idx] && speechN >= 300) return;
    if (!isSpeech[idx] && noiseN >= 300) return;
    const buf = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) buf[i] = samples[f.start + i] * window[i];
    const mags = fftMag(buf);
    for (let b = 0; b < mags.length; b++) target[b] += mags[b] * mags[b];
    isSpeech[idx] ? speechN++ : noiseN++;
  });

  if (speechN === 0) return null;
  for (let b = 0; b < speechSpec.length; b++) speechSpec[b] /= speechN;
  if (noiseN > 0) for (let b = 0; b < noiseSpec.length; b++) noiseSpec[b] /= noiseN;

  return { speechSpec, noiseSpec: noiseN > 0 ? noiseSpec : null, binHz: sampleRate / fftSize };
}

// Effective bandwidth: highest frequency where the speech LTAS exceeds the noise
// LTAS + 10 dB (spectral roll-off method).
function computeBandwidth(ltas) {
  const { speechSpec, noiseSpec, binHz } = ltas;
  // Smooth with a moving average of roughly 1/6 octave.
  const smooth = (spec) => {
    const out = new Float64Array(spec.length);
    for (let i = 0; i < spec.length; i++) {
      const half = Math.max(2, Math.floor(i * 0.06));
      let s = 0, n = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(spec.length - 1, i + half); j++) { s += spec[j]; n++; }
      out[i] = s / n;
    }
    return out;
  };
  const sp = smooth(speechSpec);
  const np = noiseSpec ? smooth(noiseSpec) : null;

  let upperHz = 0;
  const minRun = 3; // require consecutive bins to satisfy the condition (spike tolerance)
  for (let b = sp.length - 1 - minRun; b > 0; b--) {
    let ok = true;
    for (let k = 0; k < minRun; k++) {
      const excess = np ? powerDb(sp[b + k]) - powerDb(np[b + k]) : 15;
      if (excess < 10) { ok = false; break; }
    }
    if (ok) { upperHz = (b + minRun - 1) * binHz; break; }
  }
  return upperHz;
}

// Alpha ratio: 10*log10(E[1-5 kHz] / E[50 Hz-1 kHz]) (spectral tilt, Byrne 1994 LTASS baseline).
function computeAlphaRatio(ltas) {
  const { speechSpec, binHz } = ltas;
  let lowE = 0, highE = 0;
  for (let b = 0; b < speechSpec.length; b++) {
    const hz = b * binHz;
    if (hz >= 50 && hz < 1000) lowE += speechSpec[b];
    else if (hz >= 1000 && hz < 5000) highE += speechSpec[b];
  }
  if (lowE <= 0 || highE <= 0) return null;
  return powerDb(highE) - powerDb(lowE);
}

// ---------- Scoring ----------

function ratingFromScore(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

// Map an R value (0-100) to MOS (1-5) with the standard ITU-T G.107 E-model formula.
function rToMos(r) {
  const rc = Math.max(0, Math.min(100, r));
  return 1 + 0.035 * rc + rc * (rc - 60) * (100 - rc) * 7e-6;
}

export function analyzeRecording(samples, sampleRate) {
  const { frames, hopLen } = frameSignal(samples, sampleRate);
  const frameDbs = frames.map((f) => frameRmsDb(samples, f));
  const { isSpeech, noiseFloorDb } = detectActivity(frameDbs);

  const speechFrameCount = isSpeech.filter(Boolean).length;
  if (speechFrameCount < 30) {
    throw new Error('err_no_speech'); // i18n key (translated by the caller via t())
  }
  const speechSec = (speechFrameCount * HOP_MS) / 1000;

  const metrics = [];
  const advice = [];

  const speechLevel = computeSpeechLevel(samples, frames, isSpeech);
  const snrResult = computeSnr(samples, frames, isSpeech);
  const snr = snrResult ? snrResult.snr : null;
  const ltas = computeLtas(samples, sampleRate, frames, isSpeech);

  // --- 1. Noise (SNR): thresholds 30/20/10 dB ---
  if (snr !== null) {
    const score = interpScore(snr, [[5, 15], [10, 40], [20, 60], [30, 80], [40, 100]]);
    const rating = ratingFromScore(score);
    metrics.push({
      key: 'snr',
      nameKey: 'm_snr',
      score, rating,
      value: { key: 'm_snr_value', params: { snr: snr.toFixed(1) } },
      note: {
        key: 'm_snr_note',
        params: { noise: snrResult.noiseLevelDb.toFixed(0) },
        extra: speechSec < 3 ? 'extra_short_speech' : null,
      },
      weight: 0.35,
    });
    if (rating === 'poor' || rating === 'fair') {
      advice.push({ metric: 'a_noise', key: 'adv_noise' });
    }
  }

  // --- 2. Reverb (RT60): thresholds 0.3/0.5/0.7 s (ANSI S12.60 / WELL v2) ---
  const reverbResult = estimateReverb(frameDbs, noiseFloorDb, speechLevel ?? -20, HOP_MS);
  const lowSnrForReverb = snr !== null && snr < 15;
  // Experimental deep diagnostics: near reflection is meaningful even without a long tail.
  const reflection = detectNearReflection(ltas);
  const strongReflection = reflection !== null && reflection.z >= 6;
  if (reverbResult && !lowSnrForReverb) {
    const { rt60, eventCount } = reverbResult;
    const score = interpScore(rt60, [[0.2, 100], [0.3, 80], [0.5, 60], [0.7, 40], [1.2, 10]]);
    const rating = ratingFromScore(score);
    const c50 = rt60ToC50(rt60);

    // A strong comb (near reflection) corrupts band envelopes, so skip subband
    // analysis in that case (lab finding: low-band RT60 blew up under a 4 ms comb).
    const bands = strongReflection ? {} : subbandReverb(samples, sampleRate, frames);
    const hasBands = bands.low != null && bands.high != null;

    metrics.push({
      key: 'reverb',
      nameKey: 'm_reverb',
      score, rating,
      value: { key: 'm_reverb_value', params: { ms: (rt60 * 1000).toFixed(0) } },
      note: hasBands
        ? {
            key: 'm_reverb_note_bands',
            params: {
              c50: c50.toFixed(1),
              lo: (bands.low * 1000).toFixed(0),
              hi: (bands.high * 1000).toFixed(0),
            },
            extra: eventCount < 5 ? 'extra_few_decays' : null,
          }
        : {
            key: 'm_reverb_note',
            params: { c50: c50.toFixed(1) },
            extra: eventCount < 5 ? 'extra_few_decays' : null,
          },
      weight: 0.25,
    });

    if (rating === 'poor' || rating === 'fair') {
      // Cause-specific advice when the subband ratio is conclusive; generic otherwise.
      let advKey = 'adv_reverb', advParams;
      if (hasBands) {
        // Margins around 1.0 leave an inconclusive zone — blind subband estimates
        // carry ±30% variance, so only clearly skewed ratios get a specific verdict.
        const ratio = bands.high / bands.low;
        if (ratio >= 1.15) {
          advKey = 'adv_room_hard';
          advParams = { ratio: ratio.toFixed(2) };
        } else if (ratio < 0.8 && ratio > 0.45) {
          advKey = 'adv_room_lowheavy';
          advParams = { ratio: ratio.toFixed(2) };
        }
      }
      advice.push({ metric: 'a_reverb', key: advKey, params: advParams });

      // Mic-distance suspicion: DRR below ~2 dB means the mic sits at or beyond
      // the critical distance — moving closer is the dominant fix.
      const drrEst = estimateDrr(frameDbs, speechLevel ?? -20, rt60);
      if (drrEst !== null && drrEst < 2) {
        advice.push({ metric: 'a_mic_dist', key: 'adv_mic_far', params: { db: drrEst.toFixed(0) } });
      }
    }
  } else {
    metrics.push({
      key: 'reverb',
      nameKey: 'm_reverb',
      score: 75,
      rating: 'good',
      value: { key: lowSnrForReverb ? 'm_reverb_noisy_value' : 'm_reverb_none_value' },
      note: { key: lowSnrForReverb ? 'm_reverb_noisy_note' : 'm_reverb_none_note' },
      weight: 0.1,
    });
  }

  // Near-reflection advice (independent of the RT60 rating — a desk/monitor
  // reflection colors the sound even in an otherwise dry room).
  if (strongReflection) {
    advice.push({
      metric: 'a_reflection',
      key: 'adv_near_reflection',
      params: { cm: Math.round(reflection.tauMs * 17) },
    });
  }

  // --- 3. Recording level (P.56-style ASL): EBU R128 / podcast delivery targets ---
  if (speechLevel !== null) {
    const score = interpScore(speechLevel, [
      [-45, 5], [-32, 40], [-24, 60], [-20, 85], [-14, 85], [-12, 60], [-10, 40], [-6, 15],
    ]);
    const rating = ratingFromScore(score);
    metrics.push({
      key: 'level',
      nameKey: 'm_level',
      score, rating,
      value: { key: 'm_level_value', params: { db: speechLevel.toFixed(1) } },
      note: { key: 'm_level_note' },
      weight: 0.15,
    });
    if (speechLevel < -24) {
      advice.push({ metric: 'a_level', key: 'adv_level_low' });
    } else if (speechLevel > -12) {
      advice.push({ metric: 'a_level', key: 'adv_level_high' });
    }
  }

  // --- 4. Clipping: even 0.5% is reported to degrade speaker recognition ---
  const clipPct = computeClipping(samples);
  {
    const score = interpScore(clipPct, [[0, 100], [0.01, 80], [0.1, 60], [1, 40], [5, 5]]);
    const rating = ratingFromScore(score);
    metrics.push({
      key: 'clipping',
      nameKey: 'm_clip',
      score, rating,
      value: clipPct < 0.005
        ? { key: 'm_clip_none' }
        : { key: 'm_clip_value', params: { pct: clipPct.toFixed(2) } },
      note: { key: 'm_clip_note' },
      weight: 0.15,
    });
    if (rating === 'poor' || rating === 'fair') {
      advice.push({ metric: 'a_clip', key: 'adv_clip' });
    }
  }

  // --- 5. Frequency response: effective bandwidth (G.711/G.722) + alpha ratio (Byrne 1994) ---
  if (ltas) {
    const upperHz = computeBandwidth(ltas);
    const alpha = computeAlphaRatio(ltas);

    const bwScore = interpScore(upperHz, [[1000, 5], [3400, 40], [7000, 60], [12000, 80], [16000, 95]]);
    const alphaScore = alpha !== null
      ? interpScore(alpha, [[-40, 10], [-35, 40], [-31, 60], [-25, 80], [-18, 95], [-12, 90], [-6, 65]])
      : 70;
    const score = bwScore * 0.5 + alphaScore * 0.5;
    const rating = ratingFromScore(score);

    const bwLabelKey = upperHz >= 12000 ? 'band_full' : upperHz >= 7000 ? 'band_wide' : upperHz >= 3400 ? 'band_mid' : 'band_nb';
    metrics.push({
      key: 'spectrum',
      nameKey: 'm_spec',
      score, rating,
      value: { key: 'm_spec_value', params: { khz: (upperHz / 1000).toFixed(1) }, labelKey: bwLabelKey },
      note: { key: 'm_spec_note', params: { alpha: alpha !== null ? alpha.toFixed(1) : 'N/A' } },
      weight: 0.10,
    });
    if (bwScore < 60) {
      advice.push({ metric: 'a_band', key: 'adv_band', params: { khz: (upperHz / 1000).toFixed(1) } });
    } else if (alphaScore < 60) {
      advice.push({ metric: 'a_muffle', key: 'adv_muffle' });
    }
  }

  // --- 6. Dropouts (proxy for NISQA Discontinuity) ---
  {
    const count = detectDropouts(samples, sampleRate, noiseFloorDb);
    const score = interpScore(count, [[0, 100], [1, 55], [2, 25], [4, 5]]);
    const rating = ratingFromScore(score);
    metrics.push({
      key: 'dropout',
      nameKey: 'm_dropout',
      score, rating,
      value: count === 0 ? { key: 'm_dropout_none' } : { key: 'm_dropout_value', params: { n: count } },
      note: { key: 'm_dropout_note' },
      weight: 0.10,
    });
    if (count > 0) {
      advice.push({ metric: 'a_dropout', key: 'adv_dropout' });
    }
  }

  // --- 7. Mains hum (50/60 Hz harmonic series) ---
  const humResult = detectHum(samples, sampleRate, frames, isSpeech, hopLen);
  if (!humResult.ok) {
    metrics.push({
      key: 'hum',
      nameKey: 'm_hum',
      score: 75,
      rating: 'good',
      value: { key: 'm_hum_na_value' },
      note: { key: 'm_hum_na_note' },
      weight: 0.03,
    });
  } else {
    const humRel = humResult.detected && speechLevel !== null
      ? humResult.humDb - speechLevel
      : -60;
    const score = humResult.detected
      ? interpScore(humRel, [[-50, 100], [-45, 80], [-35, 40], [-25, 10]])
      : 100;
    const rating = ratingFromScore(score);
    metrics.push({
      key: 'hum',
      nameKey: 'm_hum',
      score, rating,
      value: humResult.detected
        ? { key: 'm_hum_value', params: { hz: humResult.family, db: humRel.toFixed(0) } }
        : { key: 'm_hum_none' },
      note: { key: 'm_hum_note' },
      weight: 0.08,
    });
    if (rating === 'poor' || rating === 'fair') {
      advice.push({ metric: 'a_hum', key: 'adv_hum', params: { hz: humResult.family } });
    }
  }

  // --- 8. True Peak / headroom (ITU-R BS.1770-5) ---
  const dbtp = computeTruePeak(samples);
  {
    const score = interpScore(dbtp, [[-6, 100], [-3, 80], [-1, 55], [0, 25]]);
    const rating = ratingFromScore(score);
    metrics.push({
      key: 'truepeak',
      nameKey: 'm_tp',
      score, rating,
      value: { key: 'm_tp_value', params: { db: dbtp.toFixed(1) } },
      note: { key: 'm_tp_note' },
      weight: 0.07,
    });
    if (dbtp > -1) {
      advice.push({ metric: 'a_tp', key: 'adv_tp', params: { db: dbtp.toFixed(1) } });
    }
  }

  // --- 9. Plosive pops (Shiota 2015) ---
  {
    const count = detectPops(samples, sampleRate, frames, isSpeech);
    const per10s = (count / Math.max(speechSec, 1)) * 10;
    const score = interpScore(per10s, [[0, 100], [1, 60], [3, 25]]);
    const rating = ratingFromScore(score);
    metrics.push({
      key: 'pop',
      nameKey: 'm_pop',
      score, rating,
      value: count === 0 ? { key: 'm_pop_none' } : { key: 'm_pop_value', params: { n: count } },
      note: { key: 'm_pop_note' },
      weight: 0.08,
    });
    if (rating === 'poor' || rating === 'fair') {
      advice.push({ metric: 'a_pop', key: 'adv_pop' });
    }
  }

  // --- Diagnostic layer (no score contribution; advice only when detected) ---
  // Noise type: when SNR is bad, replace the generic advice with a cause-specific one.
  const noiseAdvice = advice.find((a) => a.key === 'adv_noise');
  if (noiseAdvice) {
    const classified = classifyNoise(ltas, frameDbs, isSpeech);
    if (classified) noiseAdvice.key = classified;
  }
  // AGC pumping (skipped for strongly reverberant recordings — indistinguishable from tails).
  const reverbMetric = metrics.find((m) => m.key === 'reverb');
  if (reverbMetric && reverbMetric.rating !== 'poor' && detectAgcPumping(frameDbs, isSpeech, HOP_MS)) {
    advice.push({ metric: 'a_agc', key: 'adv_agc' });
  }
  // DC offset
  {
    let mean = 0;
    for (let i = 0; i < samples.length; i++) mean += samples[i];
    mean /= samples.length;
    if (Math.abs(mean) > 0.01) {
      advice.push({ metric: 'a_dc', key: 'adv_dc' });
    }
  }

  // --- Overall score: weighted mean + weakest-link cap (G.107-style additive impairments) ---
  const totalWeight = metrics.reduce((s, m) => s + m.weight, 0);
  const weighted = metrics.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight;
  // A single severe defect dominates perceived quality (cap at worst metric + 20 points).
  const worst = Math.min(...metrics.map((m) => m.score));
  const overallScore = Math.min(weighted, worst + 20);
  const overallRating = ratingFromScore(overallScore);
  const mos = rToMos(overallScore);

  return {
    overallScore,
    overallRating,
    mos,
    metrics,
    advice,
    debug: { speechSec, noiseFloorDb, sampleRate },
  };
}

const METHODOLOGY_JA = `
<p>各指標は参照信号なし（ブラインド）で推定した近似値です。閾値・手法は以下の文献・規格に基づきます。</p>
<table>
<tr><th>指標</th><th>手法</th><th>閾値の根拠</th></tr>
<tr><td>ノイズ (SNR)</td><td>VADベースのブラインドSNR（NIST STNR / snreval SNR_VAD系）</td><td>SNR ≥30dB=クリーン、20-30dB=良好の業界慣行。評価枠組みは <a href="https://standards.globalspec.com/std/363256/itu-t-p-835" target="_blank">ITU-T P.835</a> のBAK軸、<a href="https://arxiv.org/abs/2110.01763" target="_blank">DNSMOS P.835</a></td></tr>
<tr><td>反響 (RT60)</td><td>音声終端後の自由減衰区間の勾配回帰（<a href="https://www.researchgate.net/publication/5923452_Blind_estimation_of_reverberation_time" target="_blank">Ratnam 2003</a>、ISO 3382 T20の考え方）</td><td>ANSI S12.60（教室 ≤0.6s）、WELL v2（会議室 ≤0.7s）。C50換算はPolackモデル</td></tr>
<tr><td>録音レベル</td><td>発話区間のみのRMS（<a href="https://standards.globalspec.com/std/1313732/p-56" target="_blank">ITU-T P.56</a> Active Speech Levelの簡易版）</td><td><a href="https://tech.ebu.ch/loudness" target="_blank">EBU R128</a>・ポッドキャスト配信基準（-20〜-14 LUFS相当）</td></tr>
<tr><td>クリッピング</td><td>フルスケール近傍サンプル率</td><td><a href="https://www.sciencedirect.com/science/article/pii/S0167639321000832" target="_blank">Speech Communication (2021)</a>: 0.5%の軽度クリップでも品質・認識劣化</td></tr>
<tr><td>周波数特性</td><td>LTASロールオフによる有効帯域 + Alpha ratio（<a href="https://asa.scitation.org/doi/10.1121/1.410152" target="_blank">Byrne 1994 LTASS</a>）</td><td>G.711（電話 3.4kHz）/ G.722（広帯域 7kHz）の帯域テンプレート</td></tr>
<tr><td>接続の安定性</td><td>定数ラン（≥2ms）+ 包絡断絶の時間領域検出</td><td><a href="https://arxiv.org/abs/2104.09494" target="_blank">NISQA</a>のDiscontinuity次元相当。ITU-T P.563でも信号中断は迷惑度第2位の歪みクラス</td></tr>
<tr><td>電源ハム</td><td>最長無音区間へのGoertzel解析で50/60Hz倍音列を検出（倍音3本以上でハム判定、<a href="https://www.researchgate.net/publication/265984226_Detection_of_Hum_in_Audio_Signals" target="_blank">Brandt &amp; Bitzer</a>）</td><td>ACXノイズフロア基準（-60dBFS ≈ 発話比-40dB）から対発話-45dB以下を「聞こえない水準」とする</td></tr>
<tr><td>ピークマージン</td><td>4倍オーバーサンプリングFIR補間のTrue Peak（<a href="https://www.itu.int/rec/R-REC-BS.1770" target="_blank">ITU-R BS.1770-5</a> Annex 2方式）</td><td>AES TD1008: ロッシーコーデック入力は-1dBTP以下を推奨（オーバーシュートの加算性）</td></tr>
<tr><td>ポップノイズ</td><td>150Hz以下の低域パワー比バースト（20-100ms）検出（<a href="https://www.isca-archive.org/interspeech_2015/shiota15_interspeech.html" target="_blank">Shiota et al. 2015</a>）</td><td>ポップは≦100Hz帯に集中する過渡バーストという同研究の知見</td></tr>
<tr><td>総合スコア</td><td>重み付き集約（ノイズ35:残響25:レベル15:クリップ15:スペクトル10）+ 最弱リンク制約。MOS換算は <a href="https://www.itu.int/rec/T-REC-G.107" target="_blank">ITU-T G.107</a> E-model標準式</td><td>重みは <a href="https://ecs.utdallas.edu/loizou/speech/obj_paper_jan08.pdf" target="_blank">Hu & Loizou 2008</a>（P.835回帰）の知見に基づく設計判断</td></tr>
</table>
<p>ブラインド推定は文献上も誤差があるため（特に残響・低SNR時）、すべて「推定値」として扱ってください。</p>
`;

const METHODOLOGY_EN = `
<p>All metrics are blind (single-ended) estimates computed without a reference signal. Methods and thresholds
are based on the literature and standards below.</p>
<table>
<tr><th>Metric</th><th>Method</th><th>Threshold basis</th></tr>
<tr><td>Noise (SNR)</td><td>VAD-based blind SNR (NIST STNR / snreval SNR_VAD family)</td><td>Industry convention: SNR ≥30 dB = clean, 20–30 dB = good. Framework: the BAK axis of <a href="https://standards.globalspec.com/std/363256/itu-t-p-835" target="_blank">ITU-T P.835</a>, <a href="https://arxiv.org/abs/2110.01763" target="_blank">DNSMOS P.835</a></td></tr>
<tr><td>Reverb (RT60)</td><td>Slope regression on free-decay segments after speech offsets (<a href="https://www.researchgate.net/publication/5923452_Blind_estimation_of_reverberation_time" target="_blank">Ratnam 2003</a>; ISO 3382 T20 approach)</td><td>ANSI S12.60 (classrooms ≤0.6 s), WELL v2 (meeting rooms ≤0.7 s). C50 conversion via the Polack model</td></tr>
<tr><td>Recording level</td><td>RMS over speech frames only (simplified <a href="https://standards.globalspec.com/std/1313732/p-56" target="_blank">ITU-T P.56</a> Active Speech Level)</td><td><a href="https://tech.ebu.ch/loudness" target="_blank">EBU R128</a> and podcast delivery targets (≈ -20 to -14 LUFS)</td></tr>
<tr><td>Clipping</td><td>Share of samples near full scale</td><td><a href="https://www.sciencedirect.com/science/article/pii/S0167639321000832" target="_blank">Speech Communication (2021)</a>: even 0.5% mild clipping degrades quality and recognition</td></tr>
<tr><td>Frequency response</td><td>Effective bandwidth via LTAS roll-off + alpha ratio (<a href="https://asa.scitation.org/doi/10.1121/1.410152" target="_blank">Byrne 1994 LTASS</a>)</td><td>Bandwidth templates of G.711 (telephone, 3.4 kHz) / G.722 (wideband, 7 kHz)</td></tr>
<tr><td>Connection stability</td><td>Time-domain detection of constant runs (≥2 ms) and envelope breaks</td><td>Corresponds to the Discontinuity dimension of <a href="https://arxiv.org/abs/2104.09494" target="_blank">NISQA</a>; ITU-T P.563 ranks interruptions as the 2nd most annoying distortion class</td></tr>
<tr><td>Mains hum</td><td>Goertzel analysis of the longest silent stretch for 50/60 Hz harmonic series (≥3 harmonics required, <a href="https://www.researchgate.net/publication/265984226_Detection_of_Hum_in_Audio_Signals" target="_blank">Brandt &amp; Bitzer</a>)</td><td>Derived from the ACX noise-floor requirement (-60 dBFS ≈ -40 dB vs speech): -45 dB vs speech or lower is inaudible</td></tr>
<tr><td>Peak headroom</td><td>True Peak via 4x-oversampling FIR interpolation (<a href="https://www.itu.int/rec/R-REC-BS.1770" target="_blank">ITU-R BS.1770-5</a> Annex 2)</td><td>AES TD1008: keep ≤ -1 dBTP before lossy codecs (overshoot is additive)</td></tr>
<tr><td>Plosive pops</td><td>Bursts (20–100 ms) of low-frequency power ratio below 150 Hz (<a href="https://www.isca-archive.org/interspeech_2015/shiota15_interspeech.html" target="_blank">Shiota et al. 2015</a>)</td><td>Same study: pop energy concentrates below ≈100 Hz as transient bursts</td></tr>
<tr><td>Overall score</td><td>Weighted aggregation (noise 35 : reverb 25 : level 15 : clipping 15 : spectrum 10) + weakest-link cap. MOS via the <a href="https://www.itu.int/rec/T-REC-G.107" target="_blank">ITU-T G.107</a> E-model formula</td><td>Weights follow <a href="https://ecs.utdallas.edu/loizou/speech/obj_paper_jan08.pdf" target="_blank">Hu &amp; Loizou 2008</a> (P.835 regression)</td></tr>
</table>
<p>Blind estimates carry known error margins (especially reverb and low-SNR cases) — treat every number as an estimate.</p>
`;

export function getMethodologyHtml() {
  return getLang() === 'ja' ? METHODOLOGY_JA : METHODOLOGY_EN;
}
