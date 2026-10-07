'use strict';

/**
 * Nudge v1.5 — Phase 7 Decision Console（前端）
 * REFERENCE §13 / §14 / §29 / §30
 *
 * 硬约束：
 *  - 只读决策：所有渲染数据来自 /api/decisions/:id（该接口只读 decision_events）。
 *  - 不拼装假 Trace：前端只把 API 返回的 stages / trace 渲染成卡片，
 *    绝不做 if(scenario===...) { card.innerText = ... }。
 *  - 不展示 Chain-of-Thought：只显示结构化字段（trigger/state/context/intent/planner/policy/action
 *    + decision/why/confidence/context_used/context_not_loaded/policy_scope）。
 *  - Pulse 与 Console 同一数据源：SSE 流与详情接口都读取同一 decision_events 行。
 *  - 无 Math.random 决定逻辑（动画仅用固定 setTimeout 节奏）。
 */

// ---------------------------------------------------------------------------
// i18n（Phase 10）：统一使用全局 NudgeI18n（Canonical 字典来自服务端 fixture，
// 经 /api/i18n/dict 下发）。本地不再维护第二套字典。
// ---------------------------------------------------------------------------
// Phase 12 修复：不得命名为全局 function t —— 会覆盖 i18n.js 的 window.t 快捷方式，
// 且函数体再调 window.t(key) 即自我递归（栈溢出，Console init 中断）。改名 tc，直连 NudgeI18n。
function tc(key) {
  if (window.NudgeI18n) return window.NudgeI18n.t(key);
  return key;
}

// Canonical Decision Pulse stages（与后端 STAGES 顺序一致，REFERENCE §29）
var STAGES = ['TRIGGER', 'STATE', 'CONTEXT', 'INTENT', 'PLANNER', 'POLICY', 'ACTION'];

var SCENARIOS = [];
var selectedId = null;

// 任务三：XAI 数据缓存（按 decision_id，避免历史回放串用上一次运行的 Plan Diff/Discovery）
// 仅存放真实运行结果（基线计划 / 终态计划 / Discovery），绝不拼接任何伪造决策。
var xaiCache = {};
var autoDemoTimer = null;

// ---------------------------------------------------------------------------
// DOM 小工具（用 textContent，避免注入；不拼接任何决策逻辑）
// ---------------------------------------------------------------------------
function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
  }
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// 把对象渲染为一行行 key/value（一层；嵌套对象再展开一层）；key/value 走 dataDict 翻译
function kvRows(obj) {
  var frag = document.createDocumentFragment();
  if (!obj || typeof obj !== 'object') {
    frag.appendChild(el('div', { class: 'kv', text: String(obj) }));
    return frag;
  }
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v == null) return;
    var valStr;
    if (Array.isArray(v)) valStr = v.map(function (x) { return window.NudgeI18n.data(x, x); }).join(', ');
    else if (typeof v === 'object') {
      valStr = Object.keys(v).map(function (kk) { return window.NudgeI18n.data(kk, kk) + ': ' + window.NudgeI18n.data(JSONstringify(v[kk]), JSONstringify(v[kk])); }).join('; ');
    } else {
      valStr = window.NudgeI18n.data(String(v), String(v));
    }
    frag.appendChild(el('div', { class: 'kv' }, [
      el('span', { class: 'k', text: window.NudgeI18n.data('key.' + k, k) }),
      el('span', { class: 'v', text: valStr })
    ]));
  });
  return frag;
}

function JSONstringify(v) {
  if (v == null) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
  return String(v);
}

