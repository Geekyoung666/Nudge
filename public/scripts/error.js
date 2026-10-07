'use strict';

/**
 * Nudge v1.5 — Phase 11 前端 Error / Fallback 层（§ 要求 8 / 9）
 *
 * NudgeErr：
 *  - safeFetch(path, opts)：超时控制（AbortController）+ 统一 error shape 归一化；
 *    永不 reject（返回 { ok:true, data } 或 { ok:false, error:{code,message_key,retryable,status} }），
 *    调用方不再因网络异常产生 unhandled rejection（不白屏的关键）。
 *  - toast / showLoading / showError（↻ retry）/ showEmpty：Loading / Error / Empty 三态。
 *  - 全局守卫：window error / unhandledrejection → toast 反馈，绝不静默崩溃到白屏。
 *
 * 样式：app.css 不在 Phase 11 允许修改清单 → 本模块一次性注入内联 <style>。
 * 文案：统一走 NudgeI18n t() + Canonical errors.* key；按钮用符号（↻），不引入第二套字典。
 */

(function () {
  var QUIET = false;      // 测试可静音全局守卫 toast
  var MAX_TOASTS = 3;

  var CSS = [
    '.nudge-toast-wrap{position:fixed;top:14px;right:14px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;}',
    '.nudge-toast{background:rgba(20,22,28,.92);color:#f4f5f7;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.4;box-shadow:0 6px 18px rgba(0,0,0,.35);max-width:320px;animation:nudgeToastIn .18s ease-out;}',
    '@keyframes nudgeToastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
    '.nudge-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:28px 16px;text-align:center;color:rgba(244,245,247,.82);min-height:120px;}',
    '.nudge-state__spin{width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(244,245,247,.25);border-top-color:rgba(244,245,247,.85);animation:nudgeSpin .8s linear infinite;}',
    '@keyframes nudgeSpin{to{transform:rotate(360deg)}}',
    '.nudge-state__card{background:rgba(20,22,28,.72);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:18px 22px;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:360px;}',
    '.nudge-state__icon{font-size:22px;line-height:1;}',
    '.nudge-state__code{font-size:11px;opacity:.55;font-family:ui-monospace,monospace;}',
    '.nudge-state__retry{border:1px solid rgba(255,255,255,.3);background:transparent;color:#f4f5f7;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;transition:background .15s;}',
    '.nudge-state__retry:hover{background:rgba(255,255,255,.12);}',
    '.nudge-state__empty{font-size:26px;opacity:.5;}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('nudge-err-css')) return;
    var st = document.createElement('style');
    st.id = 'nudge-err-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function t(key, fallback) {
    var w = window.NudgeI18n;
    if (w && typeof w.t === 'function') {
      var v = w.t(key);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }

  // 统一 error shape（无 stack、无内部细节）；detail 透传真实错误描述（供 errorToText 展示具体原因）
  function normalize(code, messageKey, retryable, status, detail) {
    return {
      code: code || 'UNKNOWN_ERROR',
      message_key: messageKey || 'errors.internal',
      retryable: retryable !== false,
      status: status || 0,
      detail: detail != null ? detail : null
    };
  }

  /**
   * safeFetch：超时 + 归一化。resolve { ok:true, status, data } 或 { ok:false, status, error }。
   * 后端约定 HTTP 200 + body.error（如 LLM_BUDGET_EXCEEDED）也归一为 ok:false。
   */
  function safeFetch(path, opts) {
    opts = opts || {};
    var timeoutMs = Number(opts.timeoutMs) || 12000;
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    var fetchOpts = opts;
    if (ctrl) {
      fetchOpts = Object.assign({}, opts, { signal: ctrl.signal });
      delete fetchOpts.timeoutMs;
    }
    return fetch(path, fetchOpts)
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (r.ok && !(body && body.error)) {
            return { ok: true, status: r.status, data: body };
          }
          var e = (body && body.error) || null;
          return {
            ok: false,
            status: r.status,
            error: normalize(e && e.code, e && e.message_key, e && e.retryable, r.status, e && e.detail)
          };
        });
      })
      .catch(function (err) {
        var timedOut = !!(ctrl && err && err.name === 'AbortError');
        return {
          ok: false,
          status: 0,
          error: normalize(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', 'errors.internal', true, 0)
        };
      })
      .then(function (res) { if (timer) clearTimeout(timer); return res; });
  }

  // —— toast ——
  function wrapEl() {
    var w = document.getElementById('nudgeToastWrap');
    if (!w) {
      w = document.createElement('div');
      w.id = 'nudgeToastWrap';
      w.className = 'nudge-toast-wrap';
      document.body.appendChild(w);
    }
    return w;
  }

  function toast(msg) {
    if (QUIET) return;
    injectCss();
    var w = wrapEl();
    while (w.children.length >= MAX_TOASTS) w.removeChild(w.firstChild);
    var el = document.createElement('div');
    el.className = 'nudge-toast';
    el.setAttribute('role', 'status');
    el.textContent = String(msg || '').slice(0, 160);
    w.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2800);
  }

  // —— 三态容器 ——
  function showLoading(container, label) {
    if (!container) return;
    injectCss();
    container.innerHTML =
      '<div class="nudge-state" data-nudge-state="loading">' +
      '<div class="nudge-state__spin"></div>' +
      '<div class="nudge-state__label"></div></div>';
    var lab = container.querySelector('.nudge-state__label');
    if (lab) lab.textContent = label || '…';
  }

  function showError(container, err, opts) {
    opts = opts || {};
    if (!container) return;
    injectCss();
    var e = (err && err.code) ? err : normalize(null, null, true, 0);
    container.innerHTML =
      '<div class="nudge-state" data-nudge-state="error">' +
      '<div class="nudge-state__card">' +
      '<div class="nudge-state__icon">⚠</div>' +
      '<div class="nudge-state__label"></div>' +
      '<div class="nudge-state__code"></div>' +
      '<button type="button" class="nudge-state__retry" data-nudge-retry="1" title="retry">↻</button>' +
      '</div></div>';
    var lab = container.querySelector('.nudge-state__label');
    if (lab) lab.textContent = t(e.message_key, '服务异常');
    var code = container.querySelector('.nudge-state__code');
    if (code) code.textContent = e.code;
    var btn = container.querySelector('[data-nudge-retry]');
    if (btn && typeof opts.onRetry === 'function') {
      btn.addEventListener('click', function () { opts.onRetry(); });
    } else if (btn) {
      btn.style.display = 'none';
    }
  }

  function showEmpty(container, label) {
    if (!container) return;
    injectCss();
    container.innerHTML =
      '<div class="nudge-state" data-nudge-state="empty">' +
      '<div class="nudge-state__empty">—</div>' +
      '<div class="nudge-state__label"></div></div>';
    var lab = container.querySelector('.nudge-state__label');
    if (lab) lab.textContent = label || '';
  }

  // —— 全局守卫：不白屏，给用户反馈而非静默失败 ——
  function installGuards() {
    window.addEventListener('error', function () {
      try { toast(t('errors.internal', '服务异常')); } catch (e) { /* 守卫自身绝不抛 */ }
    });
    window.addEventListener('unhandledrejection', function (ev) {
      try {
        toast(t('errors.internal', '服务异常'));
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      } catch (e) { /* 守卫自身绝不抛 */ }
    });
  }

  function setQuiet(v) { QUIET = !!v; }

  injectCss();
  installGuards();

  window.NudgeErr = {
    safeFetch: safeFetch,
    toast: toast,
    showLoading: showLoading,
    showError: showError,
    showEmpty: showEmpty,
    setQuiet: setQuiet,
    normalize: normalize
  };
})();
