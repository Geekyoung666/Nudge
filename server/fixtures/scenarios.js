'use strict';

/**
 * Nudge v1.5 — Phase 5 Scenario Fixtures (REFERENCE §21 Canonical Source)
 *
 * 四场景的唯一 Canonical 定义。运行时（server/runtime/agentRuntime）全部读取本文件，
 * 保证「same fixture + same normalized input = same decision」(§28，无 Math.random)。
 *
 * 每个场景携带：
 *  - input            ：驱动 Runtime 的规范化输入文本
 *  - intent/route/...  ：REFERENCE §21 规定的期望（用于文档与回归核对，不是决策逻辑）
 *  - state_overlay    ：complex_context 注入 Runtime 的状态上下文（确定性）
 *  - timestamp         ：场景的 Canonical 时间戳（保证 decision 字节级确定性）
 *  - c3_justified      ：是否允许进入 C3（硬规则 #3：C3 仅在 justified 时进入）
 */

// D complex_context 的条件（Phase 5 指定）：
// sleep low / fatigue high / overtime / weather change / route change / venue uncertainty
const COMPLEX_STATE = {
  sleep: { value: 4.6, unit_or_scale: 'h', trend: 'down', source: 'demo_fixture', observed_at: '2026-10-02T08:00:00+08:00', freshness: 'SAME_DAY', confidence: 0.95 },
  fatigue: { value: 8, unit_or_scale: '10', trend: 'up', source: 'user_report', observed_at: '2026-10-02T17:50:00+08:00', freshness: 'CURRENT', confidence: 0.90 },
  sedentary: { value: 9, unit_or_scale: 'h', trend: 'up', source: 'demo_fixture', observed_at: '2026-10-02T17:30:00+08:00', freshness: 'SAME_DAY', confidence: 0.90 },
  leg_soreness: { value: 6, unit_or_scale: '10', trend: 'stable', source: 'demo_fixture', observed_at: '2026-10-02T17:45:00+08:00', freshness: 'CURRENT', confidence: 0.86 },
  overtime: { value: true, unit_or_scale: 'bool', trend: 'up', source: 'demo_fixture', observed_at: '2026-10-02T19:00:00+08:00', freshness: 'CURRENT', confidence: 0.92 },
  weather: { value: 'rain', unit_or_scale: 'categorical', trend: 'changed', source: 'demo_fixture', observed_at: '2026-10-02T18:00:00+08:00', freshness: 'CURRENT', confidence: 0.85 },
  route: { value: 'changed', unit_or_scale: 'categorical', trend: 'changed', source: 'demo_fixture', observed_at: '2026-10-02T18:10:00+08:00', freshness: 'CURRENT', confidence: 0.85 },
  venue_uncertainty: { value: true, unit_or_scale: 'bool', trend: 'up', source: 'demo_fixture', observed_at: '2026-10-02T18:20:00+08:00', freshness: 'CURRENT', confidence: 0.80 }
};