// V19：决策时间本地化 + 相对时间。created_at 为 UTC（ISO 带 Z），
// 先转本地时区；1 分钟内显示“刚刚”，1h 内“N 分钟前”，当天“N 小时前”，
// 更早则简化为本地 MM-DD HH:mm（getHours 等取本地时区，自然修正时区错乱）。
function fmtDecisionTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  var zh = window.NudgeI18n && window.NudgeI18n.getLocale() !== 'en-US';
  var diff = (Date.now() - d.getTime()) / 1000;
  if (diff >= 0 && diff < 60) return zh ? '刚刚' : 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + (zh ? ' 分钟前' : 'm ago');
  if (diff < 86400) return Math.floor(diff / 3600) + (zh ? ' 小时前' : 'h ago');
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function chips(list, used) {
  var frag = document.createDocumentFragment();
  (list || []).forEach(function (item) {
    frag.appendChild(el('span', { class: 'chip ' + (used ? 'used' : 'blocked'), text: window.NudgeI18n.data(item, item) }));
  });
  return frag;
}

// ---------------------------------------------------------------------------
// Pulse
// ---------------------------------------------------------------------------
function buildPulse() {
  var wrap = document.getElementById('pulsePills');
  clear(wrap);
  STAGES.forEach(function (s) {
    wrap.appendChild(el('span', { class: 'pulse__pill', 'data-stage': s, text: window.NudgeI18n.data(s, s) }));
  });
}

function resetPulse() {
  var pulse = document.getElementById('pulse');
  pulse.classList.remove('done');
  var pills = document.querySelectorAll('#pulsePills .pulse__pill');
  pills.forEach(function (p) { p.classList.remove('lit'); p.classList.remove('skipped'); });
}

function lightPill(stage, summary, status) {
  var pill = document.querySelector('#pulsePills .pulse__pill[data-stage="' + stage + '"]');
  if (!pill) return;
  pill.classList.add('lit');
  if (status === 'skipped') pill.classList.add('skipped');
  if (summary) pill.setAttribute('title', summary);
}

function markAllLit(stages) {
  resetPulse();
  stages.forEach(function (s) { lightPill(s.stage, s.summary, s.status); });
  document.getElementById('pulse').classList.add('done');
}

function animatePills(stages) {
  resetPulse();
  stages.forEach(function (s, i) {
    setTimeout(function () { lightPill(s.stage, s.summary, s.status); }, i * 170);
  });
  setTimeout(function () { document.getElementById('pulse').classList.add('done'); }, stages.length * 170 + 200);
}

// ---------------------------------------------------------------------------
// 渲染 Console（仅消费 API 返回的 stages / trace；不拼装假 Trace）
// ---------------------------------------------------------------------------
function renderConsole(view) {
  var body = document.getElementById('consoleBody');
  clear(body);

  // 结构化 Decision Trace 摘要（§14 允许显示字段）
  var tr = view.trace || {};
  var summary = el('div', { class: 'trace-summary' }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: tc('trace.decision') }),
      el('span', { class: 'v' }, [el('b', { text: (tr.decision || view.action) ? window.NudgeI18n.dataText(tr.decision || view.action) : '—' })])
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: tc('trace.confidence') }),
      el('span', { class: 'v', text: tr.confidence != null ? String(tr.confidence) : '—' })
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: tc('trace.policyScope') }),
      el('span', { class: 'v', text: tr.policy_scope ? window.NudgeI18n.data(tr.policy_scope, tr.policy_scope) : '—' })
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: tc('trace.why') }),
      el('span', { class: 'v', text: renderWhy(tr.why) })
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: tc('trace.contextUsed') }),
      el('span', { class: 'v' }, chips(tr.context_used, true))
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: tc('trace.contextNotLoaded') }),
      el('span', { class: 'v' }, chips(tr.context_not_loaded, false))
    ])
  ]);
  body.appendChild(summary);

  // 7 阶段 trace 卡片（数据来自 view.stages / decision_events）
  (view.stages || []).forEach(function (stage) {
    body.appendChild(renderStageCard(stage));
  });

  // 任务三：可解释性（XAI）升级块 —— 全部来自真实 API 数据（policy / context / plan diff / discovery）
  body.appendChild(renderXAI(view));

  document.getElementById('consoleEmpty').style.display = 'none';
}

