'use strict';

/**
 * Nudge v1.5 — Phase 8 App Shell（前端）
 * REFERENCE §23 / §24 / §25 / §26 / §33
 *
 * 硬约束：
 *  - Agent Presence 是 Presentation State，不是 Agent Decision Object（§26/§33）。
 *  - Presence 实例在 App Shell 创建一次；路由切换复用同一实例，绝不每个 route 新建 Agent（§26）。
 *  - 路由切换只替换 #routeContent 的内容；数字人（digitalFrame）与 presence 不被销毁（§26 生命周期）。
 *  - 前端只调 API 与展示 canonical data；不实现业务决策（S1/S2/S3、Fidelity、Memory 写入、Policy…）。
 *  - 无 Math.random 决策逻辑；无 Chain-of-Thought。
 */

// ---------------------------------------------------------------------------
// 全局 App 命名空间（被 home.js / console.js 消费）
// ---------------------------------------------------------------------------
var PRESENCE_STATES = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'DECISION_UPDATED', 'AMBIENT'];

// Agent Presence 实例：模块加载即创建一次（instanceId 固定，非随机决策）。
var NudgeApp = {
  presence: {
    instanceId: 'pres_001',          // 单个稳定实例，路由切换不复用新 id
    agent_id: 'nudge_001',
    state: 'IDLE',
    createdAt: new Date().toISOString()
  },
  cache: null,                        // /api/bootstrap 的 canonical 数据
  locale: 'zh-CN',
  routes: {},                        // home.js 注册 { home, memory, settings }
  humanEl: null,
  _ambientTimer: null,

  api: function (path, opts) {
    return fetch(path, opts).then(function (r) { return r.json(); });
  },

  // Phase 11：bootstrap 是否失败（失败期间路由渲染保持 error 卡，不白屏）
  _bootFailed: false,

  // 仅改样式与 label；不携带任何业务决策（与 Decision Object 解耦，§26/§33）
  setPresence: function (state) {
    if (PRESENCE_STATES.indexOf(state) === -1) return;
    NudgeApp.presence.state = state;
    var p = document.getElementById('presence');
    if (p) { p.setAttribute('data-state', state); }
    var label = document.getElementById('presenceLabel');
    if (label) { label.textContent = state; }

    // 空闲一段时间后进入 AMBIENT（演示用 Presentation 节奏；非 Runtime 决策）
    if (NudgeApp._ambientTimer) clearTimeout(NudgeApp._ambientTimer);
    if (state !== 'AMBIENT') {
      NudgeApp._ambientTimer = setTimeout(function () {
        if (NudgeApp.presence.state === state) NudgeApp.setPresence('AMBIENT');
      }, 12000);
    }
  }
};

window.NudgeApp = NudgeApp;

// 沉浸模式退出时重置左上角问候语（按系统时间的初始问候；随 i18n 语言自适应）。
// home.js 的沉浸式聊天退出逻辑调用此入口完成「主页状态完美重置」的第三步。
NudgeApp.resetGreeting = function () { if (typeof applyUiLabels === 'function') applyUiLabels(); };

// ---------------------------------------------------------------------------
// Phase 11：错误 / 重试基建
// error.js 不在 index.html 脚本清单内（Phase 11 允许文件不含 index.html），
// 由 app.js 动态加载；加载失败时保留原 fetch 降级路径，绝不阻断启动。
// ---------------------------------------------------------------------------
function loadErrorModule() {
  return new Promise(function (resolve) {
    if (window.NudgeErr) return resolve(true);
    var s = document.createElement('script');
    s.src = '/scripts/error.js';
    s.onload = function () { resolve(!!window.NudgeErr); };
    s.onerror = function () { resolve(false); };
    document.head.appendChild(s);
  });
}

