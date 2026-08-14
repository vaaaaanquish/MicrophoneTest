// Build-time generator for the pre-rendered share cards under /s/{lang}/{score}.png.
//
// X's tweet intent cannot attach an image, and its crawler does not run JavaScript,
// so a shared URL can only show a card if that URL serves static HTML whose
// og:image already exists. Encoding all nine metric scores that way is impossible
// (101^10 combinations), so only the overall score gets a pre-rendered card; the
// detailed card still goes through the clipboard.
//
// Run it from the app page (so the fonts and i18n dictionary match production):
//   1. python3 -m http.server 8765 --directory .
//   2. start the receiver: see the header of this file's companion command in the
//      repository history, or any small POST-to-disk server on 127.0.0.1:8766
//   3. in the page console:
//        const m = await import('/tools/generate-og-cards.js'); await m.run();
//
// Rendering is deterministic (seeded PRNG), so re-running produces identical files.

import { t, setLang } from '../i18n.js';

const W = 1200, H = 630;
const RECEIVER = 'http://127.0.0.1:8766/';
const RATING_COLORS = { excellent: '#0ca30c', good: '#3987e5', fair: '#fab219', poor: '#d03b3b' };
const RATING_EMOJI = { excellent: ' 🎉', good: ' 🎉', fair: ' 💪', poor: ' 🌱' };

// Mirrors ratingFromScore() in analysis.js.
function ratingFromScore(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

function font(weight, size) {
  return `${weight} ${size}px system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif`;
}

// Deterministic PRNG so regenerating doesn't churn the committed files.
function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// A frozen frame of the in-app celebration, drawn behind the text.
function drawConfetti(ctx, seed) {
  const rand = mulberry32(seed);
  const colors = ['#0ca30c', '#3987e5', '#fab219', '#d55181', '#9085e9', '#34c98e'];
  for (let i = 0; i < 210; i++) {
    let x = W / 2 + (rand() - 0.5) * W * 0.7;
    let y = H * 0.34;
    let vx = (rand() - 0.5) * 19;
    let vy = -6 - rand() * 12;
    let rot = rand() * Math.PI;
    const vr = (rand() - 0.5) * 0.35;
    const w = 6 + rand() * 8;
    const h = 9 + rand() * 10;
    // Freeze each piece at a different point in its arc so the burst reads as
    // scattered rather than a single band.
    const steps = 22 + Math.floor(rand() * 30);
    for (let s = 0; s < steps; s++) {
      vy += 0.28;
      x += vx;
      y += vy;
      rot += vr;
      vx *= 0.99;
    }
    if (y < -40 || y > H + 40) continue;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

export function drawCard(score, lang) {
  setLang(lang);
  const rating = ratingFromScore(score);
  const color = RATING_COLORS[rating];

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);

  // Celebrate the ratings that celebrate in the app.
  if (rating === 'excellent' || rating === 'good') {
    drawConfetti(ctx, score * 7919 + (lang === 'ja' ? 13 : 29));
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 34);
  ctx.textAlign = 'left';
  ctx.fillText('🎙️ Microphone Test', 60, 84);

  const cx = W / 2, cy = 300, r = 122;
  ctx.lineWidth = 22;
  ctx.strokeStyle = '#2c2c2a';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * score) / 100);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 116);
  ctx.fillText(String(score), cx, cy + 30);
  ctx.fillStyle = '#898781';
  ctx.font = font(400, 26);
  ctx.fillText('/ 100', cx, cy + 76);

  ctx.fillStyle = color;
  ctx.font = font(700, 50);
  ctx.fillText(t(`rating_${rating}`) + (RATING_EMOJI[rating] || ''), cx, 510);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#898781';
  ctx.font = font(400, 22);
  ctx.fillText('vaaaaanquish.github.io/MicrophoneTest', 60, 588);

  return cv;
}

async function post(name, cv) {
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const b64 = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.readAsDataURL(blob);
  });
  await fetch(`${RECEIVER}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    mode: 'no-cors',
    body: b64,
  });
  return blob.size;
}

export async function run(langs = ['ja', 'en']) {
  let total = 0;
  for (const lang of langs) {
    for (let score = 0; score <= 100; score++) {
      total += await post(`s/${lang}/${score}.png`, drawCard(score, lang));
    }
  }
  return `${langs.length * 101} files, ${(total / 1024 / 1024).toFixed(1)} MB`;
}
