'use strict';

/**
 * Nudge v1.5 — Phase 9 Text 层（前端）
 * REFERENCE §33（Voice / Text）
 *
 * 职责（仅 Presentation + IO，不实现业务决策）：
 *  - speak(text)：浏览器 SpeechSynthesis TTS；不可用时静默降级，文字回复仍可用。
 *  - fillAndSend(text)：把识别到的文本填入对话输入框并触发发送，
 *    复用 shell 中已有的对话管线（home.js 绑定 #convSend → POST /api/interactions）。
 *    这样「语音只负责 speech→text」，业务决策仍由 Runtime 完成（§ 要求 4）。
 *  - isTTSAvailable()：能力探测。
 *
 * 约束：无 Math.random 决策逻辑；无 S1/S2/S3/Fidelity/Policy；不展示 CoT。
 */

window.NudgeText = (function () {
  function isTTSAvailable() {
    return ('speechSynthesis' in window);
  }

  // TTS：朗读文本。任何异常都吞掉，绝不阻断 UI（文字回复照常显示）。
  function speak(text) {
    if (!text) return;
    try {
      if (!isTTSAvailable()) return;            // 不可用 → 静默降级
      var u = new SpeechSynthesisUtterance(text);
      u.lang = (window.NudgeApp && window.NudgeApp.locale === 'en-US') ? 'en-US' : 'zh-CN';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* TTS adapter 不可用：仅文字回复，不报错 */ }
  }

  // 把文本塞进对话输入框并复用既有发送按钮（单一 Runtime 调用路径，不新建决策）。
  function fillAndSend(text) {
    var input = document.getElementById('convInput');
    var send = document.getElementById('convSend');
    if (!input || !send || !text) return;
    input.value = text;
    // 触发 home.js 已绑定的 click 处理器（POST /api/interactions + TTS + presence）
    send.click();
  }

  function init() { /* 文本层为纯函数集合；UI 绑定在 voice.js / home.js */ }

  return { init: init, speak: speak, fillAndSend: fillAndSend, isTTSAvailable: isTTSAvailable };
})();