const SCENARIOS = [
  {
    id: 'limited_time',
    input: '我今天只有20分钟',
    intent: 'S2',
    route: ['C0', 'C1'],
    action: 'REPLAN',
    scope: 'TODAY',
    fidelity: 0.82,
    memory_write: false,
    state_overlay: null,
    timestamp: '2026-10-02T18:00:00+08:00',
    c3_justified: false,
    expectation: {
      intervention_worth_processing: true,
      goal_unchanged: true,
      stimulus_retained: true,
      dose_reduced: true,
      writes: { state: false, plan_adjustment: true, memory: false, venue: false }
    }
  },
  {
    id: 'venue_blocked',
    input: '深蹲架被占了',
    intent: 'S2',
    route: ['C0', 'C2'],
    action: 'SUBSTITUTE',
    facility_exists: true,
    availability: 'occupied',
    venue_write: true,
    state_overlay: null,
    timestamp: '2026-10-02T18:05:00+08:00',
    c3_justified: false,
    expectation: {
      c2_loaded: true,
      exists_not_availability: true,
      alternative_generated: true,
      fidelity_displayed: true,
      venue_observation_written: true,
      facility_existence_unchanged: true
    }
  },
  {
    id: 'refusal',
    input: '我今天就是不想练',
    intent: 'S3',
    route: ['C0'],
    action: 'NO_OP',
    daily_intervention_off: true,
    memory_write: false,
    deviation_write: true,
    state_overlay: null,
    timestamp: '2026-10-02T18:10:00+08:00',
    c3_justified: false,
    expectation: {
      no_persuasion: true,
      no_follow_up: true,
      daily_intervention_off: true,
      deviation_written: true,
      long_term_plan_unchanged: true
    }
  },
  {
    id: 'complex_context',
    // 条件：加班(overtime) / 下雨(weather change) / 路线变(route change) / 器械不确定(venue uncertainty) / 状态差
    input: '我今天加班到很晚，外面下雨了，路线也变了，健身房器械情况还不确定，状态也不太好',
    intent: 'S2',
    route: ['C0', 'C1', 'C2'],
    action: 'ASK',
    c3_condition: 'ambiguous_or_conflicting_high_value_decision',
    c3_justified: false, // 默认仅 C0→C1→C2；C3 仅在 justified 时进入
    state_overlay: COMPLEX_STATE,
    timestamp: '2026-10-02T18:15:00+08:00',
    expectation: {
      route: ['C0', 'C1', 'C2'],
      c3_only_when_justified: true,
      final_action_unique: true,
      trace_complete: true
    }
  },
  {
    id: 'low_state_but_want',
    input: '我今天状态很差，但还是想练一下',
    intent: 'S2',
    route: ['C0', 'C1'],
    action: 'SILENT_REPLAN',
    scope: 'TODAY',
    fidelity: 0.70,
    memory_write: false,
    state_overlay: {
      sleep: { value: 4.2, unit_or_scale: 'h', trend: 'down', source: 'demo_fixture', observed_at: '2026-10-02T08:00:00+08:00', freshness: 'SAME_DAY', confidence: 0.95 },
      fatigue: { value: 8.5, unit_or_scale: '10', trend: 'up', source: 'user_report', observed_at: '2026-10-02T17:50:00+08:00', freshness: 'CURRENT', confidence: 0.90 },
      sedentary: { value: 9, unit_or_scale: 'h', trend: 'up', source: 'demo_fixture', observed_at: '2026-10-02T17:30:00+08:00', freshness: 'SAME_DAY', confidence: 0.90 },
      leg_soreness: { value: 7, unit_or_scale: '10', trend: 'up', source: 'demo_fixture', observed_at: '2026-10-02T17:45:00+08:00', freshness: 'CURRENT', confidence: 0.86 }
    },
    timestamp: '2026-10-02T18:20:00+08:00',
    c3_justified: false,
    label: '状态差但想练',
    expectation: {
      recovery_session: true,
      low_intensity: true,
      silent_replan: true,
      long_term_plan_unchanged: true
    }
  },
  {
    id: 'find_venue',
    input: '帮我找一下附近能练腿的健身房',
    intent: 'S2',
    route: ['C0', 'C2'],
    action: 'NO_OP',
    scope: 'TODAY',
    fidelity: 0.80,
    memory_write: false,
    is_discovery: true,
    state_overlay: null,
    timestamp: '2026-10-02T18:25:00+08:00',
    c3_justified: false,
    label: '寻找附近场地',
    expectation: {
      venue_discovery_loaded: true,
      discovery_presented: true,
      no_plan_change: true
    }
  },
  {
    id: 'prefer_8pm',
    input: '我以后都想晚上八点练',
    intent: 'S2',
    route: ['C0', 'C1'],
    action: 'NO_OP',
    scope: 'ONGOING',
    fidelity: 0.90,
    memory_write: true,
    long_term_protected: true,
    state_overlay: null,
    timestamp: '2026-10-02T18:30:00+08:00',
    c3_justified: false,
    label: '固定晚八点练',
    expectation: {
      long_term_write_blocked: true,
      policy_guard_shown: true,
      no_persistence_of_preference: true
    }
  },
  {
    id: 'squat_rack_free',
    input: '深蹲架空出来了，可以继续原计划了',
    intent: 'S2',
    route: ['C0', 'C1'],
    action: 'REPLAN',
    scope: 'TODAY',
    fidelity: 0.92,
    memory_write: false,
    state_overlay: null,
    timestamp: '2026-10-02T18:35:00+08:00',
    c3_justified: false,
    label: '深蹲架空出来了',
    expectation: {
      revert_to_barbell_squat: true,
      fidelity_restored: true,
      plan_changed: true
    }
  }
];

function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

// 对外暴露的「场景元信息」（不含 expectation 内部断言块，避免前端误用）
function publicScenarioList() {
  return SCENARIOS.map((s) => ({
    id: s.id,
    input: s.input,
    label: s.label || null,
    intent: s.intent,
    route: s.route,
    action: s.action,
    scope: s.scope || 'TODAY',
    fidelity: s.fidelity || null,
    memory_write: s.memory_write || false,
    c3_justified: s.c3_justified
  }));
}

module.exports = SCENARIOS;
module.exports.getScenario = getScenario;
module.exports.publicScenarioList = publicScenarioList;
module.exports.COMPLEX_STATE = COMPLEX_STATE;