function renderWhy(why) {
  if (!why) return '—';
  if (typeof why === 'string') return window.NudgeI18n.dataText(why);
  if (why.note) return window.NudgeI18n.dataText(why.note);
  // reasons 对象（C0..C3 结构化路由理由，非 CoT）
  var parts = [];
  ['C0', 'C1', 'C2', 'C3'].forEach(function (layer) {
    if (why[layer]) parts.push(layer + ' — ' + window.NudgeI18n.dataText(why[layer]));
  });
  return parts.length ? parts.join('  ·  ') : '—';
}

function renderStageCard(stage) {
  var detailNode;
  if (stage.stage === 'STATE') {
    detailNode = el('div', { class: 'stage-card__detail' });
    if (stage.detail && stage.detail.fields) {
      Object.keys(stage.detail.fields).forEach(function (metric) {
        var m = stage.detail.fields[metric];
        if (!m || typeof m !== 'object') return;
        var desc = (m.value != null ? m.value : '') + (m.unit_or_scale ? ' ' + m.unit_or_scale : '');
        if (m.trend) desc += ' (' + window.NudgeI18n.data(m.trend, m.trend) + ')';
        detailNode.appendChild(el('div', { class: 'kv' }, [
          el('span', { class: 'k', text: window.NudgeI18n.data(metric, metric) }),
          el('span', { class: 'v', text: desc })
        ]));
      });
    } else {
      detailNode.appendChild(el('div', { class: 'kv', text: stage.detail && stage.detail.note ? stage.detail.note : 'state not embedded' }));
    }
  } else if (stage.stage === 'CONTEXT') {
    detailNode = el('div', { class: 'stage-card__detail' });
    detailNode.appendChild(el('div', { class: 'kv' }, [
      el('span', { class: 'k', text: window.NudgeI18n.data('key.used', 'used') }),
      el('span', { class: 'v' }, chips(stage.detail.used, true))
    ]));
    detailNode.appendChild(el('div', { class: 'kv' }, [
      el('span', { class: 'k', text: window.NudgeI18n.data('key.not_loaded', 'not_loaded') }),
      el('span', { class: 'v' }, chips(stage.detail.not_loaded, false))
    ]));
    detailNode.appendChild(el('div', { class: 'kv' }, [
      el('span', { class: 'k', text: window.NudgeI18n.data('key.reasons', 'reasons') }),
      el('span', { class: 'v', text: renderWhy(stage.detail.reasons) })
    ]));
  } else {
    detailNode = el('div', { class: 'stage-card__detail' }, kvRows(stage.detail));
  }

  return el('div', { class: 'stage-card' }, [
    el('div', { class: 'stage-card__head' }, [
      el('span', { class: 'stage-card__name', text: window.NudgeI18n.data(stage.stage, stage.stage) }),
      el('span', { class: 'stage-card__status', text: window.NudgeI18n.data(stage.status, stage.status) })
    ]),
    el('div', { class: 'stage-card__summary', text: window.NudgeI18n.dataText(stage.summary) }),
    detailNode
  ]);
}

