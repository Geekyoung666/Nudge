'use strict';

/**
 * Nudge v1.5 — Voice 层（前端，Whisper WASM 版）
 *
 * 取代原 Web Speech Recognition：原方案依赖浏览器厂商云端识别服务
 * （Chrome=Google），在开源 Chromium / 大陆网络 / Firefox·Safari 下 start() 必失败。
 *
 * 现方案：@xenova/transformers 在浏览器本地跑 Whisper tiny——
 *   - 离线识别、无密钥、纯前端（不碰 /server）；
 *   - 库与 onnxruntime 的 wasm 走 jsDelivr（带 CORS）；
 *   - 模型权重复制到同源 /public/models（离线、大陆可用、无 CORS）；
 *   - 语音只负责 speech→text；业务决策由 Runtime 完成（复用 NudgeText.fillAndSend）。
 *
 * 流程：点击 mic → 首次异步加载模型（提示「正在加载…」）→ getUserMedia+MediaRecorder 采音
 *        → 停止 → 解码并重采样为 16k mono PCM → 本地 ASR → 文本交给 fillAndSend。
 *
 * Presence（§33）：IDLE / LISTENING / THINKING / SPEAKING / DECISION_UPDATED / AMBIENT
 *   - 仅在真正开始聆听才进入 LISTENING；识别失败绝不伪造 listening；文字输入始终可用。
 * 约束：无 Math.random 决策；无 S1/S2/S3/Fidelity/Policy；不展示 CoT。
 */

