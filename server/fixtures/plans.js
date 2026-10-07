'use strict';

// REFERENCE v1.5 §7 Canonical Plan Object — demo_user_001 基线计划（今天）
// 作为原始计划；后续 Scenario 调整通过 plan_adjustments 记录，不覆盖历史。
module.exports = {
  plan_id: 'plan_001',
  user_id: 'demo_user_001',
  scope: 'TODAY',
  goal: 'strength',
  stimulus: 'lower_body_strength',
  movement: 'squat',
  exercise: 'goblet_squat',
  environment: 'home',
  dose: {
    duration_min: 45,
    sets: 4,
    reps: '8-10',
    intensity: null,
    rest_sec: 90
  },
  constraint: [],
  fidelity: 1.0,
  guidance: 'controlled_tempo'
};