// ---------------------------------------------------------------------------
// 任务三：可解释性（XAI）渲染 —— 全部来自真实 API 数据，前端不伪造任何决策
// ---------------------------------------------------------------------------
function renderXAI(view) {
  var frag = document.createDocumentFragment();
  var raw = view.decision_object || null;
  if (!raw) return frag;
  var pol = raw.policy || {};
  var planner = raw.planner || {};
  var ctx = raw.context || {};

  // —— 1) 策略护栏（Policy guard）：长期写入阻断 + 自主级别 ——
  var guard = el('div', { class: 'xai-guard' });
  if (pol.long_term_write === 'blocked') {
    guard.appendChild(el('span', { class: 'xai-badge xai-badge--shield', text: '🛡️ ' + tc('xai.longTermProtected') }));
  }
  if (String(pol.autonomy_level).toUpperCase() === 'L4') {
    guard.appendChild(el('span', { class: 'xai-badge xai-badge--auth', text: tc('xai.autonomyGranted') }));
  }
  if (guard.childNodes.length) {
    frag.appendChild(el('div', { class: 'xai-sec' }, [
      el('div', { class: 'xai-sec__title', text: tc('xai.policyGuard') }),
      guard
    ]));
  }

  // —— 2) 上下文路由（Context routing）：C0/C1/C2 用真实 used 推导绿/灰点 ——
  var used = ctx.used || [];
  var layers = [
    { label: tc('c0.label'), on: used.indexOf('state_summary') !== -1 },
    { label: tc('c1.label'), on: used.indexOf('memory') !== -1 || used.indexOf('recent_training') !== -1 },
    { label: tc('c2.label'), on: used.indexOf('venue') !== -1 || used.indexOf('weather') !== -1 || used.indexOf('calendar') !== -1 || used.indexOf('maps') !== -1 || used.indexOf('location') !== -1 }
  ];
  var routing = el('div', { class: 'xai-routing' });
  layers.forEach(function (L) {
    routing.appendChild(el('span', { class: 'xai-dot ' + (L.on ? 'on' : 'off') }, [
      el('span', { class: 'xai-dot__dot' }),
      el('span', { class: 'xai-dot__txt', text: L.label + ' ' + (L.on ? '✅' : '⏭️') })
    ]));
  });
  frag.appendChild(el('div', { class: 'xai-sec' }, [
    el('div', { class: 'xai-sec__title', text: tc('xai.contextRouting') }),
    routing
  ]));

  // —— 3) 计划对比（Plan diff）：真实「运行前基线」vs「运行后终态」 ——
  // 仅当动作改变了计划（REPLAN/SUBSTITUTE/SILENT_REPLAN）才展示对比；
  // NO_OP / ASK 等未改计划时隐藏，避免「无变化却显示前后差异」的误导。
  var actionType = (raw.action && raw.action.type) || '';
  var planChanged = actionType !== 'NO_OP' && actionType !== 'ASK';
  var xc = xaiCache[view.decision_id] || null;
  if (planChanged && xc && xc.baseline && xc.final) {
    var bDose = xc.baseline.dose || {};
    var fDose = xc.final.dose || {};
    var bDur = bDose.duration_min != null ? bDose.duration_min : '—';
    var fDur = fDose.duration_min != null ? fDose.duration_min : '—';
    var fid = planner.fidelity != null ? planner.fidelity : '—';
    var bEx = window.NudgeI18n.data(xc.baseline.exercise || '', xc.baseline.exercise || '');
    var fEx = window.NudgeI18n.data(xc.final.exercise || '', xc.final.exercise || '');
    var diff = el('div', { class: 'xai-diff' }, [
      el('div', { class: 'xai-diff__row' }, [
        el('span', { class: 'xai-diff__k', text: tc('xai.before') }),
        el('span', { class: 'xai-diff__v', text: bDur + ' min · ' + (bEx || '—') })
      ]),
      el('div', { class: 'xai-diff__arrow', text: '→' }),
      el('div', { class: 'xai-diff__row' }, [
        el('span', { class: 'xai-diff__k', text: tc('xai.after') }),
        el('span', { class: 'xai-diff__v', text: fDur + ' min · ' + (fEx || '—') })
      ]),
      el('div', { class: 'xai-diff__fid', text: tc('xai.fidelity') + ': ' + fid })
    ]);
    frag.appendChild(el('div', { class: 'xai-sec' }, [
      el('div', { class: 'xai-sec__title', text: tc('xai.planDiff') }),
      diff
    ]));
  }

  // —— 4) 发现数据（Discovery）：仅触发 discovery 的场景（如 find_venue）——
  if (xc && xc.discovery && ((xc.discovery.places && xc.discovery.places.length) || (xc.discovery.events && xc.discovery.events.length))) {
    var disc = el('div', { class: 'xai-disc' });
    (xc.discovery.places || []).slice(0, 2).forEach(function (p) {
      var name = p.name || tc('key.venue');
      disc.appendChild(el('div', { class: 'xai-disc__item', text: p.distance_km != null ? (name + ' · ' + p.distance_km + 'km') : name }));
    });
    (xc.discovery.events || []).slice(0, 2).forEach(function (e) {
      var en = e.name || tc('scenario');
      disc.appendChild(el('div', { class: 'xai-disc__item', text: e.start_time ? (en + ' · ' + e.start_time) : en }));
    });
    frag.appendChild(el('div', { class: 'xai-sec' }, [
      el('div', { class: 'xai-sec__title', text: tc('xai.discovery') }),
      disc
    ]));
  }

  return frag;
}

