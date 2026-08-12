# 🎙️ Microphone Test

**Live: https://vaaaaanquish.github.io/MicrophoneTest/**

A static web app that scores how clear you sound: pick a microphone, speak for a few
seconds, and get a literature-based quality assessment.
No build step, fully client-side — the recording never leaves your browser.

## Metrics

| Metric | Method | Threshold basis |
|---|---|---|
| Noise (SNR) | VAD-based blind SNR estimation | ITU-T P.835 BAK axis / DNSMOS; ≥30 dB = clean convention |
| Reverb (RT60) | Slope regression on free-decay segments (Ratnam 2003 / ISO 3382 T20) | Room-design standards ANSI S12.60 / WELL v2 (0.3/0.5/0.7 s) |
| Recording level | ITU-T P.56-style active speech level | EBU R128 / podcast delivery targets |
| Clipping | Share of samples near full scale | Even 0.5% degrades quality (Speech Communication 2021) |
| Frequency response | LTAS roll-off bandwidth + alpha ratio (Byrne 1994) | G.711 / G.722 bandwidth templates |
| Connection stability | Time-domain dropout detection (constant runs + envelope breaks) | NISQA Discontinuity dimension / ITU-T P.563 |
| Mains hum | Goertzel analysis of silent stretches for 50/60 Hz harmonic series | Brandt & Bitzer (Fraunhofer) / ACX noise-floor requirement |
| Peak headroom | True Peak via 4x oversampling | ITU-R BS.1770-5 / AES TD1008 (-1 dBTP) |
| Plosive pops | Low-frequency (≤150 Hz) power-ratio burst detection | Shiota et al. INTERSPEECH 2015 |
| Overall | Weighted aggregation + weakest-link cap, MOS via the G.107 E-model formula | Hu & Loizou 2008 (P.835 regression) |

A diagnostic layer additionally reports noise-type classification (spectral flatness),
AGC pumping, and DC offset as improvement tips when detected. For reverberant rooms it
digs deeper: subband RT60 (bare/hard room vs low-heavy large room), a blind
direct-to-reverberant ratio (mic-too-far detection), and near-reflection detection via
LTAS comb ripple (estimates the distance to a desk/monitor/wall reflector).

## Local development

```bash
python3 -m http.server 8765 --directory .
```

→ http://localhost:8765 (`getUserMedia` requires localhost or HTTPS)

## Reference

- [docs/RESEARCH.md](docs/RESEARCH.md) — the literature survey behind the metric design