// NudgeApp.api 升级：safeFetch（超时 + error shape 归一化 + toast）。
// 失败时 resolve 后端同形 error shape（{error:{code,message_key,retryable}}），
// 调用方可检测 resp.error；网络层异常不再产生 unhandled rejection。
function upgradeApi() {
  if (!window.NudgeErr || !window.NudgeErr.safeFetch) return;
  NudgeApp.api = function (path, opts) {
    return window.NudgeErr.safeFetch(path, opts).then(function (res) {
      if (res.ok) return res.data;
      var label = window.t ? window.t(res.error.message_key) : res.error.code;
      window.NudgeErr.toast(label);
      return { error: res.error };
    });
  };
}

// bootstrap 拉取（可重试）：Loading → 成功渲染 / 失败 error 卡 + ↻ retry
function loadBootstrap() {
  var container = document.getElementById('routeContent');
  if (window.NudgeErr && container) window.NudgeErr.showLoading(container);

  return NudgeApp.api('/api/bootstrap')
    .then(function (boot) {
      if (boot && boot.error) {           // 后端统一 error shape（HTTP 200）
        renderBootError(boot.error);
        return;
      }
      NudgeApp._bootFailed = false;
      NudgeApp.cache = boot;
      // 初始语言由 i18n 层决定（localStorage 用户选择优先，默认英文）；
      // bootstrap 的 settings.locale 仅作服务端存储，不再覆盖前端选择。
      NudgeApp.locale = (window.NudgeI18n && window.NudgeI18n.getLocale()) || 'en-US';
      document.documentElement.lang = NudgeApp.locale;

      // 数字人资产：仅 presentation（gender 来自 bootstrap.digital_human）
      var dh = boot.digital_human || {};
      applyGender(dh.gender || 'female');

      // presence 初始态来自 bootstrap.digital_human.state（Presentation State）
      NudgeApp.setPresence(dh.state || 'IDLE');

      renderCurrentRoute();
    })
    .catch(function () {
      // 防御分支（safeFetch 本身不 reject；此处覆盖 NudgeErr 缺失的降级路径）
      renderBootError(null);
    });
}

function renderBootError(err) {
  NudgeApp._bootFailed = true;
  // 保留默认数字人与 IDLE presence（Shell 始终存活，§26）
  applyGender('female');
  var container = document.getElementById('routeContent');
  if (window.NudgeErr && container) {
    window.NudgeErr.showError(container, err, {
      onRetry: function () { loadBootstrap(); }
    });
  }
}

// ---------------------------------------------------------------------------
// 启动：拉取 canonical bootstrap，初始化数字人 / presence / 路由
// ---------------------------------------------------------------------------
function nudgeBoot() {
  NudgeApp.humanEl = document.getElementById('bgHuman') || document.getElementById('humanImg');

  // Phase 10：i18n 先行（拉取 Canonical 字典；locale 变化时重渲染当前路由）
  if (window.NudgeI18n) {
    window.NudgeI18n.init();
    window.NudgeI18n.onChange(function () { applyUiLabels(); renderCurrentRoute(); });
    applyUiLabels();
  }

  bindShell();

  // Phase 9：初始化 Text / Voice 层（纯 Presentation + IO；不实现业务决策）
  if (window.NudgeText) window.NudgeText.init();
  if (window.NudgeVoice) window.NudgeVoice.init();

  // Phase 11：错误基建就绪后再拉 bootstrap（失败可重试、不白屏）
  loadErrorModule().then(function () {
    upgradeApi();
    loadBootstrap();
  });
}