// ---------------------------------------------------------------------------
// 数据读取（全部来自 decision_events 经 API）
// ---------------------------------------------------------------------------
function api(path, opts) {
  return fetch(path, opts).then(function (r) { return r.json(); });
}

function loadDecision(id, animate) {
  api('/api/decisions/' + encodeURIComponent(id))
    .then(function (view) {
      selectedId = id;
      renderConsole(view);
      if (animate) animatePills(view.stages);
      else markAllLit(view.stages);
      markHistoryActive(id);
    })
    .catch(function () { /* 静默失败：数据缺失不阻断 UI */ });
}

// 通过 SSE 驱动 Pulse（与 Console 同一 decision_events 数据源）；失败则回退到 GET 动画
function pulseFromStream(id) {
  return new Promise(function (resolve) {
    var es;
    try { es = new EventSource('/api/decisions/' + encodeURIComponent(id) + '/stream'); }
    catch (e) { return resolve(false); }

    var done = false;
    var finish = function () { if (done) return; done = true; try { es.close(); } catch (e) {} resolve(true); };
    var timeout = setTimeout(finish, 3000);

    es.addEventListener('trace_stage', function (e) {
      try {
        var s = JSON.parse(e.data);
        lightPill(s.stage, s.summary, s.status);
      } catch (err) {}
    });
    es.addEventListener('decision_complete', function () {
      clearTimeout(timeout);
      document.getElementById('pulse').classList.add('done');
      finish();
    });
    es.onerror = function () { clearTimeout(timeout); finish(); };
  });
}

function runScenario(id) {
  resetPulse();
  document.getElementById('pulse').classList.remove('done');
  setRunnerActive(id);

  // 捕获真实基线（用户当前计划 = 运行前状态），用于 Plan Diff（不伪造，直接读全局缓存）
  var cache = window.NudgeApp && window.NudgeApp.cache;
  var baseline = (cache && cache.plan) ? JSON.parse(JSON.stringify(cache.plan)) : null;

  // 任务二：所有场景统一走 /api/scenarios/run（同一 Agent Runtime，后端真实决策，前端不伪造）
  api('/api/scenarios/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario_id: id })
  })
    .then(function (data) {
      var dec = data.decision || {};
      var decisionId = data.decision_id || dec.decision_id;
      // 缓存本次运行的 XAI 真实数据（基线/终态/Discovery），按 decision_id 隔离
      xaiCache[decisionId] = { baseline: baseline, final: data.plan || null, discovery: data.discovery || null };
      selectedId = decisionId;
      return pulseFromStream(decisionId).then(function () {
        loadDecision(decisionId, false); // 渲染卡片；pills 已由上流动画点亮
      });
    })
    .then(refreshHistory)
    .catch(function () { /* 静默 */ });
}

// ---------------------------------------------------------------------------
// Runner / History 渲染
// ---------------------------------------------------------------------------
function renderRunner() {
  var runner = document.getElementById('runner');
  clear(runner);
  SCENARIOS.forEach(function (sc) {
    var label = sc.label || sc.input;
    var btn = el('button', { class: 'runner__btn', 'data-id': sc.id, text: window.NudgeI18n.data(label, label) });
    btn.addEventListener('click', function () { runScenario(sc.id); });
    runner.appendChild(btn);
  });
}