window.NudgeVoice = (function () {
  var ENGINE_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  var MODEL_ID = 'Xenova/whisper-tiny';   // 多语言含中文；权重同源托管于 /public/models；需更准可换 whisper-base

  var transcriber = null;     // 已加载的 ASR pipeline
  var loading = false;        // 模型加载中（防重复触发）
  var recording = false;
  var pressing = false;     // V17：用户是否正按住（mousedown/touchstart=true，mouseup/touchend/mouseleave/cancel=false）
  var stream = null;
  var mr = null;
  var chunks = [];

  var HINTS = {
    'zh-CN': {
      tapToLoad: '点击麦克风，首次将加载语音模型（约数十 MB）',
      loading: '正在加载语音识别模型…',
      ready: '可以说话了',
      listening: '正在聆听…说完松手',
      transcribing: '识别中…',
      denied: '麦克风权限被拒绝，请在浏览器允许后重试',
      noSpeech: '没听到声音，请再试一次',
      unsupported: '当前浏览器不支持录音，请用文字输入',
      unavailable: '语音识别暂不可用，文字输入仍可使用'
    },
    'en-US': {
      tapToLoad: 'Tap mic — first use loads the voice model (~tens of MB)',
      loading: 'Loading speech model…',
      ready: 'Ready to listen',
      listening: 'Listening… release when done',
      transcribing: 'Transcribing…',
      denied: 'Microphone blocked — allow access and retry',
      noSpeech: 'No speech detected, try again',
      unsupported: 'Recorder unsupported here — use text input',
      unavailable: 'Speech recognition unavailable — text input still works'
    }
  };

  function locale() {
    return (window.NudgeApp && window.NudgeApp.locale === 'en-US') ? 'en-US' : 'zh-CN';
  }
  function hint(key, isError) {
    var h = document.getElementById('voiceHint');
    if (!h) return;
    var d = HINTS[locale()] || HINTS['zh-CN'];
    h.textContent = d[key] || key;
    if (isError) h.classList.add('is-error'); else h.classList.remove('is-error');
  }
  function micState(s) {
    var m = document.getElementById('micBtn');
    if (!m) return;
    m.classList.toggle('is-listening', s === 'listening');
    m.classList.toggle('is-error', s === 'error');
  }
  function presence(p) { if (window.NudgeApp && window.NudgeApp.setPresence) window.NudgeApp.setPresence(p); }
  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  async function ensureModel() {
    if (transcriber) return transcriber;
    if (loading) return null;
    if (!supported()) return null;
    loading = true;
    hint('loading', false);
    try {
      var mod = await import(ENGINE_URL);
      if (mod.env) {
        // 模型权重同源托管于 /public/models（无 CORS、离线、大陆可用）；
        // transformers.js 默认从 localModelPath+MODEL_ID 即 /models/Xenova/whisper-tiny 读取。
        // 库与 onnxruntime 的 wasm 仍走 jsDelivr（带 CORS 头）。
        mod.env.allowLocalModels = true;
        mod.env.localModelPath = '/models/';
      }
      transcriber = await mod.pipeline('automatic-speech-recognition', MODEL_ID, { dtype: 'q8' });
      hint('ready', false);
      return transcriber;
    } catch (e) {
      loading = false; transcriber = null;
      hint('unavailable', true); micState('error');
      return null;
    }
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  function mixMono(audio) {
    var n = audio.length, ch = audio.numberOfChannels, out = new Float32Array(n), i, c, d;
    for (c = 0; c < ch; c++) {
      d = audio.getChannelData(c);
      for (i = 0; i < n; i++) out[i] += d[i] / ch;
    }
    return out;
  }
  function resample(data, from, to) {
    var off = new OfflineAudioContext(1, Math.max(1, Math.ceil(data.length * to / from)), to);
    var buf = off.createBuffer(1, data.length, from);
    buf.copyToChannel(data, 0);
    var src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    return off.startRendering().then(function (r) { return r.getChannelData(0); });
  }

  async function transcribe(blob) {
    try {
      var buf = await blob.arrayBuffer();
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      var audio = await ctx.decodeAudioData(buf);
      var mono = audio.numberOfChannels > 1 ? mixMono(audio) : audio.getChannelData(0);
      var pcm = await resample(mono, audio.sampleRate, 16000);
      hint('transcribing', false);
      var out = await transcriber(
        { array: pcm, sampling_rate: 16000 },
        {
          language: locale() === 'en-US' ? 'english' : 'chinese',
          task: 'transcribe',
          chunk_length_s: 30,
          return_timestamps: false
        }
      );
      return (out && out.text) ? out.text.trim() : '';
    } catch (e) {
      hint('unavailable', true); micState('error');
      return '';
    }
  }

  // 视觉：按下时按钮变深青 + 文案变「松开发送」，两条波形跳动；松开全部复位
  function setPressedVisual(on) {
    var m = document.getElementById('micBtn');
    var lbl = document.getElementById('micLabel');
    if (m) m.classList.toggle('is-active', on);
    if (lbl) {
      try { lbl.textContent = on ? window.t('mic.release') : window.t('mic.label'); }
      catch (e) { lbl.textContent = on ? '松开发送' : '按住说话'; }
    }
    var waves = document.querySelectorAll('.voice-dock__wave');
    for (var i = 0; i < waves.length; i++) waves[i].classList.toggle('wave-active', on);
  }

  // 真正「按下录音」：mousedown / touchstart 触发。
  // pressing 标志处理「模型首次异步加载耗时数秒」的竞态——松手早于加载完成则绝不开始录音。
  async function begin() {
    if (window.NudgeImmersive) window.NudgeImmersive.enter();   // 按下「按住说话」→ 进入沉浸（先于模型加载，按下即生效）
    if (!supported()) { hint('unsupported', true); micState('error'); return; }
    pressing = true;
    setPressedVisual(true);
    if (recording) return;
    var tr = await ensureModel();
    if (!pressing) { setPressedVisual(false); return; }   // 松手早于点模型加载完成 → 放弃录音
    if (!tr) { setPressedVisual(false); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      pressing = false; setPressedVisual(false);
      hint('denied', true); micState('error'); return;
    }
    if (!pressing) { stopStream(); setPressedVisual(false); return; }  // 授权回来时已经松手 → 放弃
    var sessionChunks = [];   // 会话级缓冲，避免快速二次录音时与模块级 chunks 串味
    mr = new MediaRecorder(stream);
    mr.ondataavailable = function (e) { if (e.data && e.data.size) sessionChunks.push(e.data); };
    mr.onstop = async function () {
      micState('idle');
      setPressedVisual(false);
      var blob = new Blob(sessionChunks, { type: mr.mimeType || 'audio/webm' });
      stopStream();
      presence('THINKING');
      var text = await transcribe(blob);
      if (text) {
        if (window.NudgeText) window.NudgeText.fillAndSend(text);
      } else {
        hint('noSpeech', false); presence('AMBIENT');
      }
    };
    mr.start();
    recording = true; presence('LISTENING'); hint('listening', false);
  }

  // 松开 / 划出按钮 / 触摸取消 / 异常 → 停止录音。
  // pressing=false 后即便模型仍在加载也不会开始录音（防卡死）。
  function end() {
    pressing = false;
    setPressedVisual(false);
    if (window.NudgeImmersive) window.NudgeImmersive.ping();   // 松开录音 → 起 3s 计时，停录后自动退出沉浸
    if (mr && recording) {
      recording = false;          // 先置位，再 stop()；onstop 已不再依赖 recording 判断，避免竞态漏转写
      try { mr.stop(); } catch (e) { /* ignore */ }
    }
  }

  function init() {
    var mic = document.getElementById('micBtn');
    if (!mic) return;
    if (!supported()) { hint('unsupported', true); micState('error'); mic.disabled = true; return; }

    function onDown(e) {
      if (e && e.cancelable && e.type.indexOf('touch') === 0) e.preventDefault();  // 阻止触摸滚动 + 合成鼠标事件
      begin();
    }
    function onUp() { end(); }

    // 按下开始：禁用 click，改用 mousedown / touchstart（按住说话）
    mic.addEventListener('mousedown', onDown);
    mic.addEventListener('touchstart', onDown, { passive: false });
    // 松开停止：绑定到 window，确保按钮外松手也能停止录音
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    // 边界：按下后光标划出按钮区域 → 立刻停止，防止按钮一直处于「开启」状态
    mic.addEventListener('mouseleave', onUp);

    hint('tapToLoad', false);
  }

  return {
    init: init,
    start: begin,
    stop: end,
    isSupported: supported
  };
})();