// 数字人背景切换（仅 presentation）：数字人1.jpg(男) ⇄ 数字人2.jpg(女)，全屏背景层平滑过渡
function applyGender(gender) {
  var el = document.getElementById('bgHuman');
  if (!el) el = document.getElementById('humanImg');
  if (!el) return;
  NudgeApp.humanEl = el;
  // HTML data-gender 是用户的初始选择（male=数字人1）；bootstrap 不覆盖用户已切换的值
  if (!NudgeApp._genderTouched) {
    var initial = el.getAttribute('data-gender');
    if (initial === 'male' || initial === 'female') gender = initial;
  }
  var g = (gender === 'male') ? 'male' : 'female';
  var next = '/assets/human_' + g + '_bg.jpg';
  if (el.getAttribute('src') !== next) {
    el.classList.add('is-switching');            // 淡出
    setTimeout(function () {
      el.src = next;
      el.classList.remove('is-switching');       // 淡入
    }, 180);
  }
  el.setAttribute('data-gender', g);
  var btn = document.getElementById('genderBtn');
  if (btn) btn.textContent = (g === 'male') ? '♂' : '♀';
  if (NudgeApp.cache && NudgeApp.cache.digital_human) NudgeApp.cache.digital_human.gender = g;
}

// ---------------------------------------------------------------------------
// 路由：仅替换 #routeContent；数字人 / presence 始终存活（§26）
// ---------------------------------------------------------------------------
function setRoute(name) {
  var app = document.getElementById('app');
  if (!app) return;

  // 路由卸载（DOM 泄漏修复）：进入新路由前强制收起所有 transient 浮层——
  // 决策控制台(#console) 与 API 配置弹窗(#llmConfigModal)。覆盖「导航点击」与
  // 「直接改 URL / 浏览器前进后退」两条路径，杜绝切 Tab 时旧浮层残留，确保
  // 同一时刻只渲染一个页面结构（绝不出现两个页面内容同时存在于 DOM 中可见）。
  var consoleEl = document.getElementById('console');
  if (consoleEl) { consoleEl.classList.remove('active'); consoleEl.style.display = 'none'; }
  var modalEl = document.getElementById('llmConfigModal');
  if (modalEl) { modalEl.classList.remove('is-open'); modalEl.style.display = 'none'; }

  app.className = 'route-' + name;     // 切换 class；不触碰背景数字人

  // 导航高亮
  document.querySelectorAll('#appNav [data-route]').forEach(function (b) {
    b.classList.toggle('is-active', b.getAttribute('data-route') === name);
  });

  // 路由浮层显隐（Panel Manager：.active 驱动；home 时移除）
  var rc = document.getElementById('routeContent');
  if (rc) {
    if (name === 'home') {
      rc.classList.remove('active');
    } else {
      rc.style.display = '';            // 清掉 closeAllPanels 的内联兜底
      rc.classList.add('active');
    }
  }

  renderCurrentRoute();
}

