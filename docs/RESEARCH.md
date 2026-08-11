# Microphone Speech Quality Scoring — Metric Design Survey

> Literature and standards survey underlying the scoring design of this app.

## 0. Design summary

- Every metric in this report uses methods computable **without a reference signal (single-ended / non-intrusive / blind)**. The academic state of the art (DNSMOS, NISQA) is DNN-based; instead we adopt the **subjective-evaluation frameworks those models were trained on (ITU-T P.835 SIG/BAK/OVRL, P.800 MOS)** and approximate each axis with lightweight DSP.
- Implementation assumptions: Web Audio API `AudioContext` (fs = 48 kHz), `AnalyserNode` or `AudioWorklet` + custom FFT (frame 1024–4096, 50% hop, Hann window). Every method needs only FFT and time-domain processing.
- The overall score maps to a MOS-like 1–5 scale (5 = Excellent, 4 = Good, 3 = Fair, 2 = Poor), following P.800 ACR display conventions.

---

## 1. Noise (SNR / background noise)

### 1.1 Standards and research background

- **ITU-T P.835**: subjective evaluation method for speech systems with noise suppression. Listeners rate **SIG (speech-signal distortion, 1 = very distorted to 5 = not distorted), BAK (background noise, 1 = very intrusive to 5 = not noticeable), and OVRL (overall, 1 = Bad to 5 = Excellent)**. This app's noise score is best framed as an objective approximation of the BAK axis.
  ([ITU-T P.835 overview – GlobalSpec](https://standards.globalspec.com/std/363256/itu-t-p-835))
- **DNSMOS P.835** (Microsoft): non-intrusive DNN trained on P.835 human ratings; outputs SIG/BAK/OVRL with PCC = 0.94–0.98 against human scores. Direct precedent for "decompose into three axes, score each 1–5."
  ([arXiv:2110.01763](https://arxiv.org/abs/2110.01763))
- **NISQA**: non-intrusive DNN predicting overall MOS plus **four perceptual dimensions: Noisiness / Coloration / Discontinuity / Loudness**, trained on 97,000+ subjective ratings. This app's metric taxonomy (noise / spectrum / level) maps onto those dimensions.
  ([arXiv:2104.09494](https://arxiv.org/abs/2104.09494))
- **ITU-T P.563**: the ITU standard (2004) for single-ended objective quality assessment in narrow-band telephony; internal parameters include local/global background noise and unnatural silences — a standardized precedent for "estimate MOS from signal features without a reference."
  ([P.563 explanatory paper – IEEE](https://ieeexplore.ieee.org/document/1709882/))

### 1.2 Metric: blind SNR (implemented)

| Item | Content |
|---|---|
| **Name** | Blind SNR (VAD/percentile based) |
| **Method** | ① Compute RMS energy (dB) per 20–30 ms frame → ② build the frame-energy histogram → ③ **noise floor = mean of the lower percentiles (e.g. 10–20th), speech level = mean of the upper percentiles (e.g. 90–95th)** → ④ SNR = the difference (dB). This is a percentile simplification of NIST STNR and the same family as snreval's SNR_VAD (energy of VAD-on frames vs the rest). An energy-threshold VAD (frames above noise floor + 10 dB count as speech) is sufficient |
| **Thresholds** | **Excellent: ≥ 30 dB** (considered clean speech) / **Good: 20–30 dB** (fine for intelligibility and ASR) / **Fair: 10–20 dB** (noise clearly audible, WER rises) / **Poor: < 10 dB**. The ≥30 dB = clean, 20–30 dB = good convention is consistent across multiple sources; a high-quality TTS dataset required ≥32 dB in the 300 Hz–4 kHz band |
| **Sources** | [Symbl.ai – Speech-to-Noise Ratio](https://symbl.ai/developers/blog/understanding-speech-to-noise-ratio-and-its-impact-on-your-app/) / [ResearchGate – acceptable SNR discussion](https://www.researchgate.net/post/Is_there_a_standard_acceptable_SNR_level_in_speech_measures_for_research) / [Hi-Fi TTS Dataset (arXiv:2104.01497)](https://arxiv.org/pdf/2104.01497) / [NIST STNR / WADA implementation, snreval – Columbia LabROSA](https://www.ee.columbia.edu/~dpwe/LabROSA/projects/snreval/) |

**Alternative/reinforcement: WADA-SNR.** Assumes clean speech amplitudes follow a gamma distribution (shape 0.4) and noise is Gaussian; estimates SNR in closed form from the amplitude distribution (time-domain only, a few dozen lines, one lookup table), with less bias/variance than NIST STNR. An ensemble (average) with the percentile method is recommended.
([Kim & Stern, Interspeech 2008 – CMU PDF](https://www.cs.cmu.edu/~robust/Papers/KimSternIS08.pdf) / [ISCA Archive](https://www.isca-archive.org/interspeech_2008/kim08e_interspeech.html))

**Auxiliary: absolute noise floor.** Even with a high SNR, a loud absolute floor is unpleasant, so also report the floor in dBFS (e.g. < −60 dBFS excellent / −60 to −50 good / −50 to −40 fair / > −40 poor — broadcast-practice guidance, not standardized; the UI should say so).

---

## 2. Reverberation

### 2.1 Background

- **ISO 3382-1:2009**: the international standard for room-acoustics measurements. Defines RT60 (T20/T30/EDT), **C50 (clarity index)**, and **D50 (definition)**. C50 = 10·log10(early energy 0–50 ms / late energy after 50 ms) [dB]; D50 is the early-energy ratio with **C50 = 10·log10(D50/(1−D50))**. JND is 5% for RT60 and 5% for D50.
  ([AcousPlan – ISO 3382 guide](https://acousplan.com/blog/iso-3382-room-acoustics-guide) / [AcousPlan – C50](https://acousplan.com/glossary/c50-clarity))
- **C50 predicts speech intelligibility better than RT60**: in Italian classroom studies, children's reading speed correlated with C50 but not RT; in non-diffuse rooms with absorbent ceilings, RT alone cannot explain intelligibility.
  ([Acoustic Bulletin – from RT to Clarity](https://www.acousticbulletin.com/from-rt-to-clarity-a-simpler-way-to-assess-classroom-speech-intelligibility/) / [Apex Acoustics – G and C50 for classroom design](https://apexacoustics.co.uk/wp-content/uploads/2015/07/2014_IOA_G-C50_Classrooms.pdf))
- **Schroeder backward integration**: integrating the squared impulse response backward yields the energy decay curve (EDC); linear regression estimates RT (extrapolated from T10/T20/T30). Blind estimation applies the same idea to free-decay segments of speech.
  ([VOCAL – Schroeder Integration and Reverberation Time](https://vocal.com/resources/schroeder-integration-and-reverberation-time/))

### 2.2 Metric: blind RT60 (implemented)

| Item | Content |
|---|---|
| **Name** | Blind RT60 (decay-rate distribution method) |
| **Method** | ① STFT → per-band power envelopes in dB → ② **detect "free decay" segments right after speech offsets** (monotonically decreasing energy for 100–400 ms) → ③ linear-regress the dB envelope per segment to get decay rates [dB/s] → ④ map the distribution of decay rates to RT60 = −60/slope. Backed by Ratnam et al. (2003, MLE-based), Wen & Habets (STFT-domain decay-rate distribution), and free-decay + subband variants reaching correlations of 91–97%. The Python reference implementation blind_rt60 (Ratnam method) is a good porting guide |
| **Thresholds** (conversational/speech recording) | **Excellent: RT60 < 0.3 s** (narration/studio grade) / **Good: 0.3–0.5 s** (≈ WELL open-office ≤ 0.5 s) / **Fair: 0.5–0.7 s** (ANSI S12.60 classroom limit 0.6 s, WELL meeting room 0.7 s) / **Poor: > 0.7 s**. Speech-priority spaces recommend 0.4–0.8 s; ANSI S12.60-2010 requires ≤ 0.6 s (< 283 m³); WELL v2: open office ≤ 0.5 / classroom ≤ 0.6 / meeting room ≤ 0.7 s |
| **Sources** | [Ratnam et al., "Blind estimation of reverberation time," JASA 2003](https://www.researchgate.net/publication/5923452_Blind_estimation_of_reverberation_time) / [Wen & Habets – decay-rate distribution](https://www.semanticscholar.org/paper/Blind-estimation-of-reverberation-time-based-on-the-Wen-Habets/67ad48a4771b1d40dfeb90ecbb7d5683214634cc) / [blind_rt60 (GitHub)](https://github.com/nuniz/blind_rt60) / [Commercial Acoustics – RT60 targets](https://commercial-acoustics.com/guides/reverberation-time-for-different-rooms/) / [NTi Audio – RT60](https://www.nti-audio.com/en/applications/room-building-acoustics/reverberation-time) |

**Implementation note**: stationary noise strongly biases decay-rate estimation. When the SNR score is low, the reverb estimate should be treated as low-confidence. ([noise-robust T60 – ResearchGate](https://www.researchgate.net/publication/259974784_Blind_reverberation_time_estimation_by_intrinsic_modeling_of_reverberant_speech))

### 2.3 Auxiliary: pseudo C50 / D50

Exact C50 cannot be measured without an impulse response, but assuming the Polack model (exponential decay e^(−13.8·t/RT60)), the estimated RT60 converts in closed form: **C50 ≈ 10·log10(e^(13.8·0.05/RT60) − 1)** (RT60 = 0.5 s → C50 ≈ +5.9 dB; 1.0 s → +2.3 dB; 1.5 s → +0.9 dB — conservative for close-miked speech where the direct sound dominates). Guidance: **C50 > +2 dB excellent-to-good, 0 to +2 dB good, −2 to 0 dB fair, < −2 dB poor** (classroom design treats ≥ 0 dB as acceptable, ≥ +2 dB as desirable; for D50, > 0.5 is good and > 0.65 excellent).
([AcousPlan – C50](https://acousplan.com/glossary/c50-clarity) / [MetricGate – C50/C80 & D50 Calculator](https://metricgate.com/docs/clarity-c50-c80-definition-d50/))

---

## 3. Level, clipping, bandwidth, spectrum

### 3.1 Metric: loudness (LUFS, ITU-R BS.1770 / EBU R128)

| Item | Content |
|---|---|
| **Name** | Integrated Loudness (LUFS) + True Peak |
| **Method** | ITU-R BS.1770 K-weighting (two biquads) → mean square over 400 ms blocks (75% overlap) → two-stage gating (**absolute −70 LUFS, relative −10 LU**) → Integrated LUFS. True Peak is the peak after 4x oversampling, in dBTP. EBU Tech 3341 defines Momentary (400 ms) / Short-term (3 s) / Integrated |
| **Thresholds** (web recording / podcast) | **Excellent: −20 to −14 LUFS** (Apple Podcasts −16, Spotify −14, AES recommendation −20 to −16) / **Good: −24 to −20 or −14 to −12 LUFS** (EBU R128 broadcast is −23 LUFS ± 0.5) / **Fair: −32 to −24 LUFS** (quiet but recoverable by normalization) / **Poor: < −32 or > −10 LUFS**. True Peak **≤ −1 dBTP** recommended |
| **Sources** | [EBU R128 – EBU Tech](https://tech.ebu.ch/loudness) / [MathWorks – EBU R128 implementation notes](https://www.mathworks.com/help/audio/ug/loudness-normalization-in-accordance-with-ebu-r-128-standard.html) / [Transom – Podcast Loudness](https://transom.org/2016/podcasting-basics-part-5-loudness-podcasts-vs-radio/) / [Descript – Podcast LUFS](https://www.descript.com/blog/article/podcast-loudness-standard-getting-the-right-volume) |

**Auxiliary: ITU-T P.56 Active Speech Level.** Telephony standard measuring RMS over speech segments only (Method B, 15.9 dB margin). LUFS covers the whole signal while ASL covers speech only; the **activity factor** comes as a by-product. VOICEBOX `v_activlev` is the reference implementation. (This app implements a simplified ASL.)
([ITU-T P.56 – GlobalSpec](https://standards.globalspec.com/std/1313732/p-56) / [VOICEBOX v_activlev](http://www.ee.ic.ac.uk/hp/staff/dmb/voicebox/mdoc/v_mfiles/v_activlev.html) / [VOCAL – P.56 level measurements](https://vocal.com/echo-cancellation/level-measurements-via-itu-p56-and-weighting/))

### 3.2 Metric: clipping (implemented)

| Item | Content |
|---|---|
| **Name** | Clipping ratio (amplitude-histogram method) |
| **Method** | ① Build an amplitude histogram (e.g. 256 bins) and flag unnatural local peaks in the outermost bins (also catches soft clipping below full scale — Google patent method). ② Simplified: count **consecutive samples with \|x\| ≥ 0.99·max** (ClipDaT-style) → clipped-sample ratio [%] |
| **Thresholds** | **Excellent: 0% (none detected)** / **Good: < 0.1%** / **Fair: 0.1–1%** / **Poor: > 1%**. Basis: a TIMIT study evaluating 0.5%–10% clipping with PESQ (P.862) found **speaker-recognition degradation already at 0.5% mild clipping**; subjective studies report MOS dropping from 3.49 to 1.73 with mild clipping — nonlinear distortion is perceptually severe |
| **Sources** | ["Nonlinear waveform distortion: clipping on speech data and systems" – Speech Communication](https://www.sciencedirect.com/science/article/pii/S0167639321000832) / [Google Patents US20140226829A1](https://patents.google.com/patent/US20140226829A1/en) |

### 3.3 Metric: frequency bandwidth (implemented)

| Item | Content |
|---|---|
| **Name** | Effective bandwidth (spectral roll-off + band-energy ratio) |
| **Method** | From the average power spectrum of speech frames, estimate ① the **upper roll-off frequency** (highest frequency where the long-term average spectrum exceeds the noise floor + 10 dB) and ② the lower cutoff. Compare against band templates: narrowband NB = 300–3400 Hz (G.711, fs 8 kHz), wideband WB = 50–7000 Hz (G.722, fs 16 kHz), super-wideband SWB up to ~14 kHz |
| **Thresholds** | **Excellent: upper ≥ 12 kHz and lower ≤ 80 Hz** (full-band capture) / **Good: upper ≥ 7 kHz (WB)** / **Fair: 3.4–7 kHz** / **Poor: ≤ 3.4 kHz (telephone grade) or lower cutoff > 300 Hz**. WB improves quality ~29% over NB; missing highs impair fricative ([s]/[f]) discrimination and sound "muffled." The SII (ANSI S3.5-1997) band-importance function peaks around **1–2 kHz** |
| **Sources** | [G.722 – Wikipedia](https://en.wikipedia.org/wiki/G.722) / [NB/WB/SWB quality-dimension comparison – ResearchGate](https://www.researchgate.net/publication/279529681_Comparison_of_Transmission_Quality_Dimensions_of_Narrowband_Wideband_and_Super-Wideband_Speech_Channels) / [ANSI S3.5 SII – R package docs](https://rdrr.io/cran/SII/man/critical.html) / [ANSI Blog – SII](https://blog.ansi.org/ansi/speech-intelligibility-index/) |

### 3.4 Metric: spectral character (muffling / noisiness)

| Item | Content |
|---|---|
| **Name** | (a) Alpha ratio (spectral tilt), (b) spectral flatness (silent segments), (c) spectral centroid |
| **Method** | (a) **Alpha ratio = 10·log10(E[1–5 kHz] / E[50 Hz–1 kHz])** from the long-term average spectrum (LTAS) of speech; Byrne et al. (1994) "universal LTASS" serves as the reference shape. (b) **Spectral flatness = geometric mean / arithmetic mean** of the power spectrum, computed on **non-speech segments**: near 1 = broadband noise (fan/hiss), low = tonal noise (hum) → used for noise-type diagnosis. (c) centroid = power-weighted mean frequency |
| **Thresholds** | (a) Normal speech alpha ratio is roughly **−25 to −18 dB**; **6 dB below the reference → "muffled" (fair), 10 dB below → poor** (not standardized; operate as deviation from the LTASS template). (b) Flatness > 0.5 on silence with a high floor → broadband noise; 50/60 Hz peaks → hum classification (diagnostic use, not a standalone score) |
| **Sources** | [Byrne et al. 1994 "An international comparison of LTASS," JASA](https://asa.scitation.org/doi/10.1121/1.410152) ([PDF](https://harlmemphis.org/wp-content/uploads/2020/06/international-.pdf)) / [Sundberg & Nordenberg 2006](https://pubmed.ncbi.nlm.nih.gov/16875241/) / [Lu & Cooke – spectral tilt and intelligibility](https://www.sciencedirect.com/science/article/abs/pii/S0167639309001253) / [Spectral flatness – Wikipedia](https://en.wikipedia.org/wiki/Spectral_flatness) / [librosa spectral_flatness](https://librosa.org/doc/main/generated/librosa.feature.spectral_flatness.html) |

---

## 4. Overall scoring

### 4.1 Mapping to the MOS scale (P.800 / P.800.1)

- Display on the **P.800 ACR 5-point scale (5 Excellent / 4 Good / 3 Fair / 2 Poor / 1 Bad)**.
  ([ITU-T P.800.1 – MOS terminology](https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-P.800.1-201607-I!!PDF-E&type=items))
- The **E-model (ITU-T G.107)** convention fits best: build a 0–100 R value by **subtracting** impairment factors, then map to MOS with the standard formula **MOS = 1 + 0.035R + R(R−60)(100−R)·7×10⁻⁶**. Satisfaction bands: **R ≥ 90 (MOS ≈ 4.34) = Very satisfied, ≥ 80 (4.03) = Satisfied, ≥ 70 (3.60) = Some dissatisfied, ≥ 60 (3.10) = Many dissatisfied, ≥ 50 (2.58) = Nearly all dissatisfied**.
  ([ITU-T G.107 PDF](https://www.itu.int/rec/dologin_pub.asp?lang=s&id=T-REC-G.107-201402-S!!PDF-E&type=items) / [E-model explainer](http://what-when-how.com/voip/e-model-based-voice-quality-estimation-voip/))

### 4.2 Weighting references

- **Hu & Loizou (2008)**: regression on P.835 subjective data shows **OVRL is explained by a linear combination of SIG and BAK with ρ = 0.927**, and **listeners weight SIG (signal distortion) more than BAK**.
  ([Hu & Loizou PDF – UT Dallas](https://ecs.utdallas.edu/loizou/speech/obj_paper_jan08.pdf))
- **NISQA's four dimensions** (Noisiness / Coloration / Discontinuity / Loudness) map to: Noisiness = SNR, Coloration = bandwidth + tilt + reverb, Discontinuity = clipping/dropouts, Loudness = level.
- Initial weights (out of 100): **noise (SNR) up to −35 / reverb up to −25 / level up to −15 / clipping up to −15 / bandwidth+spectrum up to −10**, plus a **weakest-link constraint** (the worst axis caps the overall rating), reflecting the perceptual reality that a single severe defect dominates. These weights are a design decision derived from Hu & Loizou's signal-distortion dominance and G.107's additive-impairment structure, not directly prescribed by any standard.

### 4.3 Caveats

- Blind SNR and RT60 carry sizable errors even in the literature (blind RT60 correlations ≈ 0.9, biased under noise). Present them as "estimates," not measurements.
- The SNR thresholds (30/20 dB) are broad industry conventions, not values fixed by a single ITU standard.
- RT60/C50 thresholds come from room-design standards (ANSI S12.60, WELL, ISO 3382); close-miked recordings sound better at the same RT60 because the direct sound dominates, so operate the thresholds conservatively.

---

# Second-round survey (2026-08): additional metrics

Follow-up survey on degradation modes the original five metrics cannot capture, merging the results of two research passes (① noise types and temporal artifacts, ② distortion and speech artifacts).

## Adopted metrics

### A. Dropout detection (implemented)

- **Positioning**: signal-level proxy for [NISQA](https://arxiv.org/abs/2104.09494)'s Discontinuity dimension; ITU-T P.563 ranks interruptions as the 2nd most annoying distortion class
- **Method**: (a) runs of strictly zero sample-to-sample difference ≥ 2 ms (zero-fill / constant-fill buffer underruns; constant-value underruns documented in [XMOS issue #134](https://github.com/xmos/sw_usb_audio/issues/134)); (b) envelope breaks where the 2 ms RMS falls ≥ 25 dB, sinks 10 dB below the acoustic noise floor, and recovers within 100 ms
- **False-positive control**: only "holes inside signal" count (both 100 ms sides at active level); speech pauses bottom out at the acoustic noise floor and are therefore distinguishable
- **Sources**: [US patent 11183202](https://patents.google.com/patent/US11183202B2/en), [Audio Precision on glitch/dropout detection](https://www.ap.com/blog/detecting-glitches-and-dropouts-with-apx500)

### B. Mains hum detection (implemented)

- **Method**: on the longest contiguous silent stretch (≥ 0.8 s), scan the 50 Hz and 60 Hz fundamentals over ±3% with the Goertzel algorithm, measure harmonics k = 1..8 against a local floor (median of nearby off-harmonic frequencies), and report hum when ≥ 3 harmonics exceed the floor by +10 dB. A contiguous stretch is required — concatenated silence smears tones through phase discontinuities
- **Threshold**: −45 dB vs active speech level = inaudible in practice (derived from the ACX audiobook noise-floor requirement of −60 dBFS ≈ −40 dB vs speech)
- **Sources**: [Brandt & Bitzer (Fraunhofer), "Detection of Hum in Audio Signals"](https://www.researchgate.net/publication/265984226_Detection_of_Hum_in_Audio_Signals), [Dolby patent WO2022023415A1](https://patents.google.com/patent/WO2022023415A1/en), [ITU-T O.41](https://www.itu.int/rec/T-REC-O.41/en) (psychoacoustic weighting), [ACX requirements](https://chapterpass.com/blog/acx-audio-requirements)

### C. True Peak / headroom (implemented)

- **Method**: 4x oversampling per [ITU-R BS.1770-5](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf) Annex 2 (48-tap, 4-phase FIR interpolation with windowed-sinc coefficients)
- **Thresholds**: ≤ −3 dBTP safe / −3 to −1 dBTP caution / > −1 dBTP warning. AES TD1008: lossy codecs (Opus etc. — always in the path for web calls) add overshoot cumulatively, so keep codec inputs at or below −1 dBTP
- **Sources**: [AES loudness project / TD1008](https://aes2.org/resources/audio-topics/loudness-project/learn-more/), [EBU Tech 3341](https://tech.ebu.ch/docs/tech/tech3341.pdf)

### D. Plosive pop detection (implemented)

- **Method**: from a 2-stage first-order IIR LPF at 150 Hz, detect bursts within speech where the low-frequency power ratio exceeds 0.5 and the low-band level exceeds the running median by 12 dB for 2–10 consecutive frames (20–100 ms)
- **Sources**: [Shiota et al., INTERSPEECH 2015](https://www.isca-archive.org/interspeech_2015/shiota15_interspeech.html) (pops are 20–100 ms transients concentrated below ≈ 40–100 Hz), [POCO corpus](https://github.com/aurtg/poco), [Transom on P-pops](https://transom.org/2016/p-pops-plosives/)

## Diagnostic layer (no score contribution; advice only when detected)

- **Noise-type classification**: when the SNR rating is fair/poor, classify the noise LTAS by spectral flatness ([originating with Johnston 1988](https://en.wikipedia.org/wiki/Spectral_flatness)) + low-band ratio + stationarity into fan/HVAC, hiss, or ambient categories, replacing the generic noise advice with a cause-specific one
- **AGC pumping**: AGC suspected when the noise floor in 200–500 ms gaps after speech offsets sits ≥ 6 dB above the initial silent stretch (the noise-pumping mechanism of [US 4975657](https://patents.google.com/patent/US4975657A/en)). EBU Tech 3342's LRA was rejected because the standard itself warns of overestimation on recordings under ~60 s (ours is 8 s)
- **DC offset**: warn when |mean| > 1% FS ([practical guidance](https://audioutils.com/guide/what-is-dc-offset): ≤ 0.1% negligible / > 1% should be fixed)

## Rejected candidates and why

| Candidate | Reason |
|---|---|
| THD-style nonlinear distortion | Unmeasurable without a reference by definition; blind estimation requires MCMC/diffusion-model ML; [THD correlates poorly with perceived quality](https://www.researchgate.net/publication/282646994) |
| Comb filtering (desk reflections) | Implementable via cepstrum but needs empirical calibration to separate from pitch and device response. Second-wave candidate ([Salomons 1995](https://www.researchgate.net/publication/341000526_Coloration_and_binaural_decoloration_of_sound_due_to_reflections), [DPA explainer](https://www.dpamicrophones.com/mic-university/audio-production/the-basics-about-comb-filtering-and-how-to-avoid-it/)) |
| Excess sibilance | False-positive risk from speaker voice and language (Japanese has frequent /s/). Could ship as an informational 5–10 kHz band-ratio metric ([Dolby patent US10867620](https://patents.google.com/patent/US10867620B2/en)) |
| Keyboard/impulsive noise | Detection depends on the event occurring during the short test recording; the kurtosis method itself is established ([Applied Acoustics](https://www.sciencedirect.com/science/article/abs/pii/S0003682X10001167)) |
| LRA (loudness range) | [EBU Tech 3342](https://tech.ebu.ch/docs/tech/tech3342.pdf) itself warns of overestimation for isolated utterances under ~60 s |
