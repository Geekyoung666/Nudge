'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Planner
 * REFERENCE §6 Planner 顺序：Goal → Stimulus → Movement → Exercise → Dose
 * 硬规则 #6
 *
 * 核心 Runtime 不依赖 LLM；生成确定性 Canonical Plan（§28）。
 */

function clone(o) {
  return JSON.parse(JSON.stringify(o || {}));
}

// baseline = 原始计划（plan_001）；从它复制 Goal→Stimulus→Movement→Exercise→Dose 骨架
function buildPlan(baseline, scenarioId, intent) {
  const plan = {
    goal: baseline.goal,
    stimulus: baseline.stimulus,
    movement: baseline.movement,
    exercise: baseline.exercise,
    environment: baseline.environment,
    dose: clone(baseline.dose),
    constraint: clone(baseline.constraint),
    fidelity: baseline.fidelity,
    guidance: baseline.guidance
  };

  // S3 拒绝训练：不改动计划，NO_OP
  if (intent && intent.state === 'S3') {
    return { plan: baseline, action: 'NO_OP', fidelity: baseline.fidelity, changed: false };
  }

  // 信息复杂 / 冲突：先询问澄清，不直接改计划
  if (scenarioId === 'complex_context') {
    return { plan: baseline, action: 'ASK', fidelity: baseline.fidelity, changed: false };
  }

  if (scenarioId === 'low_state_but_want') {
    // 状态差但想练 → 保守恢复训练（静默重排），低强度、短时长
    plan.stimulus = 'recovery';
    plan.dose = { duration_min: 20, sets: 2, reps: '12-15', intensity: 3, rest_sec: 90 };
    plan.constraint = ['low_state'];
    plan.fidelity = 0.70;
    plan.guidance = 'gentle_recovery';
    return { plan, action: 'SILENT_REPLAN', fidelity: plan.fidelity, changed: true };
  }

  if (scenarioId === 'squat_rack_free') {
    // 深蹲架空出 → 恢复杠铃深蹲（原计划动作），保真度提升
    plan.movement = 'squat';
    plan.exercise = 'barbell_back_squat';
    plan.environment = 'gym';
    plan.dose = { duration_min: 45, sets: 4, reps: '8-10', intensity: 6, rest_sec: 90 };
    plan.constraint = ['rack_available'];
    plan.fidelity = 0.92;
    plan.guidance = 'controlled_tempo';
    return { plan, action: 'REPLAN', fidelity: plan.fidelity, changed: true };
  }

  if (scenarioId === 'limited_time') {
    // 保留刺激，压缩剂量到 ~20 分钟
    plan.dose = { duration_min: 20, sets: 3, reps: '10-12', intensity: null, rest_sec: 60 };
    plan.constraint = ['limited_time'];
    plan.fidelity = 0.82;
    plan.guidance = 'controlled_tempo';
    return { plan, action: 'REPLAN', fidelity: plan.fidelity, changed: true };
  }

  if (scenarioId === 'venue_blocked') {
    // 深蹲架被占（exists=true, availability=occupied）→ 等效替代，仍保留 lower_body_strength
    plan.movement = 'squat';
    plan.exercise = 'dumbbell_goblet_squat';
    plan.environment = 'home';
    plan.dose = { duration_min: 30, sets: 3, reps: '10-12', intensity: null, rest_sec: 75 };
    plan.constraint = ['venue_blocked'];
    plan.fidelity = 0.78;
    plan.guidance = 'controlled_tempo';
    return { plan, action: 'SUBSTITUTE', fidelity: plan.fidelity, changed: true };
  }

  // 默认：无显著偏差，保持计划
  return { plan: baseline, action: 'NO_OP', fidelity: baseline.fidelity, changed: false };
}

module.exports = { buildPlan, clone };