function setRunnerActive(id) {
  document.querySelectorAll('#runner .runner__btn').forEach(function (b) {
    b.classList.toggle('runner__btn--active', b.getAttribute('data-id') === id);
  });
}

function refreshHistory() {
  api('/api/decisions').then(function (list) {
    var box = document.getElementById('historyList');
    clear(box);
    var items = list.decisions || [];
    if (!items.length) {
      box.appendChild(el('div', { class: 'empty', text: tc('history.empty') }));
      return;
    }
    // V19：同一场景（连续点击）去重，仅保留最新一条，避免历史刷屏
    var byScenario = {};
    items.forEach(function (it) {
      var prev = byScenario[it.scenario_id];
      if (!prev || (it.created_at || '') > (prev.created_at || '')) byScenario[it.scenario_id] = it;
    });
    items = Object.keys(byScenario).map(function (k) { return byScenario[k]; });
    items.sort(function (a, b) { return (b.created_at || '') < (a.created_at || '') ? -1 : 1; }); // 最新在上
    items.forEach(function (it) {
      var node = el('div', { class: 'history__item', 'data-id': it.decision_id }, [
        el('span', { class: 'id', text: window.NudgeI18n.data(it.scenario_id, it.scenario_id) || it.decision_id }),
        el('span', { class: 'meta', text: (it.action ? window.NudgeI18n.data(it.action, it.action) : '') + ' · ' + fmtDecisionTime(it.created_at) })
      ]);
      node.addEventListener('click', function () { loadDecision(it.decision_id, true); });
      box.appendChild(node);
    });
    markHistoryActive(selectedId);
  });
}

function markHistoryActive(id) {
  document.querySelectorAll('#historyList .history__item').forEach(function (n) {
    n.classList.toggle('active', n.getAttribute('data-id') === id);
  });
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------
function applyLocale() {
  document.getElementById('consoleTitle').textContent = tc('console.title');
  document.getElementById('consoleHint').textContent = tc('console.hint');
  document.getElementById('pulseDone').textContent = tc('pulse.done');
  document.getElementById('historyTitle').textContent = tc('history.title');
  document.getElementById('consoleEmpty').textContent = tc('console.empty');
}

// ---------------------------------------------------------------------------
// 任务三：自动演示（每 2.5s 依次点击场景按钮，展示完整决策链）
// ---------------------------------------------------------------------------
function startAutoDemo() {
  if (autoDemoTimer) { stopAutoDemo(); return; }
  var btn = document.getElementById('consoleDemo');
  if (btn) { btn.classList.add('console__demo--on'); btn.textContent = '⏸ 停止演示'; }
  if (!SCENARIOS.length) return;
  var i = 0;
  runScenario(SCENARIOS[i].id);
  autoDemoTimer = setInterval(function () {
    i = (i + 1) % SCENARIOS.length;
    runScenario(SCENARIOS[i].id);
  }, 2500);
}

function stopAutoDemo() {
  if (autoDemoTimer) { clearInterval(autoDemoTimer); autoDemoTimer = null; }
  var btn = document.getElementById('consoleDemo');
  if (btn) { btn.classList.remove('console__demo--on'); btn.textContent = '▶ 自动演示'; }
}

function init() {
  buildPulse();
  applyLocale();

  // Phase 10：locale 变化 → 仅重渲染文案与卡片；
  // selectedId / Scenario 列表 / decision_events 数据全部保留（不重置决策）。
  if (window.NudgeI18n) {
    window.NudgeI18n.onChange(function () {
      applyLocale();
      renderRunner();
      refreshHistory();
      if (selectedId) loadDecision(selectedId, false);
    });
  }

  api('/api/scenarios').then(function (s) {
    SCENARIOS = (s && s.scenarios) || [];
    renderRunner();
  }).catch(function () { SCENARIOS = []; });

  // 任务三：自动演示按钮（面板右上角，不改动面板尺寸）
  var demoBtn = document.getElementById('consoleDemo');
  if (demoBtn) demoBtn.addEventListener('click', function () { startAutoDemo(); });

  refreshHistory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
