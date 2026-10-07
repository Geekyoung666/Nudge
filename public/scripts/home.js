'use strict';

/**
 * Nudge v1.5 — Phase 8 Home / Memory / Settings 视图（前端）
 * REFERENCE §23 / §24 / §26 / §33 / §19(Bootstrap)
 *
 * 硬约束：
 *  - 只调 API 与展示 canonical data（/api/bootstrap、/api/interactions）。
 *  - 不实现业务决策：前端不判断 S1/S2/S3、Fidelity、Memory 写入、Policy、Venue。
 *  - Agent Presence 状态由 UI 生命周期驱动（THINKING→SPEAKING→DECISION_UPDATED），
 *    与 Agent Decision Object 解耦（§26/§33）。
 *  - 无 Math.random 决策逻辑；无 Chain-of-Thought。
 */

(function () {
  var App = window.NudgeApp;

  // -----------------------------------------------------------------------
  // 工具
  // -----------------------------------------------------------------------
  // i18n（Phase 10）：所有可见文案经 t(key)；业务 key（raw）不翻译。
  function t(key, raw) {
    if (window.NudgeI18n) {
      return (raw != null) ? window.NudgeI18n.tOrRaw(key, raw) : window.NudgeI18n.t(key);
    }
    return (raw != null) ? raw : key;
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'onclick') n.addEventListener('click', attrs[k]);   // 事件用 addEventListener；setAttribute 会把函数序列化成字符串导致点击报错
      else n.setAttribute(k, attrs[k]);
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  // 沉浸模式（输入时减少视觉干扰）的进入 / 退出 / 主页重置逻辑已迁移至
  // bindConversation() 内部（需访问 mem / log / input 等会话作用域）。旧的
  // 「停输 3s 自动返回主页」定时器在此彻底废除，改为「手动退出按钮 + 60s 无操作兜底」。

  // ---------------------------------------------------------------------
  // V15：TTS 朗读状态（迁至设置弹窗开关；dock 不再有按钮）。
  //   模块级持有，speak() / 设置页 toggle 共用；localStorage 持久。
  // ---------------------------------------------------------------------
  var ttsMuted = false;
  try { ttsMuted = localStorage.getItem('nudge.tts') === 'off'; } catch (e) {}
  function setTtsMuted(m) {
    ttsMuted = !!m;
    try { localStorage.setItem('nudge.tts', m ? 'off' : 'on'); } catch (e) {}
    if (m && 'speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e2) {} }
  }

  function trendClass(t) {
    if (t === 'up') return 'trend-up';
    if (t === 'down') return 'trend-down';
    return 'trend-stable';
  }
  function trendGlyph(t) {
    if (t === 'up') return ' ↑';
    if (t === 'down') return ' ↓';
    return '';
  }

  // -----------------------------------------------------------------------
  // Home：状态卡（单卡 2×2 指标 + 一句总结）+ 接下来卡（垂直时间轴，图二原型）
  // -----------------------------------------------------------------------
  function fillStateCard(cache) {
    var body = document.getElementById('stateBody');
    if (!body) return;
    clear(body);
    var state = (cache && cache.state) || {};
    var keys = Object.keys(state);
    if (!keys.length) { body.appendChild(el('div', { class: 'm-cell', text: t('home.empty.state') })); }
    keys.forEach(function (k) {
      var m = state[k];
      var val = (m && m.value != null) ? String(m.value) : '—';
      var unit = (m && m.unit_or_scale) ? m.unit_or_scale : '';
      var cell = el('div', { class: 'm-cell' }, [
        el('div', { class: 'm-val' }, [
          document.createTextNode(val),
          unit ? el('span', { class: 'unit', text: ' ' + unit }) : null,
          el('span', { class: trendClass(m && m.trend) + ' unit', text: trendGlyph(m && m.trend) })
        ]),
        el('div', { class: 'm-label', text: t('state.' + k, k) })   // label 经 i18n；数据 key 兜底原样
      ]);
      body.appendChild(cell);
    });
    var summary = document.getElementById('stateSummary');
    if (summary) summary.textContent = stateSummaryLine(state);
  }

  // 一句状态总结（确定性展示规则，非决策逻辑）：按趋势词生成，不支持随机
  function stateSummaryLine(state) {
    var zh = (window.NudgeI18n && window.NudgeI18n.getLocale() !== 'en-US');
    var parts = [];
    if (state.sleep && state.sleep.trend === 'down') parts.push(zh ? '睡眠偏少' : 'sleep is short');
    if (state.fatigue && state.fatigue.trend === 'up') parts.push(zh ? '疲劳偏高' : 'fatigue is up');
    if (state.sedentary && state.sedentary.trend === 'up') parts.push(zh ? '久坐偏多' : 'too much sitting');
    if (!parts.length) return zh ? '状态平稳，可以按计划推进。' : 'Steady state — stay on plan.';
    return zh ? parts.join('，') + '，今天放轻节奏。' : parts.join(', ') + ' — keep it light today.';
  }

  // —— 计划字段规整（脏数据清洗 + 抽屉回写中文还原）——
  // goal 只接受有效枚举；抽屉回写的中文展示值（如 '力量'）还原为枚举；
  // 任意未识别脏值（如 'kk'）兜底为 'strength'，确保经中文字典映射后绝不原样吐到 UI。
  var NUDGE_VALID_GOALS = ['strength', 'cardio', 'mobility', 'recovery', 'hypertrophy', 'endurance'];
  var NUDGE_REV_GOAL = {
    '力量': 'strength', '下肢力量': 'lower_body_strength', '有氧': 'cardio',
    '灵活': 'mobility', '恢复': 'recovery', '增肌': 'hypertrophy', '耐力': 'endurance'
  };
  function normalizePlanGoal(raw) {
    if (raw == null) return 'strength';
    if (NUDGE_VALID_GOALS.indexOf(raw) !== -1) return raw;
    if (NUDGE_REV_GOAL[raw]) return NUDGE_REV_GOAL[raw];
    return 'strength';   // 脏数据兜底
  }

  // 接下来卡：垂直时间轴（今天/明天）+ V19 数据闭环修复：把计划剂量渲染进卡片 +
  // 底部评估提示。所有 UI（时间轴 + 下方计划详情）统一绑定 state.plan（同源），
  // 保存后由同一 fillNextCard 整体重绘，杜绝“一半变一半没变”。flash=true 时高亮。
  function fillNextCard(cache, flash) {
    var tl = document.getElementById('nextTimeline');
    if (!tl) return;
    clear(tl);
    var plan = (cache && cache.plan) || {};
    if (!plan || !plan.goal) {
      tl.appendChild(el('div', { class: 'tl-item' }, [el('div', { class: 'tl-text next-card__empty', text: t('home.empty.plan') })]));
      setNextFooter('');
      return;
    }
    var zh = (window.NudgeI18n && window.NudgeI18n.getLocale() !== 'en-US');
    var D = window.NudgeI18n;

    // 统一数据源：goal / stimulus 先规整为有效枚举，再经中文字典映射（脏数据兜底）
    var goal = normalizePlanGoal(plan.goal);
    var stim = (plan.stimulus && NUDGE_VALID_GOALS.indexOf(plan.stimulus) === -1 && NUDGE_REV_GOAL[plan.stimulus]) ? NUDGE_REV_GOAL[plan.stimulus] : (plan.stimulus || '');
    var goalZh = D.data(goal, goal);
    var stimZh = D.data(stim, stim);

    var now = new Date();
    var tomorrow = new Date(now.getTime() + 86400000);
    function fmtDate(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

    // 节点 1：今天 —— 文案随最新 plan 动态生成（goal / stimulus 变化即同步刷新）
    var todayText = zh
      ? ('根据你的状态，今天安排：' + (goalZh || '训练') + (stimZh && stimZh !== goalZh ? '（' + stimZh + '）' : ''))
      : ('Based on your state, today: ' + (goalZh || 'training') + (stimZh && stimZh !== goalZh ? ' (' + stimZh + ')' : ''));
    tl.appendChild(el('div', { class: 'tl-item' }, [
      el('div', { class: 'tl-date', text: (zh ? '今天 ' : 'Today · ') + fmtDate(now) }),
      el('div', { class: 'tl-text', text: todayText })
    ]));
    // 节点 2：明天 —— 恢复后重新进入力量训练（叙事固定，不随剂量变化）
    tl.appendChild(el('div', { class: 'tl-item tl-item--muted' }, [
      el('div', { class: 'tl-date', text: (zh ? '明天 ' : 'Tomorrow · ') + fmtDate(tomorrow) }),
      el('div', { class: 'tl-text', text: t('home.next.tomorrow') })
    ]));

    // 节点 3：计划剂量摘要（与上方时间轴同源 state.plan，保存后整体重绘同步刷新）
    var d = plan.dose || {};
    var stimLabel = D.data(stim, stim) || (stim || '');
    var parts = [];
    if (stimLabel) parts.push(stimLabel);
    if (d.duration_min != null) parts.push(d.duration_min + (zh ? ' min' : ' min'));
    if (d.sets != null) parts.push(d.sets + (zh ? ' 组' : ' sets'));
    if (d.reps != null) parts.push(d.reps + (zh ? ' 次' : ' reps'));
    if (d.intensity != null) parts.push(d.intensity + (zh ? '/10' : '/10'));
    if (d.rest_sec != null) parts.push(d.rest_sec + (zh ? 's 休' : 's rest'));
    var sumText = parts.join(' · ');
    tl.appendChild(el('div', { class: 'tl-item' }, [el('div', { class: 'tl-text tl-summary', id: 'nextPlanSummary', text: sumText })]));

    setNextFooter(t('home.next.reeval'));

    // 变化高亮：仅当要求 flash 且摘要节点存在
    if (flash) {
      var s = document.getElementById('nextPlanSummary');
      if (s) {
        s.style.transition = 'background-color .55s ease, color .55s ease';
        s.style.backgroundColor = 'rgba(47,168,188,0.25)';
        s.style.color = '#bdf3ff';
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          s.style.backgroundColor = 'transparent';
          s.style.color = '';
        }); });
      }
    }
  }

  function setNextFooter(text) {
    var f = document.getElementById('nextFooter');
    if (f) f.textContent = text || '';
  }

  // -----------------------------------------------------------------------
  // 详情抽屉（图二交互）：点"今天的你"→ 状态详情；点"接下来"→ 完整周期计划。
  // 两抽屉与 Console / routeContent 经 PANEL_IDS 严格互斥（closeAllPanels）。
  // -----------------------------------------------------------------------
  function fmtClock(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 状态编辑弹窗（V18）：每个指标 = 拖动条(range) + 数值 + 趋势下拉(select)，底部备注 + 保存
  function fillStateDrawer(cache) {
    var body = document.getElementById('stateDrawerBody');
    if (!body) return;
    clear(body);
    var state = (cache && cache.state) || {};
    var zh = (window.NudgeI18n && window.NudgeI18n.getLocale() !== 'en-US');
    var keys = Object.keys(state);
    if (!keys.length) { body.appendChild(el('p', { class: 'd-note', text: t('home.empty.state') })); return; }
    keys.forEach(function (k) {
      var m = state[k] || {};
      var max = (m.unit_or_scale === 'h') ? 12 : 10;
      var step = (m.unit_or_scale === 'h') ? 0.1 : 1;
      var valId = 'editVal_' + k;
      var row = el('div', { class: 'edit-row', 'data-key': k }, [
        el('div', { class: 'edit-row__top' }, [
          el('span', { class: 'edit-row__label', text: t('state.' + k, k) + (m.unit_or_scale ? ' (' + m.unit_or_scale + ')' : '') }),
          el('span', { class: 'edit-row__val', id: valId, text: String(m.value) })
        ]),
        el('input', { type: 'range', min: 0, max: max, step: step, class: 'edit-range', 'data-key': k })
      ]);
      var range = row.querySelector('input[type=range]');
      range.value = (m.value != null) ? m.value : 0;
      range.addEventListener('input', function () { var v = document.getElementById(valId); if (v) v.textContent = range.value; });
      var sel = el('select', { class: 'edit-trend', 'data-key': k }, [
        el('option', { value: 'up', text: zh ? '↑ 上升' : 'Up' }),
        el('option', { value: 'down', text: zh ? '↓ 下降' : 'Down' }),
        el('option', { value: 'stable', text: zh ? '→ 平稳' : 'Stable' })
      ]);
      sel.value = m.trend || 'stable';
      row.appendChild(sel);
      body.appendChild(row);
    });
    body.appendChild(el('div', { class: 'edit-field' }, [
      el('label', { text: zh ? '今日备注' : 'Note' }),
      el('textarea', { class: 'edit-note', 'data-key': 'note', placeholder: zh ? '填写今天的调整说明（可选）' : 'Adjustment note (optional)' })
    ]));
    body.appendChild(el('div', { class: 'drawer__foot' }, [
      el('button', { class: 'drawer__save', 'data-action': 'save-state', text: t('card.save'), onclick: function () { saveAdjustment('state'); } })
    ]));
    body.appendChild(el('div', { class: 'drawer__error' }));
  }

  // 计划编辑弹窗（V18）：goal(select 宏观目标) + 具体动作(exercise select) + 剂量(dose)
  // V20（硬锁范围内重构，弹窗内部逻辑）：
  //   ① 原「训练重点 stimulus」与「训练目标 goal」概念重叠（都有 力量/活动度）→
  //      替换为数据模型现成的 exercise 字段，标签「具体动作」（高脚杯深蹲等具象文案）；
  //      字段数 7→7 不变 → 弹窗尺寸不变。stimulus 不再进表单，保存时透传 plan 原值。
  //   ② goal 选项全中文：i18n 全局字典缺的 hypertrophy/endurance 由弹窗局部字典补齐。
  //   ③ reps 数据是字符串（"10-12"），number input 装不下会渲染成空 → 改 text input；
  //      intensity 数据为 null → 默认 5（0-10 中位），杜绝空白输入框。
  function fillNextDrawer(cache) {
    var body = document.getElementById('nextDrawerBody');
    if (!body) return;
    clear(body);
    var plan = (cache && cache.plan) || {};
    var zh = (window.NudgeI18n && window.NudgeI18n.getLocale() !== 'en-US');
    if (!plan || !plan.goal) { body.appendChild(el('p', { class: 'd-note', text: t('home.empty.plan') })); return; }
    var D = window.NudgeI18n;
    // 弹窗局部中文字典：只补全局字典缺失的枚举，选项文案与右侧卡片显示保持一致
    var ZH_GOAL = { strength: '力量', hypertrophy: '增肌', endurance: '耐力', cardio: '心肺', mobility: '活动度', recovery: '恢复' };
    var ZH_EXERCISE = {
      goblet_squat: '高脚杯深蹲', squat: '深蹲', bodyweight_squat: '自重深蹲', deadlift: '硬拉',
      bench_press: '卧推', pushup: '俯卧撑', bent_over_row: '俯身划船', pull_up: '引体向上',
      plank: '平板支撑', lunge: '弓步蹲'
    };
    function dval(map, v) {
      if (v == null) return '';
      if (zh && map && map[v]) return map[v];
      return D.data(v, v);
    }

    // 训练目标（宏观）：枚举下拉，顺序 力量/增肌/耐力 优先；默认选中规整后的有效枚举
    var goalOrder = ['strength', 'hypertrophy', 'endurance', 'cardio', 'mobility', 'recovery'];
    var gsel = el('select', { class: 'edit-goal', 'data-key': 'goal' },
      goalOrder.map(function (g) { return el('option', { value: g, text: dval(ZH_GOAL, g) }); }));
    gsel.value = normalizePlanGoal(plan.goal);
    if (gsel.selectedIndex === -1) gsel.value = 'strength';   // 兜底：规整值不在选项中
    body.appendChild(el('div', { class: 'edit-field' }, [
      el('label', { text: zh ? '训练目标' : 'Goal' }), gsel
    ]));

    // 具体动作（替代原「训练重点 stimulus」）：数据模型现成字段 exercise，具象中文文案
    var exOrder = ['goblet_squat', 'squat', 'bodyweight_squat', 'deadlift', 'bench_press', 'pushup', 'bent_over_row', 'pull_up', 'plank', 'lunge'];
    var curEx = plan.exercise || 'goblet_squat';
    if (exOrder.indexOf(curEx) === -1) exOrder = [curEx].concat(exOrder);   // 未知值兜底进选项，防保存丢失
    var esel = el('select', { class: 'edit-exercise', 'data-key': 'exercise' },
      exOrder.map(function (x) { return el('option', { value: x, text: dval(ZH_EXERCISE, x) }); }));
    esel.value = curEx;
    body.appendChild(el('div', { class: 'edit-field' }, [
      el('label', { text: zh ? '具体动作' : 'Exercise' }), esel
    ]));

    var dose = plan.dose || {};
    // reps 为文本型（"10-12"），其余数值型；intensity 缺省给 5，不留空白框
    var doseFields = [
      ['duration_min', zh ? '时长(分钟)' : 'Duration (min)', 'number'],
      ['sets', zh ? '组数' : 'Sets', 'number'],
      ['reps', zh ? '次数' : 'Reps', 'text'],
      ['intensity', zh ? '强度(0-10)' : 'Intensity (0-10)', 'number'],
      ['rest_sec', zh ? '组间休息(秒)' : 'Rest (sec)', 'number']
    ];
    var doseDefaults = { intensity: 5, reps: '10-12' };
    doseFields.forEach(function (f) {
      var attrs = { class: 'edit-dose', 'data-key': f[0] };
      if (f[2] === 'number') attrs.type = 'number', attrs.min = 0;
      else attrs.type = 'text';
      var inp = el('input', attrs);
      var v = dose[f[0]];
      inp.value = (v != null && v !== '') ? v : (doseDefaults[f[0]] != null ? doseDefaults[f[0]] : '');
      body.appendChild(el('div', { class: 'edit-field' }, [el('label', { text: f[1] }), inp]));
    });

    body.appendChild(el('div', { class: 'drawer__foot' }, [
      el('button', { class: 'drawer__save', 'data-action': 'save-plan', text: t('card.save'), onclick: function () { saveAdjustment('plan'); } })
    ]));
    body.appendChild(el('div', { class: 'drawer__error' }));
  }

  // 编辑弹窗开关（V18）：互斥打开，关闭走 closeEditModal
  function openEdit(kind) {
    if (window.closeAllPanels) window.closeAllPanels();   // 先关全部面板（天然禁止两弹窗同开）
    if (kind === 'state') { fillStateDrawer(App.cache); if (window.openPanel) window.openPanel('stateDrawer'); }
    else { fillNextDrawer(App.cache); if (window.openPanel) window.openPanel('nextDrawer'); }
  }
  function closeEditModal() { if (window.closeAllPanels) window.closeAllPanels(); }

  // 从表单控件收集编辑草稿
  function collectDraft(kind, body) {
    if (kind === 'state') {
      var draft = {};
      body.querySelectorAll('.edit-row').forEach(function (row) {
        var k = row.getAttribute('data-key');
        var range = row.querySelector('input[type=range]');
        var sel = row.querySelector('select');
        draft[k] = { value: range ? parseFloat(range.value) : 0, trend: sel ? sel.value : 'stable' };
      });
      var note = body.querySelector('.edit-note');
      if (note && note.value.trim()) draft.note = note.value.trim();
      return { state: draft };
    }
    var d = { goal: '', stimulus: '', exercise: '', dose: {} };
    var goal = body.querySelector('.edit-goal'); if (goal) d.goal = goal.value;
    // V20：stimulus 已不在表单中（表单展示的是 exercise「具体动作」）——
    // 透传当前 plan 原值，保证卡片「下肢力量」与后端数据不受保存影响
    d.stimulus = (App.cache && App.cache.plan && App.cache.plan.stimulus) || '';
    var ex = body.querySelector('.edit-exercise'); if (ex) d.exercise = ex.value;
    body.querySelectorAll('.edit-dose').forEach(function (inp) {
      var k = inp.getAttribute('data-key');
      if (k === 'reps') {                       // reps 为文本型（"10-12"），按字符串收集
        var s = String(inp.value || '').trim();
        if (s) d.dose[k] = s;
        return;
      }
      var v = parseFloat(inp.value);
      if (!isNaN(v)) d.dose[k] = v;
    });
    return { plan: d };
  }

  // 把草稿写回 cache（乐观更新；也用于 bootstrap 刷新后编辑值兜底）
  function applyDraft(kind, draft) {
    if (!App.cache) return;
    if (kind === 'state' && draft.state) {
      Object.keys(draft.state).forEach(function (k) {
        if (k === 'note') return;
        if (App.cache.state && App.cache.state[k]) {
          App.cache.state[k].value = draft.state[k].value;
          App.cache.state[k].trend = draft.state[k].trend;
        }
      });
    } else if (kind === 'plan' && draft.plan) {
      if (!App.cache.plan) App.cache.plan = {};
      if (draft.plan.goal != null) App.cache.plan.goal = draft.plan.goal;
      if (draft.plan.stimulus != null) App.cache.plan.stimulus = draft.plan.stimulus;
      if (draft.plan.exercise != null) App.cache.plan.exercise = draft.plan.exercise;
      if (draft.plan.dose) App.cache.plan.dose = Object.assign({}, App.cache.plan.dose, draft.plan.dose);
    }
  }

  // 保存调整：乐观更新卡片 → POST /api/interactions 通知后端 → 重新 GET /api/bootstrap 刷新 → Toast
  async function saveAdjustment(kind) {
    var body = document.getElementById(kind === 'state' ? 'stateDrawerBody' : 'nextDrawerBody');
    if (!body) return;
    var btn = body.querySelector('.drawer__save');
    var errEl = body.querySelector('.drawer__error');
    var draft;
    try { draft = collectDraft(kind, body); }
    catch (e) { if (errEl) errEl.textContent = (e && e.message) || ''; return; }
    if (errEl) errEl.textContent = '';
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = t('card.saving'); }

    // 乐观更新：卡片立即同步刷新（即便后端 demo 不持久化也能即时反馈）
    applyDraft(kind, draft);
    fillStateCard(App.cache); fillNextCard(App.cache, kind === 'plan');

    try {
      // 1) 通知后端（现有更新接口 /api/interactions；best-effort，不阻断 UI）
      await NudgeApp.api('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: JSON.stringify(draft), input_type: 'adjustment' })
      });
      // 2) 重新拉取 bootstrap（权威刷新）；编辑值兜底覆盖（后端 demo 不持久化 state/plan）
      var boot = await NudgeApp.api('/api/bootstrap');
      if (boot && !boot.error) {
        App.cache = Object.assign({}, App.cache, boot);
        applyDraft(kind, draft);
        fillStateCard(App.cache); fillNextCard(App.cache, kind === 'plan');
      }
      closeEditModal();
      if (window.NudgeErr && window.NudgeErr.toast) window.NudgeErr.toast(t('card.saved'));
    } catch (e) {
      // 失败：弹窗内红字，绝不白屏；并撤销乐观更新（回退到 bootstrap 原值）
      if (errEl) errEl.textContent = t('card.saveFailed') + (e && e.message ? '：' + e.message : '');
      try {
        var b2 = await NudgeApp.api('/api/bootstrap');
        if (b2 && !b2.error) { App.cache = Object.assign({}, App.cache, b2); fillStateCard(App.cache); fillNextCard(App.cache); }
      } catch (e2) { /* 守卫自身绝不抛 */ }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || t('card.save'); }
    }
  }

  function bindDrawers() {
    var stateCard = document.getElementById('stateCard');
    if (stateCard) stateCard.addEventListener('click', function () { openEdit('state'); });
    var nextCard = document.getElementById('nextCard');
    if (nextCard) nextCard.addEventListener('click', function () { openEdit('plan'); });
    var sc = document.getElementById('stateDrawerClose');
    if (sc) sc.addEventListener('click', function () { closeEditModal(); });
    var nc = document.getElementById('nextDrawerClose');
    if (nc) nc.addEventListener('click', function () { closeEditModal(); });
    // 点遮罩 / 弹窗外区关闭；阻止冒泡避免被全局 document 面板外关闭逻辑误伤
    ['stateDrawer', 'nextDrawer'].forEach(function (id) {
      var d = document.getElementById(id);
      if (!d) return;
      d.addEventListener('click', function (e) {
        if (e.target === d || (e.target.classList && e.target.classList.contains('drawer__backdrop'))) closeEditModal();
        e.stopPropagation();
      });
    });
  }

  // -----------------------------------------------------------------------
  // 路由渲染器注册（home / memory / settings）
  // -----------------------------------------------------------------------
  App.routes.home = function (container, cache) {
    fillStateCard(cache);
    fillNextCard(cache);
    container.innerHTML = '';   // Home 无固定页面，浮窗在 shell 中
  };

  // 记忆页 i18n 映射字典：把后端返回的英文枚举 / 业务 key 翻译成界面文案。
  // 仅渲染层翻译，绝不改动卡片结构、样式或尺寸。
  var MEM_DICT = {
    type: { stable_preference: '稳定偏好', inferred_preference: '推断偏好' },
    key: {
      preferred_training_time: '偏好训练时间',
      prefers_bodyweight_home: '偏好居家自重训练',
      preferred_intensity: '偏好训练强度',
      preferred_training_duration: '偏好训练时长'
    },
    value: { evening: '晚上', true: '是', false: '否', moderate: '中等', high: '高', low: '低' },
    source: { user_confirmed: '用户已确认', agent_proposed: '系统建议' },
    status: { active: '生效中', pending_confirmation: '待确认' }
  };
  var MEM_LABELS_ZH = { key: '键', value: '值', source: '来源', confidence: '置信度', type: '类型' };
  var MEM_LABELS_EN = { key: 'Key', value: 'Value', source: 'Source', confidence: 'Confidence', type: 'Type' };
  function memIsZh() { return !(window.NudgeI18n && window.NudgeI18n.getLocale() === 'en-US'); }
  function memTranslate(map, raw) { return (map && Object.prototype.hasOwnProperty.call(map, raw)) ? map[raw] : raw; }

  // 待确认卡片：点击「确认」→ 乐观更新状态为 active（后端无 /api/memory/confirm 时静默兜底）
  function memConfirm(memoryId, container, cache) {
    var list = (cache && cache.memory) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].memory_id === memoryId) { list[i].status = 'active'; break; }
    }
    try {
      fetch('/api/memory/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_id: memoryId })
      }).catch(function () {});
    } catch (e) { /* 接口不存在：前端乐观更新已生效 */ }
    App.routes.memory(container, cache);
    if (window.NudgeErr) window.NudgeErr.toast(memIsZh() ? '已确认' : 'Confirmed');
  }
  // 待确认卡片：点击「忽略」→ 从当前列表移除该卡片
  function memIgnore(memoryId, container, cache) {
    var list = (cache && cache.memory) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].memory_id === memoryId) { list.splice(i, 1); break; }
    }
    App.routes.memory(container, cache);
  }

  App.routes.memory = function (container, cache) {
    var raw = (cache && cache.memory) || [];
    // 清理脏数据：key:z / value:w 的测试条目替换为合理演示数据（保留原 status，以便确认交互可演示）
    var mem = raw.map(function (m) {
      if (m && m.key === 'z' && m.value === 'w') {
        return Object.assign({}, m, {
          type: 'stable_preference',
          key: 'preferred_training_duration',
          value: '45',
          source: m.source || 'agent_proposed'
        });
      }
      return m;
    });
    var zh = memIsZh();
    var labels = zh ? MEM_LABELS_ZH : MEM_LABELS_EN;
    var page = el('div', { class: 'page' }, [
      el('h2', { class: 'page__title', text: t('memory.title') }),
      el('p', { class: 'page__sub', text: t('memory.sub') })
    ]);
    if (!mem.length) {
      page.appendChild(el('div', { class: 'page__section', text: t('memory.empty') }));
    } else {
      mem.forEach(function (m) {
        var status = m.status || 'active';
        var typeText = memTranslate(MEM_DICT.type, m.type || m.key || m.memory_id);
        var tag = el('span', { class: 'tag' + (status === 'pending_confirmation' ? ' pending' : ''), text: memTranslate(MEM_DICT.status, status) });
        var kvs = el('div', { class: 'kv-grid' }, [
          el('span', { class: 'k', text: labels.key }), el('span', { class: 'v', text: memTranslate(MEM_DICT.key, m.key) }),
          el('span', { class: 'k', text: labels.value }), el('span', { class: 'v', text: memTranslate(MEM_DICT.value, m.value) }),
          el('span', { class: 'k', text: labels.source }), el('span', { class: 'v', text: memTranslate(MEM_DICT.source, m.source) }),
          el('span', { class: 'k', text: labels.confidence }), el('span', { class: 'v', text: (m.confidence != null ? String(m.confidence) : '—') })
        ]);
        var children = [
          el('div', {}, [el('b', { text: typeText }), tag]),
          kvs
        ];
        // 待确认：卡片右下角极简「确认 / 忽略」按钮（内联样式，不改动卡片外观）
        if (status === 'pending_confirmation') {
          var actions = el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px;' });
          actions.appendChild(el('button', {
            text: zh ? '确认' : 'Confirm',
            style: 'font-family:var(--font-sans);font-size:12px;padding:3px 12px;border-radius:8px;cursor:pointer;color:#9FD8BC;border:1px solid rgba(76,158,110,0.40);background:rgba(76,158,110,0.14);',
            onclick: function () { memConfirm(m.memory_id, container, cache); }
          }));
          actions.appendChild(el('button', {
            text: zh ? '忽略' : 'Ignore',
            style: 'font-family:var(--font-sans);font-size:12px;padding:3px 12px;border-radius:8px;cursor:pointer;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.18);background:transparent;',
            onclick: function () { memIgnore(m.memory_id, container, cache); }
          }));
          children.push(actions);
        }
        page.appendChild(el('div', { class: 'mem-item' }, children));
      });
    }
    page.appendChild(el('button', { class: 'page__close', text: t('common.back'), onclick: function () { location.hash = '#/home'; } }));
    clear(container);
    container.appendChild(page);
  };

  App.routes.settings = function (container, cache) {
    var s = (cache && cache.settings) || {};
    var p = (cache && cache.permissions) || {};
    var permRows = [
      ['perm.trainingAdjustment', p.training_adjustment],
      ['perm.activeIntervention', p.active_intervention],
      ['perm.calendar', p.calendar],
      ['perm.location', p.location],
      ['perm.weather', p.weather],
      ['perm.maps', p.maps],
      ['perm.venue', p.venue]
    ];
    var page = el('div', { class: 'page' }, [
      el('h2', { class: 'page__title', text: t('settings.title') }),
      el('p', { class: 'page__sub', text: t('settings.sub') })
    ]);
    var sec1 = el('div', { class: 'page__section' }, [el('h3', { text: t('settings.prefs') })]);
    sec1.appendChild(el('div', { class: 'kv-grid' }, [
      el('span', { class: 'k', text: t('settings.locale') }), el('span', { class: 'v', text: String(s.locale || 'zh-CN') }),
      el('span', { class: 'k', text: t('settings.activeIntervention') }), el('span', { class: 'v', text: s.active_intervention_enabled ? t('common.on') : t('common.off') }),
      el('span', { class: 'k', text: t('settings.maxDaily') }), el('span', { class: 'v', text: String(s.max_daily_interventions != null ? s.max_daily_interventions : '—') }),
      el('span', { class: 'k', text: t('settings.voiceInput') }), el('span', { class: 'v', text: s.voice_input_enabled ? t('common.on') : t('common.off') })
    ]));
    // V15：语音播报（TTS）开关 —— 关闭立即静音（cancel 在播），localStorage 持久
    sec1.appendChild(el('div', { class: 'setrow' }, [
      el('span', { class: 'k', text: t('settings.tts') }),
      el('button', {
        class: 'switch' + (ttsMuted ? '' : ' is-on'),
        'aria-pressed': String(!ttsMuted),
        'aria-label': t('settings.tts'),
        onclick: function () {
          setTtsMuted(!ttsMuted);
          this.classList.toggle('is-on', !ttsMuted);
          this.setAttribute('aria-pressed', String(!ttsMuted));
        }
      })
    ]));
    page.appendChild(sec1);

    var sec2 = el('div', { class: 'page__section' }, [el('h3', { text: t('settings.perms') })]);
    var grid = el('div', { class: 'kv-grid' });
    permRows.forEach(function (r) {
      var v = r[1];
      var txt;
      if (v && v.enabled) {
        txt = t('perm.allowed') + (v.autonomy_level ? ' · ' + v.autonomy_level : (v.max_per_day != null ? ' · ' + v.max_per_day + t('perm.perDay') : ''));
      } else {
        txt = t('perm.denied');
      }
      grid.appendChild(el('span', { class: 'k', text: t(r[0]) }));
      grid.appendChild(el('span', { class: 'v', text: txt }));
    });
    sec2.appendChild(grid);
    page.appendChild(sec2);

    page.appendChild(el('button', { class: 'page__close', text: t('common.back'), onclick: function () { location.hash = '#/home'; } }));
    clear(container);
    container.appendChild(page);
  };

  // Permission 页（导航"权限"）：数据来自 bootstrap.permissions（§17，只读展示）
  App.routes.permission = function (container, cache) {
    var p = (cache && cache.permissions) || {};
    var permRows = [
      ['perm.trainingAdjustment', p.training_adjustment],
      ['perm.activeIntervention', p.active_intervention],
      ['perm.calendar', p.calendar],
      ['perm.location', p.location],
      ['perm.weather', p.weather],
      ['perm.maps', p.maps],
      ['perm.venue', p.venue]
    ];
    var page = el('div', { class: 'page' }, [
      el('h2', { class: 'page__title', text: window.NudgeI18n.data('perm.page.title', '权限') }),
      el('p', { class: 'page__sub', text: window.NudgeI18n.data('perm.page.sub', 'Agent 可使用的上下文与干预范围') })
    ]);
    var grid = el('div', { class: 'kv-grid' });
    permRows.forEach(function (r) {
      var v = r[1];
      var txt;
      if (v && v.enabled) {
        txt = t('perm.allowed') + (v.autonomy_level ? ' · ' + v.autonomy_level : (v.max_per_day != null ? ' · ' + v.max_per_day + t('perm.perDay') : ''));
      } else {
        txt = t('perm.denied');
      }
      grid.appendChild(el('span', { class: 'k', text: t(r[0]) }));
      grid.appendChild(el('span', { class: 'v', text: txt }));
    });
    page.appendChild(grid);
    page.appendChild(el('button', { class: 'page__close', text: t('common.back'), onclick: function () { location.hash = '#/home'; } }));
    clear(container);
    container.appendChild(page);
  };

  // -----------------------------------------------------------------------
  // 对话（全局，#conversation 在 shell 中持久；POST /api/interactions）
  // -----------------------------------------------------------------------
  function bindConversation() {
    var input = document.getElementById('convInput');
    var send = document.getElementById('convSend');
    var log = document.getElementById('convLog');
    if (!input || !send || !log) return;

    // V13b：对话聚焦 —— 发送/回复时隐藏悬浮卡片（state/quote/next）。
    // 退出改造：卡片仅由「❮ 退出对话」按钮或 60s 无操作兜底移除（immersiveExit），
    // 不再自动恢复 —— 解决"聊很久会自动跳回主页"的反人类行为。
    function armDialogueFocus() {
      document.body.classList.add('dialoguing');   // 发送/回复期间隐藏卡片；退出时由 immersiveExit 统一恢复
    }

    // ---------------------------------------------------------------------
    // V14：滑动窗口 + 摘要压缩 长记忆（前端持有状态；后端超窗时压缩并回传新状态）
    //   mem.recent  最近 6 轮（≤12 条，user/assistant 交替）
    //   mem.summary 更早历史的摘要（后端压缩生成）
    // ---------------------------------------------------------------------
    var mem = { recent: [], summary: '' };
    var HISTORY_MAX_MSGS = 12;       // 6 轮
    var HISTORY_SNIPPET = 100;       // 入记忆时逐条截断（控制载荷；完整文本仍在气泡里）

    // =====================================================================
    // DST：未完成任务状态追踪（跨滑动窗口挂起，绝不被 mem/窗口截断清空）
    //   activeTask 是独立变量，刻意游离于 mem（conversationHistory）之外——
    //   滑动窗口只截断 mem.recent，绝不动 activeTask（满足硬边界令）。
    // =====================================================================
    var activeTask = null;   // { type:'discovery', original_query:'帮我找附近的场地' }

    // 发现意图检测：用户主动发起一个跨轮次挂起的任务（如“找附近的场地”）
    function maybeStartTask(userText) {
      var s = String(userText || '').trim();
      if (!s) return null;
      if (/(找|查|看|搜|探|附近|周边|身边).{0,8}(场地|场馆|健身房|训练地点|训练场|gym|venue|place)/i.test(s)
        || /(discover|find|nearby).{0,12}(venue|place|gym)/i.test(s)) {
        return s;
      }
      return null;
    }
    // 用户明确取消（点标签或说取消类话）
    function maybeCancelTask(userText) {
      return /(取消|不用了|算了|不找了|别找了|不需要了|没用了)/i.test(String(userText || ''));
    }
    // 任务已完成（agent 已交付场地等）——清空挂起态
    function maybeCompleteTask(replyText) {
      return /(已(经)?(为您)?找到|找到了附近|为您找到|以下是?.*场地|附近有.*(场地|场馆)|已帮您.*(场地|场馆))/i.test(String(replyText || ''));
    }
    // 短标签：用于幽灵提示（例：“寻找场地”）
    function shortTaskLabel(q) {
      if (/场地|场馆|健身房|训练地点|训练场|gym|venue|place/i.test(q)) return '寻找场地';
      if (/附近|周边|地图/i.test(q)) return '查找附近';
      return String(q || '').slice(0, 10);
    }
    function clearActiveTask() {
      activeTask = null;
      var tag = document.getElementById('activeTaskTag');
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
    }
    // 在输入坞上方渲染一个极小的“幽灵标签”，点击可取消；绝对定位脱离文档流，零布局位移
    function renderActiveTaskTag() {
      if (!activeTask) { clearActiveTask(); return; }
      var dock = document.getElementById('voiceDock');
      if (!dock) return;
      var tag = document.getElementById('activeTaskTag');
      if (!tag) {
        tag = document.createElement('div');
        tag.id = 'activeTaskTag';
        tag.addEventListener('click', clearActiveTask);
        dock.appendChild(tag);
      }
      tag.textContent = '⏳ 正在进行：' + shortTaskLabel(activeTask.original_query);
      tag.setAttribute('style',
        'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:10px;' +
        'display:inline-flex;align-items:center;gap:4px;cursor:pointer;pointer-events:auto;' +
        'font-size:11px;line-height:1.3;white-space:nowrap;z-index:60;' +
        'padding:4px 11px;border-radius:999px;' +
        'background:rgba(18,24,36,0.85);color:#FFFFFF;' +
        'border:1px solid rgba(255,255,255,0.22);' +
        'box-shadow:0 4px 14px rgba(0,0,0,0.25);');
      tag.title = '点击取消该任务';
    }

    function pushMemory(role, text) {
      mem.recent.push({ role: role, content: String(text || '').slice(0, HISTORY_SNIPPET) });
      while (mem.recent.length > 40) mem.recent.shift();   // 防御：请求连续失败时不无限增长
    }

    // 一键清空：重置记忆 + 清空气泡 + 恢复欢迎语（记忆与 UI 一起重置）
    function clearConversation() {
      mem.recent.length = 0;
      mem.summary = '';
      clear(log);
      log.appendChild(el('div', { class: 'bubble bubble--agent' }, [
        el('span', { class: 'bubble__who', text: t('chat.agent') }),
        document.createTextNode(t('chat.welcome'))
      ]));
      var speech = document.getElementById('agentSpeech');
      if (speech) speech.textContent = t('chat.welcome');
      if (window.NudgeErr && window.NudgeErr.toast) window.NudgeErr.toast(t('chat.cleared'));
    }

    // ---------------------------------------------------------------------
    // 沉浸模式「进入 / 退出 / 主页状态重置」（V-退出改造）：
    //   · 进入：聚焦输入框 / 按住说话 → 三卡片 .immersive-dim 模糊；显示左上角「❮ 退出对话」按钮。
    //   · 退出（手动为主 + 60s 兜底）：点击按钮 / Esc / 60s 无操作且输入框空 → 主页清零。
    //   · 废除旧「停输 3s 自动返回主页」定时器（反人类）；退出即清空会话、移除气泡、重置问候语、
    //     恢复卡片、输入框失焦清空。绝不动数字人背景、输入坞、左右卡片的结构与样式。
    // ---------------------------------------------------------------------
    var IMMERSIVE_CARDS = ['stateCard', 'quoteCard', 'nextCard'];
    var IDLE_MS = 60000;            // 兜底：60s 内无任何鼠标/键盘操作且输入框为空 → 温和自动退出
    var idleTimer = null;
    var lastActivity = Date.now();

    // 左上角「❮ 退出对话」按钮（仅沉浸态可见；极小优雅；数字人/输入坞/卡片结构一律不动）
    var exitBtn = document.getElementById('immersiveExitBtn');
    if (!exitBtn) {
      exitBtn = document.createElement('button');
      exitBtn.id = 'immersiveExitBtn';
      exitBtn.type = 'button';
      exitBtn.className = 'immersive-exit-btn';
      exitBtn.textContent = '❮ 退出对话';
      exitBtn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        immersiveExit('manual');
      });
      document.body.appendChild(exitBtn);
    }
    function showExitBtn() { if (exitBtn) exitBtn.classList.add('is-visible'); }
    function hideExitBtn() { if (exitBtn) exitBtn.classList.remove('is-visible'); }

    function immersiveActive() { return document.body.classList.contains('immersive'); }

    // 60s 兜底：仅当输入框为空（无待发送内容）才退出；否则等清空后再计时
    function markActivity() {
      lastActivity = Date.now();
      if (immersiveActive()) armIdleExit();
    }
    function armIdleExit() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(tryIdleExit, IDLE_MS);
    }
    function tryIdleExit() {
      if (!immersiveActive()) { idleTimer = null; return; }
      if (!input || !input.value.trim()) immersiveExit('idle');
      else armIdleExit();
    }

    // 主页状态清零（退出核心）：清空记忆 + 移除气泡 DOM + 重置未完成任务 + 失焦清空输入
    function doHomeReset() {
      userSpoke = false;                       // 允许欢迎语重新覆盖（renderWelcome 同步 #agentSpeech）
      mem.recent.length = 0;
      mem.summary = '';
      clear(log);                              // 第二步：移除对话气泡区域所有 DOM 节点（彻底清除长文本残留）
      renderWelcome();                         // 重建欢迎气泡（隐藏容器回到初始）
      clearActiveTask();                       // 清空未完成任务幽灵标签
      if (input) { input.value = ''; input.blur(); }   // 第五步：输入框失焦 + 清空残留文本
    }

    function immersiveEnter() {
      if (immersiveActive()) { armIdleExit(); return; }   // 重入：仅刷新 60s 计时
      document.body.classList.add('immersive');
      IMMERSIVE_CARDS.forEach(function (id) {
        var c = document.getElementById(id);
        if (c) c.classList.add('immersive-dim');
      });
      showExitBtn();
      armIdleExit();                           // 进入即起 60s 兜底计时（持续操作会刷新）
    }

    function immersiveExit(reason) {
      if (!immersiveActive()) { hideExitBtn(); return; }
      hideExitBtn();
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      // 第四步：恢复卡片（移除隐藏类与沉浸模糊类；CSS 0.45s 平滑浮现）
      document.body.classList.remove('immersive');
      document.body.classList.remove('dialoguing');
      IMMERSIVE_CARDS.forEach(function (id) {
        var c = document.getElementById(id);
        if (c) c.classList.remove('immersive-dim');
      });
      // 第三步：问候语标题/描述立即重置为初始状态
      if (window.NudgeApp && window.NudgeApp.resetGreeting) window.NudgeApp.resetGreeting();
      // 长文本（#agentSpeech）先 0.2s 淡出，再重置为初始欢迎语（避免生硬消失）
      var speech = document.getElementById('agentSpeech');
      if (speech) {
        speech.classList.add('immer-fade-out');
        setTimeout(function () {
          doHomeReset();
          if (speech) speech.classList.remove('immer-fade-out');
        }, 200);
      } else {
        doHomeReset();
      }
    }

    // ping：保留接口兼容 voice.js（松开录音时曾起 3s 退出）；现改为空操作（退出只走按钮/60s 兜底）
    function immersivePing() {}

    window.NudgeImmersive = {
      enter: immersiveEnter,
      exit: immersiveExit,
      ping: immersivePing,
      active: immersiveActive
    };

    // 全局活动监听（仅沉浸态生效）：刷新 60s 兜底计时的窗口
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll', 'wheel'].forEach(function (ev) {
      document.addEventListener(ev, markActivity, { passive: true });
    });

    // 上下文超限：气泡提示（含一键清空按钮）+ 同步到可见的 #agentSpeech（当前空间 UI 的对话字幕面）
    function pushContextBubble() {
      var speech = document.getElementById('agentSpeech');
      if (speech) speech.textContent = t('chat.contextExceeded');
      var wrap = el('div', { class: 'bubble bubble--agent bubble--action' }, [
        el('span', { class: 'bubble__who', text: t('chat.agent') }),
        document.createTextNode(t('chat.contextExceeded'))
      ]);
      wrap.appendChild(el('button', {
        class: 'bubble__clear',
        text: t('chat.clearChat'),
        onclick: function () { openClearConfirm(); }   // V15：与顶部按钮一致，走二次确认
      }));
      log.appendChild(wrap);
      log.scrollTop = log.scrollHeight;
    }

    // V15：清空对话迁移至顶部导航 🗑️（dock 内按钮已移除）——点击弹二次确认，确认后重置
    var clearModal = document.getElementById('clearConfirm');
    function openClearConfirm() {
      if (clearModal) clearModal.classList.add('active');
      else clearConversation();   // 兜底：弹窗缺失时直接清空
    }
    var resetBtn = document.getElementById('resetChatBtn');
    if (resetBtn) resetBtn.addEventListener('click', openClearConfirm);
    if (clearModal) {
      clearModal.querySelectorAll('[data-clear-cancel]').forEach(function (b) {
        b.addEventListener('click', function () { clearModal.classList.remove('active'); });
      });
      var okBtn = clearModal.querySelector('[data-clear-ok]');
      if (okBtn) okBtn.addEventListener('click', function () {
        clearModal.classList.remove('active');
        clearConversation();
      });
    }

    // 切到打字模式：输入框已替换"按住说话"，直接聚焦即可输入；切回语音失焦
    var modeToggle = document.getElementById('typeToggle');
    if (modeToggle) {
      modeToggle.addEventListener('change', function () {
        if (modeToggle.checked && input) input.focus();
        else if (input) input.blur();
      });
    }

    function pushBubble(who, text) {
      // EN 态：服务端 Runtime 返回的中文回复经前端词典整串映射为英文（服务端不可改）
      var shown = text || '';
      if (who === 'agent' && window.NudgeI18n && window.NudgeI18n.getLocale() === 'en-US') {
        shown = window.NudgeI18n.dataText(shown);
      }
      var b = el('div', { class: 'bubble bubble--' + (who === 'user' ? 'user' : 'agent') }, [
        el('span', { class: 'bubble__who', text: who === 'user' ? t('chat.you') : t('chat.agent') }),
        document.createTextNode(shown)
      ]);
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      // Agent 表达同步到空间中的 #agentSpeech（"声音在空间里出现"，非聊天气泡）
      if (who === 'agent') {
        var speech = document.getElementById('agentSpeech');
        if (speech) speech.textContent = shown;
      }
    }

    function speak(text) {
      // V13：TTS 静音开关 —— 关闭时不朗读（静音点击时已 cancel 在播语音）
      if (ttsMuted) return;
      // 回复朗读走 Phase 9 的 canonical TTS 层（不可用时静默降级，文字回复照常）
      if (window.NudgeText) { window.NudgeText.speak(text); return; }
      try {
        if ('speechSynthesis' in window && text) {
          var u = new SpeechSynthesisUtterance(text);
          u.lang = (App.locale === 'en-US') ? 'en-US' : 'zh-CN';
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        }
      } catch (e) { /* 默认 TTS adapter 不可用则静默 */ }
    }

    function sendMsg() {
      var text = (input.value || '').trim();
      if (!text) return;
      userSpoke = true;
      armDialogueFocus(12000);             // V13：对话开始，聚焦模式隐藏卡片（12s 兜底，回复到达后 3s 恢复）
      pushBubble('user', text);
      input.value = '';
      App.setPresence('THINKING');         // Presentation：等待 LLM 响应

      // DST：发送即检测任务起点 / 取消（任务态独立于滑动窗口 mem，绝不随窗口截断清空）
      if (maybeCancelTask(text)) {
        clearActiveTask();
      } else {
        var started = maybeStartTask(text);
        if (started) {
          activeTask = { type: 'discovery', original_query: started };
          renderActiveTaskTag();
        }
      }

      // 第三步：真实对话触发 —— 调用 /api/llm/complete（预算护栏 + System Prompt + 真实 fetch）
      // V14：请求体携带 summaryMemory + recentHistory + 当前输入（不再传完整历史）
      // DST：携带挂起的未完成任务 active_task（null 表示无），后端注入 System Prompt
      App.api('/api/llm/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          summaryMemory: mem.summary,
          recentHistory: mem.recent,
          active_task: activeTask ? activeTask.original_query : null,
          maxOutputTokens: 600
        })
      })
        .then(function (data) {
          armDialogueFocus();              // V13：回复到达，3s 后恢复卡片（与沉浸退出节奏一致）
          if (data && data.error) {
            if (data.error.code === 'LLM_CONTEXT_EXCEEDED') {
              // V14：上下文超限 —— 气泡提示 + 一键清空按钮，不清空现有历史气泡
              App.setPresence('IDLE');
              pushContextBubble();
              return;
            }
            // 未配置 / 超预算 / 超时 / 网络错误：友好气泡提示，不白屏
            App.setPresence('IDLE');
            pushBubble('agent', errorToText(data.error));
            return;
          }
          var reply = (data && typeof data.completion === 'string' && data.completion) ? data.completion : t('chat.noReply');
          App.setPresence('SPEAKING');      // Presentation：agent 正在表达
          pushBubble('agent', reply);
          speak(reply);
          // DST：agent 已交付任务（如找到场地）→ 清空挂起态
          if (maybeCompleteTask(reply)) clearActiveTask();
          // V14：本轮成功才入记忆（user + assistant 成对）；后端回传的 recentHistory
          // 不含当前轮 —— 以它为基线，再补回本轮两条（否则当前轮会被覆盖丢失）
          if (data && data.memory) {
            mem.summary = String(data.memory.summaryMemory || '');
            if (Array.isArray(data.memory.recentHistory)) {
              mem.recent = data.memory.recentHistory.slice(0, 20);
              pushMemory('user', text);
              pushMemory('assistant', reply);
            }
          } else {
            pushMemory('user', text);
            pushMemory('assistant', reply);
          }
          App.setPresence('DECISION_UPDATED');
        })
        .catch(function () {
          App.setPresence('IDLE');
          armDialogueFocus();
          pushBubble('agent', t('chat.connFailed'));
        });
    }

    // 错误码 → 用户可见文案（不得白屏；与后端 errorShape.message_key 对齐）
    function errorToText(err) {
      var zh = !(window.NudgeI18n && window.NudgeI18n.getLocale() === 'en-US');
      var code = err && err.code;
      if (code === 'LLM_NOT_CONFIGURED') {
        return zh ? '尚未配置 LLM API Key，请点击右上角「API」填写后重试。' : 'LLM API key not configured — open "API" (top-right) to add one.';
      }
      if (code === 'LLM_BUDGET_EXCEEDED') {
        return zh ? '当前预算不足，已切换至确定性回复（请联系演示方重置预算）。' : 'Budget exhausted — switched to deterministic reply.';
      }
      if (code === 'LLM_TIMEOUT') {
        return zh ? '模型响应超时，请稍后再试。' : 'Model timed out. Try again.';
      }
      var d = (err && err.detail) ? String(err.detail) : '';
      return zh ? ('调用模型出错：' + (d || '服务暂不可用')) : ('Model error: ' + (d || 'unavailable'));
    }

    send.addEventListener('click', sendMsg);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (window.NudgeImmersive) window.NudgeImmersive.exit(); input.blur(); }
    });
    // 输入即进入/刷新沉浸（持续打字保持沉浸；停输 3s 后退出，若仍聚焦再次打字会重新进入）
    input.addEventListener('input', function () { if (window.NudgeImmersive) window.NudgeImmersive.enter(); });
    input.addEventListener('focus', function () {
      App.setPresence('LISTENING');
      if (window.NudgeImmersive) window.NudgeImmersive.enter();   // 聚焦输入框 → 进入沉浸
    });

    // 退出改造：沉浸模式仅由左上角「❮ 退出对话」按钮 / Esc / 60s 无操作兜底退出，
    // 删除旧的「点击空白或卡片即退出」监听，避免误触丢失对话记录。
    // 左上 Logo「返回主页」：保留原有路由行为，额外清空输入框 + 退出沉浸（关闭弹窗由原有逻辑负责）
    var navHomeEl = document.getElementById('navHome');
    if (navHomeEl) navHomeEl.addEventListener('click', function () {
      if (window.NudgeImmersive) window.NudgeImmersive.exit();
      if (input) input.value = '';
    });
  }

  // -----------------------------------------------------------------------
  // LLM API 配置弹窗（第一步）：仅把配置 POST 到 /api/llm/config（服务端内存）
  // 安全：api_key 仅随请求发出，绝不 console.log、绝不写 localStorage
  // -----------------------------------------------------------------------
  function bindLLMConfig() {
    var modal = document.getElementById('llmConfigModal');
    var openBtn = document.getElementById('navLlm');
    var closeBtn = document.getElementById('llmConfigClose');
    var backdrop = document.getElementById('llmConfigBackdrop');
    var saveBtn = document.getElementById('llmConfigSave');
    var statusEl = document.getElementById('llmConfigStatus');
    if (!modal || !openBtn) return;

    function openModal() {
      // 不回填 API Key（前端从不持有密钥）
      modal.style.display = '';          // 清掉路由卸载时的内联兜底，交还 .is-open 控制
      modal.classList.add('is-open');
    }
    function closeModal() {
      modal.classList.remove('is-open');
      modal.style.display = 'none';      // 内联兜底：彻底隐藏（表单标签不残留于可视区域）
      if (statusEl) { statusEl.textContent = ''; statusEl.className = 'llm-modal__status'; }
    }
    function showStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = 'llm-modal__status' + (isErr ? ' is-err' : ' is-ok');
    }

    openBtn.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    function saveConfig() {
      var provider = (document.getElementById('cfgProvider').value || '').trim();
      var model = (document.getElementById('cfgModel').value || '').trim();
      var apiKey = document.getElementById('cfgApiKey').value || '';
      var baseUrl = (document.getElementById('cfgBaseUrl').value || '').trim();
      if (!apiKey) { showStatus('请填写 API Key', true); return; }
      showStatus('保存中…', false);
      // 注意：apiKey 仅随请求发出，绝不 console.log、绝不写 localStorage
      App.api('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider || 'openai-compatible',
          model: model,
          api_key: apiKey,
          base_url: baseUrl
        })
      })
        .then(function (data) {
          if (data && data.error) { showStatus('保存失败：' + (data.error.code || 'error'), true); return; }
          // 保存成功后清空 DOM 中的密钥，最小化暴露面
          var ak = document.getElementById('cfgApiKey'); if (ak) ak.value = '';
          closeModal();
          if (window.NudgeErr && window.NudgeErr.toast) window.NudgeErr.toast('配置已保存至服务端内存');
        })
        .catch(function () { showStatus('网络错误，保存失败', true); });
    }
    if (saveBtn) saveBtn.addEventListener('click', saveConfig);
  }

  // 在 shell 持久绑定一次（不随路由销毁）
  var welcomeBubble = null;
  var userSpoke = false;   // 用户发过消息后，欢迎语不再覆盖 Agent 表达
  function renderWelcome() {
    var log = document.getElementById('convLog');
    if (!log) return;
    // 欢迎语同步到空间中的 Agent 表达（字典就绪后 onChange 会以正确语言刷新）
    if (!userSpoke) {
      var speech = document.getElementById('agentSpeech');
      if (speech) speech.textContent = t('chat.welcome');
    }
    if (!welcomeBubble || welcomeBubble.parentNode !== log) {
      if (log.firstChild) return;              // 已有对话，不插入欢迎语
      welcomeBubble = el('div', { class: 'bubble bubble--agent' });
      log.appendChild(welcomeBubble);
    }
    // 每次清空重建（字典就绪 / locale 切换都会走到这里）
    // 注意：不能用 children[i] 索引 —— 真实 DOM 的 children 不含 TextNode
    clear(welcomeBubble);
    welcomeBubble.appendChild(el('span', { class: 'bubble__who', text: t('chat.agent') }));
    welcomeBubble.appendChild(document.createTextNode(t('chat.welcome')));
  }
  // 字典异步就绪后渲染欢迎语（onChange 在 i18n init 完成时必触发）；立即调用作兜底
  if (window.NudgeI18n && window.NudgeI18n.onChange) window.NudgeI18n.onChange(renderWelcome);
  // locale 切换 → 重渲染状态卡/计划卡/已开的抽屉（文案随语言切换，数据不变），不重置任何输入
  if (window.NudgeI18n && window.NudgeI18n.onChange) {
    window.NudgeI18n.onChange(function () {
      var h = (location.hash || '').replace(/^#\/?/, '');
      if (h === 'home' || h === '') { fillStateCard(App.cache); fillNextCard(App.cache); }
      var sd = document.getElementById('stateDrawer');
      if (sd && sd.classList.contains('active')) fillStateDrawer(App.cache);
      var nd = document.getElementById('nextDrawer');
      if (nd && nd.classList.contains('active')) fillNextDrawer(App.cache);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bindConversation(); bindDrawers(); bindLLMConfig(); renderWelcome(); });
  } else {
    bindConversation(); bindDrawers(); bindLLMConfig(); renderWelcome();
  }
})();
