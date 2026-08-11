// Tiny i18n for the static site.
// Auto-detects ja/en from the browser language; a manual toggle persists in localStorage.
// Static texts are applied via data-i18n attributes; dynamic strings use t(key, params).

const STR = {
  ja: {
    subtitle: 'マイクを選んで数秒話すだけで、音声の明瞭さをスコアリングします',
    step_mic: 'マイクを選択',
    step_record: '録音してチェック',
    step_result: '結果',
    btn_permission: '🎤 マイクを許可',
    opt_placeholder: '← まずマイクへのアクセスを許可してください',
    raw_mode: 'ブラウザの補正（ノイズ抑制・エコーキャンセル・自動ゲイン）を無効にして素の音を測る',
    hint_html: '録音開始後、<strong>最初の1秒は黙って</strong>（ノイズ測定）、そのあと普段どおりの声量で<strong>5秒ほど話して</strong>ください。<br>例:「お世話になっております。本日はマイクのテストをしています。聞こえ方はいかがでしょうか。」',
    btn_record: '● 録音開始',
    btn_stop: '■ 停止して解析',
    normalize: '音量を上げて再生',
    advice_title: '💡 改善ポイント',
    btn_retry: 'もう一度測定する',
    methodology_summary: 'スコアリングの根拠について',

    status_quiet: '🤫 静かにしてください（背景ノイズを測定中）… 残り{s}秒',
    status_speak: '🗣️ 普段どおりの声で話してください… 残り{s}秒',
    status_analyzing: '解析中…',
    err_denied: 'マイクへのアクセスが拒否されました: {msg}',
    err_open: 'マイクを開けませんでした: {msg}',
    err_short: '録音が短すぎます。2秒以上録音してください。',
    err_analysis: '解析エラー: {msg}',
    err_no_speech: '音声が検出できませんでした。マイクに向かって話してください。',
    mic_fallback: 'マイク ({id})',

    rating_excellent: '非常に良い',
    rating_good: '良い',
    rating_fair: 'やや難あり',
    rating_poor: '要改善',
    overall_desc: '推定MOS {mos} / 5.0 — {desc}',
    desc_excellent: 'オンライン会議・録音に十分な品質です。相手にクリアに聞こえます。',
    desc_good: '実用上は問題ないレベルです。改善ポイントに対応するとさらに良くなります。',
    desc_fair: '聞き取りづらさを感じさせる可能性があります。改善ポイントを確認してください。',
    desc_poor: '相手が聞き取りに苦労するレベルです。改善ポイントへの対応をおすすめします。',
    points: '{n}点',

    m_snr: '🔇 ノイズ (SNR推定)',
    m_snr_value: 'SNR {snr} dB',
    m_snr_note: '背景ノイズ {noise} dBFS。30dB以上でクリーン録音の水準。',
    extra_short_speech: '発話が短く推定精度は低めです。',
    m_reverb: '🏛️ 反響 (RT60推定)',
    m_reverb_value: 'RT60 ≈ {ms} ms',
    m_reverb_note: 'C50換算 ≈ {c50} dB（+2dB以上が望ましい）。会議・録音用途はRT60 0.5秒以下が目安。',
    extra_few_decays: '減衰イベントが少なく推定精度は低めです。',
    m_reverb_none_value: '顕著な残響なし',
    m_reverb_none_note: '明確な残響の減衰は検出されませんでした（デッドな環境か、マイクが口元に近い状態です）。',
    m_reverb_noisy_value: '判定不可（ノイズ過多）',
    m_reverb_noisy_note: 'ノイズが多いと残響推定は信頼できないため判定を保留しました。',
    m_level: '🎚️ 録音レベル',
    m_level_value: '発話レベル {db} dBFS',
    m_level_note: '-20〜-14 dBFSが最適域。低すぎるとノイズに埋もれ、高すぎると歪みます。',
    m_clip: '📉 音割れ',
    m_clip_none: '検出なし',
    m_clip_value: '{pct}%',
    m_clip_note: '波形がフルスケールに達して歪んだサンプルの割合。0.5%でも品質劣化が報告されています。',
    m_spec: '🎛️ 周波数特性 (こもり)',
    m_spec_value: '帯域 〜{khz} kHz ({label})',
    band_full: 'フルバンド',
    band_wide: '広帯域',
    band_mid: '中間帯域',
    band_nb: '電話品質',
    m_spec_note: 'スペクトル傾斜 (alpha ratio) {alpha} dB。通常発話は-25〜-18dB付近、これより大きく低いと「こもった」音です。',

    m_dropout: '🔌 接続の安定性',
    m_dropout_none: '途切れなし',
    m_dropout_value: '音切れ {n}件',
    m_dropout_note: '録音中の欠落・音切れ（USB/Bluetooth接続やドライバの問題）。1件でも明確に知覚されます。',
    m_hum: '⚡ 電源ハム',
    m_hum_none: '検出なし',
    m_hum_value: '{hz}Hz系 / 対発話 {db} dB',
    m_hum_na_value: '判定不可（無音区間不足）',
    m_hum_na_note: 'ハム判定には0.8秒以上の無音区間が必要です。録音冒頭で少し長めに黙ってください。',
    m_hum_note: '電源由来の50/60Hzとその倍音。発話比-45dB以下なら実用上聞こえない水準です。',
    m_tp: '📈 ピークマージン',
    m_tp_value: '{db} dBTP',
    m_tp_note: 'True Peak（ITU-R BS.1770）。-1dBTPを超えると通話コーデック変換時に歪むおそれがあります。',
    m_pop: '💨 ポップノイズ',
    m_pop_none: '検出なし',
    m_pop_value: '{n}回検出',
    m_pop_note: '破裂音（パ行・バ行）の息がマイクに当たって出る低域バースト。',

    a_noise: 'ノイズ',
    a_reverb: '反響',
    a_level: '録音レベル',
    a_clip: '音割れ',
    a_band: '帯域',
    a_muffle: 'こもり',
    a_dropout: '接続',
    a_hum: '電源ノイズ',
    a_tp: 'ピーク',
    a_pop: 'ポップ',
    a_agc: '自動ゲイン',
    a_dc: 'DCオフセット',
    adv_noise: 'エアコン・PCファン・環境音を減らすか、マイクを口元に近づけてください（距離を半分にすると音声だけ約6dB上がります）。単一指向性マイクの使用も有効です。',
    adv_reverb: '部屋の反響が多めです。カーテン・カーペット・本棚のある部屋を使う、壁やガラス面から離れる、マイクを口元に近づける、と改善します。',
    adv_level_low: '声が小さく録れています。OSのマイク入力ゲインを上げるか、マイクに近づいてください。',
    adv_level_high: '入力が大きすぎます。マイクゲインを下げるか、マイクから少し離れてください。',
    adv_clip: '音割れが発生しています。マイクゲインを下げてください。ポップガードや口とマイクの距離確保も有効です。',
    adv_band: '高域が{khz}kHzまでしか録れていません。Bluetoothマイクの場合は通話モード（HFP）に落ちている可能性が高いので有線接続を試してください。7kHz以上が広帯域音声の目安です。',
    adv_muffle: '中高域が不足して、こもって聞こえる可能性があります。マイクの正面を口に向ける、布・カバー越しの収音を避ける、と改善します。',
    adv_dropout: '録音が途切れています。Bluetoothマイクなら有線接続を試す、USBならポート/ハブを変える、他のアプリがマイクを使っていないか確認してください。',
    adv_hum: '電源由来のハムノイズ（{hz}Hz系）が乗っています。USB電源やケーブルの取り回し、オーディオインターフェースの接地、ACアダプタの変更を試してください。',
    adv_tp: 'ピークが0dBFS近くまで達しています（{db} dBTP）。通話アプリのコーデック変換で歪むおそれがあるため、入力ゲインを下げて-3dBTP以下を目安にしてください。',
    adv_pop: '破裂音の吹かれ（ポップノイズ）が出ています。ポップガードを使うか、マイクを口の真正面から少し斜めに外してください。',
    adv_noise_fan: 'ノイズはファン・空調系の定常ノイズです。マイクをPC本体や空調から離す、単一指向性マイクを使う、と改善します。',
    adv_noise_hiss: 'ノイズは広帯域のヒスノイズです。マイクゲインの上げすぎ、またはマイク自体の自己雑音が原因の可能性があります。ゲインを下げて口元に近づけてください。',
    adv_noise_env: 'ノイズが時間的に変動しています（環境音・生活音系）。静かな部屋に移るか、単一指向性マイクで口元収音にすると改善します。',
    adv_agc: '無音時にノイズフロアが持ち上がっており、自動ゲイン制御（AGC）が動作している可能性があります。「ブラウザの補正を無効にして素の音を測る」がオンか、OS側のマイク自動調整設定を確認してください。',
    adv_dc: '信号にDCオフセット（直流成分）が乗っています。オーディオインターフェースまたはドライバの異常の可能性があります。',
    adv_ok: '特に問題ありません。このまま使えます 👍',
  },
  en: {
    subtitle: 'Pick a microphone and speak for a few seconds to score how clear you sound',
    step_mic: 'Select a microphone',
    step_record: 'Record & check',
    step_result: 'Results',
    btn_permission: '🎤 Allow microphone',
    opt_placeholder: '← Allow microphone access first',
    raw_mode: 'Disable browser processing (noise suppression, echo cancellation, auto gain) to measure the raw mic',
    hint_html: 'After recording starts, <strong>stay silent for the first second</strong> (noise measurement), then <strong>speak for about 5 seconds</strong> at your normal volume.<br>e.g. "Hi, this is a microphone test. How do I sound to you today?"',
    btn_record: '● Start recording',
    btn_stop: '■ Stop & analyze',
    normalize: 'Boost playback volume',
    advice_title: '💡 How to improve',
    btn_retry: 'Measure again',
    methodology_summary: 'About the scoring methodology',

    status_quiet: '🤫 Stay quiet (measuring background noise)… {s}s left',
    status_speak: '🗣️ Speak at your normal volume… {s}s left',
    status_analyzing: 'Analyzing…',
    err_denied: 'Microphone access was denied: {msg}',
    err_open: 'Could not open the microphone: {msg}',
    err_short: 'Recording too short. Please record at least 2 seconds.',
    err_analysis: 'Analysis error: {msg}',
    err_no_speech: 'No speech detected. Please speak into the microphone.',
    mic_fallback: 'Microphone ({id})',

    rating_excellent: 'Excellent',
    rating_good: 'Good',
    rating_fair: 'Fair',
    rating_poor: 'Poor',
    overall_desc: 'Estimated MOS {mos} / 5.0 — {desc}',
    desc_excellent: 'Great quality for online meetings and recording. You will sound clear.',
    desc_good: 'Perfectly usable. Addressing the tips below will make it even better.',
    desc_fair: 'Listeners may find you hard to hear at times. Check the tips below.',
    desc_poor: 'Listeners will likely struggle to understand you. Please address the tips below.',
    points: '{n} pts',

    m_snr: '🔇 Noise (SNR est.)',
    m_snr_value: 'SNR {snr} dB',
    m_snr_note: 'Background noise {noise} dBFS. 30 dB or more is considered a clean recording.',
    extra_short_speech: 'Short speech sample — lower estimation accuracy.',
    m_reverb: '🏛️ Reverb (RT60 est.)',
    m_reverb_value: 'RT60 ≈ {ms} ms',
    m_reverb_note: 'C50 equivalent ≈ {c50} dB (+2 dB or more is desirable). Aim for RT60 under 0.5 s for meetings and recording.',
    extra_few_decays: 'Few decay events — lower estimation accuracy.',
    m_reverb_none_value: 'No significant reverb',
    m_reverb_none_note: 'No clear reverberant decay was detected (a dead room, or the mic is close to your mouth).',
    m_reverb_noisy_value: 'Inconclusive (too noisy)',
    m_reverb_noisy_note: 'Reverb estimation is unreliable under heavy noise, so this check was skipped.',
    m_level: '🎚️ Recording level',
    m_level_value: 'Speech level {db} dBFS',
    m_level_note: '-20 to -14 dBFS is the sweet spot. Too low drowns in noise; too high distorts.',
    m_clip: '📉 Clipping',
    m_clip_none: 'None detected',
    m_clip_value: '{pct}%',
    m_clip_note: 'Share of samples distorted at full scale. Even 0.5% is reported to degrade quality.',
    m_spec: '🎛️ Frequency response',
    m_spec_value: 'Bandwidth up to {khz} kHz ({label})',
    band_full: 'full band',
    band_wide: 'wideband',
    band_mid: 'mid band',
    band_nb: 'telephone grade',
    m_spec_note: 'Spectral tilt (alpha ratio) {alpha} dB. Normal speech sits around -25 to -18 dB; far below that sounds muffled.',

    m_dropout: '🔌 Connection stability',
    m_dropout_none: 'No dropouts',
    m_dropout_value: '{n} dropout(s)',
    m_dropout_note: 'Gaps or glitches during recording (USB/Bluetooth or driver issues). Even one is clearly audible.',
    m_hum: '⚡ Mains hum',
    m_hum_none: 'None detected',
    m_hum_value: '{hz} Hz family / {db} dB vs speech',
    m_hum_na_value: 'Inconclusive (not enough silence)',
    m_hum_na_note: 'Hum detection needs at least 0.8 s of silence. Stay quiet a bit longer at the start of the recording.',
    m_hum_note: 'Power-line 50/60 Hz and its harmonics. At -45 dB vs speech or lower it is practically inaudible.',
    m_tp: '📈 Peak headroom',
    m_tp_value: '{db} dBTP',
    m_tp_note: 'True Peak (ITU-R BS.1770). Above -1 dBTP the signal may distort through call codecs.',
    m_pop: '💨 Plosive pops',
    m_pop_none: 'None detected',
    m_pop_value: '{n} detected',
    m_pop_note: 'Low-frequency bursts caused by breath from plosives (p/b sounds) hitting the mic.',

    a_noise: 'Noise',
    a_reverb: 'Reverb',
    a_level: 'Level',
    a_clip: 'Clipping',
    a_band: 'Bandwidth',
    a_muffle: 'Muffled',
    a_dropout: 'Connection',
    a_hum: 'Mains noise',
    a_tp: 'Peak',
    a_pop: 'Pops',
    a_agc: 'Auto gain',
    a_dc: 'DC offset',
    adv_noise: 'Reduce AC, PC fans and ambient noise, or move the mic closer to your mouth (halving the distance gains ~6 dB of speech). A unidirectional mic also helps.',
    adv_reverb: 'The room is quite reverberant. Use a room with curtains, carpet or bookshelves, move away from walls and glass, and bring the mic closer to your mouth.',
    adv_level_low: 'Your voice is recorded too quietly. Raise the OS input gain or move closer to the mic.',
    adv_level_high: 'The input is too hot. Lower the mic gain or move a little away from the mic.',
    adv_clip: 'Clipping detected. Lower the mic gain. A pop filter and some distance from the mic also help.',
    adv_band: 'Highs are captured only up to {khz} kHz. If this is a Bluetooth mic it has likely dropped to call mode (HFP) — try a wired connection. 7 kHz+ is the wideband speech benchmark.',
    adv_muffle: 'Mid-high frequencies are lacking, which can sound muffled. Point the front of the mic at your mouth and avoid recording through cloth or covers.',
    adv_dropout: 'The recording drops out. If using a Bluetooth mic, try a wired connection; for USB, try another port/hub, and make sure no other app is holding the microphone.',
    adv_hum: 'Power-line hum ({hz} Hz family) is present. Check USB power and cable routing, audio-interface grounding, or try a different power adapter.',
    adv_tp: 'Peaks reach close to 0 dBFS ({db} dBTP). This risks distortion through call codecs — lower the input gain and aim for -3 dBTP or below.',
    adv_pop: 'Plosive pops detected. Use a pop filter, or angle the mic slightly off-axis from your mouth.',
    adv_noise_fan: 'The noise is steady fan/HVAC-type noise. Move the mic away from your PC or air conditioning, or use a unidirectional mic.',
    adv_noise_hiss: 'The noise is broadband hiss. The mic gain may be too high, or the mic self-noise is a factor. Lower the gain and move closer to the mic.',
    adv_noise_env: 'The noise fluctuates over time (ambient/household sounds). Move to a quieter room or use a unidirectional mic up close.',
    adv_agc: 'The noise floor rises during silence, suggesting automatic gain control (AGC) is active. Make sure "Disable browser processing" is checked, and review OS-level mic auto-adjust settings.',
    adv_dc: 'The signal carries a DC offset. This may indicate a faulty audio interface or driver.',
    adv_ok: 'No issues found. You are good to go 👍',
  },
};

let lang = 'en';
const listeners = [];

export function detectLang() {
  const saved = localStorage.getItem('lang');
  if (saved === 'ja' || saved === 'en') return saved;
  return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function getLang() {
  return lang;
}

export function t(key, params) {
  let s = (STR[lang] && STR[lang][key]) ?? (STR.en[key] ?? key);
  if (params) for (const k of Object.keys(params)) s = s.replaceAll(`{${k}}`, params[k]);
  return s;
}

export function applyI18n() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  for (const b of document.querySelectorAll('.lang-switch button')) {
    b.classList.toggle('active', b.dataset.lang === lang);
  }
}

export function setLang(next) {
  lang = next === 'ja' ? 'ja' : 'en';
  localStorage.setItem('lang', lang);
  applyI18n();
  for (const fn of listeners) fn(lang);
}

// onChange: hook for re-rendering dynamic texts (e.g. the results view) on language switch.
export function initI18n(onChange) {
  lang = detectLang();
  if (onChange) listeners.push(onChange);
  applyI18n();
  for (const b of document.querySelectorAll('.lang-switch button')) {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  }
}
