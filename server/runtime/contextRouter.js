'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Context Router
 * REFERENCE §11 Context Schema + §44 Routing rules + 硬规则 #3
 *
 * 严格 C0 → C1 → C2 → C3；进入下一层必须有明确理由。
 * 不得无脑加载 Memory / Calendar / Weather / Venue：只加载本层且权限允许的项。
 */

function route({ scenarioId, trigger, intent, permissions, c3Justified }) {
  // C0 永远加载（state_summary / deviation / baseline）
  const used = ['state_summary', 'deviation', 'baseline'];
  const notLoaded = new Set([
    'memory', 'recent_training',
    'calendar', 'location', 'weather', 'maps', 'venue',
    'extended_conversation', 'multiple_tools', 'complex_memory_conflict', 'frontier_llm'
  ]);
  const routeLayers = ['C0'];
  const reasons = { C0: 'always: state + baseline + deviation' };

  const perm = permissions || {};
  const msg = (trigger && trigger.message) || '';

  // C1：仅在调整需要稳定偏好 / 近期训练上下文时加载（不得无脑）
  const wantC1 =
    scenarioId === 'limited_time' ||
    scenarioId === 'complex_context' ||
    scenarioId === 'low_state_but_want' ||
    scenarioId === 'prefer_8pm' ||
    scenarioId === 'squat_rack_free' ||
    (intent && intent.state === 'S2' && /偏好|习惯|一般|通常|确认|以前/.test(msg));
  if (wantC1) {
    routeLayers.push('C1');
    used.push('memory', 'recent_training');
    notLoaded.delete('memory');
    notLoaded.delete('recent_training');
    reasons.C1 = 'adjustment needs stable preference / recent training context';
  }

  // C2：venue / discovery / 多源上下文；仅加载权限允许的工具
  const wantC2 = scenarioId === 'venue_blocked' || scenarioId === 'complex_context' || (trigger && trigger.is_discovery);
  if (wantC2) {
    routeLayers.push('C2');
    reasons.C2 = scenarioId === 'venue_blocked'
      ? 'venue availability check'
      : (trigger && trigger.is_discovery)
        ? 'discovery query (§44)'
        : 'multi-source context';
    if (perm.venue_enabled) { used.push('venue'); notLoaded.delete('venue'); }
    if (perm.calendar_enabled) { used.push('calendar'); notLoaded.delete('calendar'); }
    if (perm.weather_enabled) { used.push('weather'); notLoaded.delete('weather'); }
    if (perm.maps_enabled) { used.push('maps'); notLoaded.delete('maps'); }
    if (perm.location_enabled) { used.push('location'); notLoaded.delete('location'); }
  }

  // C3：仅当显式 justified（模糊 / 冲突 / 高价值决策）时升级。
  // 硬规则 #3 + REFERENCE §21 Scenario D（route 为 C0,C1,C2，不含 C3）。
  // S3 明确拒绝训练时，绝不进入 C3 继续劝说（规则 #5）。
  const wantC3 = !!c3Justified;
  if (wantC3) {
    routeLayers.push('C3');
    used.push('extended_conversation', 'multiple_tools');
    notLoaded.delete('extended_conversation');
    notLoaded.delete('multiple_tools');
    reasons.C3 = 'ambiguous_or_conflicting_high_value_decision';
  }

  return { route: routeLayers, used, not_loaded: Array.from(notLoaded), reasons };
}

module.exports = { route };