function currentRouteName() {
  var h = (location.hash || '').replace(/^#\/?/, '');
  return (NudgeApp.routes[h] ? h : 'home');
}

function renderCurrentRoute() {
  var name = currentRouteName();
  var renderer = NudgeApp.routes[name];
  var container = document.getElementById('routeContent');
  if (!container) return;

  // Phase 11：bootstrap 失败期间保持 error 卡（retry 可见），避免被空数据渲染覆盖
  if (NudgeApp._bootFailed && !NudgeApp.cache) {
    if (!(window.NudgeErr && container.querySelector('[data-nudge-state="error"]'))) {
      renderBootError(null);
    }
    return;
  }

  if (typeof renderer === 'function') {
    renderer(container, NudgeApp.cache);
  } else if (renderer && typeof renderer.render === 'function') {
    renderer.render(container, NudgeApp.cache);
  } else {
    container.innerHTML = '';
  }
}

// ---------------------------------------------------------------------------
// Shell 绑定（导航 / gender / hashchange）—— 全部不重建数字人 / presence
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 全局面板管理（Panel Manager）—— 严格互斥：任何时刻至多一个面板可见
// 面板清单（真实 ID）：#console=决策控制台；#routeContent=记忆/权限/设置共用浮层容器；
//                     #stateDrawer=状态详情抽屉；#nextDrawer=周期计划抽屉
// CSS 约定（app.css）：.panel 默认 display:none !important + opacity:0 + pointer-events:none；
//                     仅当面板同时拥有自身 id 与 .active 类时才显示。
// z-index：route 浮层 100 < Console 200 < nav 210 < dock/chip/fab 220 < Drawer 230（无全屏遮罩元素）
// ---------------------------------------------------------------------------
var PANEL_IDS = ['console', 'routeContent', 'stateDrawer', 'nextDrawer'];   // 写死的面板 ID 数组（互斥遍历用）

// closeAllPanels()：遍历面板数组 —— 移除 .active、强制 style.display='none'（同步生效，
// 不依赖异步 hashchange，杜绝新旧面板同帧叠加）。触发时机：任何面板触发按钮点击前 / Esc / 面板外点击。
function closeAllPanels() {
  PANEL_IDS.forEach(function (id) {
    var p = document.getElementById(id);
    if (!p) return;
    p.classList.remove('active');     // 移除 active（CSS 层面回到 display:none !important）
    p.style.display = 'none';         // 强制内联兜底（与 CSS !important 双保险）
  });
  // 路由状态同步归位（setRoute 会重设 route class 与高亮；hashchange 后 setRoute 再次执行无副作用）
  var app = document.getElementById('app');
  if (app && app.className !== 'route-home') {
    app.className = 'route-home';
    var h = (location.hash || '').replace(/^#\/?/, '');
    if (h && h !== 'home') location.hash = '#/home';
  }
}

// openPanel(id)：目标面板显示（调用前必须已 closeAllPanels）
function openPanel(id) {
  var p = document.getElementById(id);
  if (!p) return;
  p.style.display = '';               // 清掉内联兜底，交还 .active 类控制
  p.classList.add('active');
}

function bindShell() {
  // 导航路由：getElementById 逐个绑定（logo→主页 / 记忆 / 权限 / 设置）。
  // 互斥规则：点击任何面板触发器，第一件事 closeAllPanels()，再打开目标面板。
  var navMap = { navHome: 'home', navMemory: 'memory', navPermission: 'permission', navSettings: 'settings' };
  Object.keys(navMap).forEach(function (id) {
    var b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('click', function () {
      closeAllPanels();                       // ① 先关全部面板（同步移除 .active）
      location.hash = '#/' + navMap[id];      // ② hashchange → setRoute → routeContent 加 .active
    });
  });

  // 左下角 Decision Console 小按钮：toggle（不默认展开）
  var consoleFab = document.getElementById('consoleFab');
  if (consoleFab) {
    consoleFab.addEventListener('click', function () {
      var c = document.getElementById('console');
      if (c && c.classList.contains('active')) { closeAllPanels(); return; }   // 已开 → 关闭
      closeAllPanels();                        // 未开 → 第一件事：互斥清理
      openPanel('console');
    });
  }

  // 导航"决策"：呼出 Decision Console（与路由浮层互斥）
  var navDecision = document.getElementById('navDecision');
  if (navDecision) {
    navDecision.addEventListener('click', function () {
      var c = document.getElementById('console');
      if (c && c.classList.contains('active')) { closeAllPanels(); return; }
      closeAllPanels();
      openPanel('console');
    });
  }

  // Decision Pulse chip：呼出 Decision Console（真实 Runtime 事件在面板内，无前端假装分析）
  var pulseChip = document.getElementById('pulseChip');
  if (pulseChip) {
    pulseChip.addEventListener('click', function () {
      closeAllPanels();
      openPanel('console');
    });
  }

  // Esc：关闭所有面板
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllPanels();
  });

  // 面板外点击：关闭任何已打开的面板（Console / 路由浮层 / 抽屉）。
  // 白名单：面板自身与所有触发器（含两张卡片——卡片有自己的 toggle 逻辑）。
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#console') || t.closest('#consoleFab') || t.closest('#navDecision') ||
        t.closest('#pulseChip') || t.closest('#appNav') || t.closest('.page') || t.closest('#voiceDock') ||
        t.closest('#stateCard') || t.closest('#nextCard') ||
        t.closest('#stateDrawer') || t.closest('#nextDrawer')) return;
    for (var i = 0; i < PANEL_IDS.length; i++) {
      var p = document.getElementById(PANEL_IDS[i]);
      if (p && p.classList.contains('active')) { closeAllPanels(); return; }
    }
  });

  var genderBtn = document.getElementById('genderBtn');
  if (genderBtn) {
    genderBtn.addEventListener('click', function () {
      NudgeApp._genderTouched = true;   // 用户手动切换后，bootstrap 不再覆盖
      var el = document.getElementById('bgHuman');
      var cur = (el && el.getAttribute('data-gender')) || 'male';
      applyGender(cur === 'male' ? 'female' : 'male');
    });
  }

  // Phase 10：语言切换（zh-CN ↔ en-US）。仅切文案与 <html lang>，
  // 不刷新、不重置数据、不改 Scenario / Decision / gender / 输入内容。
  var langBtn = document.getElementById('langBtn');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      if (!window.NudgeI18n) return;
      var next = (window.NudgeI18n.getLocale() === 'zh-CN') ? 'en-US' : 'zh-CN';
      window.NudgeI18n.setLocale(next);   // persist=true → POST /api/locale 写 settings.locale
    });
  }

  window.addEventListener('hashchange', function () { setRoute(currentRouteName()); });
}

  // 问候语按系统时间分段（早上/上午/中午/下午/晚上；英文按 morning/afternoon/evening 三段）
  function timeGreeting(zh) {
    var h = new Date().getHours();
    if (zh) {
      if (h >= 5 && h < 9) return '早上好';
      if (h < 12) return '上午好';
      if (h < 14) return '中午好';
      if (h < 18) return '下午好';
      return '晚上好';
    }
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

// 前端词典驱动的 UI 标签（服务端字典没有的壳层文案；切换语言实时刷新）
function applyUiLabels() {
  if (!window.NudgeI18n) return;
  function set(id, key, fb) {
    var n = document.getElementById(id);
    if (n) n.textContent = window.NudgeI18n.data(key, fb);
  }
  var zh = window.NudgeI18n.getLocale() !== 'en-US';
  set('navDecision', 'nav.decision', '决策');
  set('navPermission', 'nav.permission', '权限');
  set('micLabel', 'mic.label', '按住说话');
  set('modeTypeText', 'chat.typeMode', '⌨ 切换打字');
  set('modeVoiceText', 'chat.voiceMode', '🎙 切换语音');
  set('stateTitle', 'home.state.title', '今天的你');
  set('nextTitle', 'home.next.title', '接下来');
  set('quoteText', 'home.quote', '真正的自律，不是强迫自己做什么，而是始终清楚自己为什么这样做。');
  set('stateDrawerTitle', 'drawer.state.title', '状态详情');
  set('nextDrawerTitle', 'drawer.next.title', '周期计划');
  var gt = document.getElementById('greetTitle');
  if (gt) gt.textContent = '☀ ' + timeGreeting(zh) + (zh ? '，Young' : ', Young');
  var gs = document.getElementById('greetSub');
  if (gs) {
    if (zh) gs.innerHTML = '昨晚睡得有点少，<br />今天先别急着跟计划硬碰硬。';
    else gs.textContent = 'You slept a bit short — take it easy on the plan today.';
  }
}

// 初次根据 hash 落路由
function bootRoute() { setRoute(currentRouteName()); }

// 始终等待 DOMContentLoaded：defer 脚本按序执行，home.js（注册路由）在本文件之后，
// 必须等所有 defer 脚本完成后（DOMContentLoaded 触发时）再 bootstrap + 首屏渲染。
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { nudgeBoot(); bootRoute(); });
} else {
  document.addEventListener('DOMContentLoaded', function () { nudgeBoot(); bootRoute(); });
}
