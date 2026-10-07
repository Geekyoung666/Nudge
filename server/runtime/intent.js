'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Intent
 * REFERENCE §4 Intent enum (S1/S2/S3) + §21 场景意图 + 硬规则 #4/#5
 *
 * Intent 只能是 S1 / S2 / S3。
 * S3 = 明确拒绝训练 → 后续停止劝说，Action = NO_OP。
 */

function classifyIntent({ trigger, state, scenarioId }) {
  if (scenarioId === 'refusal') {
    return { state: 'S3', confidence: 0.95, reason: 'explicit_refusal' };
  }
  if (scenarioId === 'limited_time' || scenarioId === 'venue_blocked') {
    return { state: 'S2', confidence: 0.86, reason: 'constrained_but_willing' };
  }
  if (scenarioId === 'complex_context') {
    return { state: 'S2', confidence: 0.70, reason: 'ambiguous_requires_clarification' };
  }

  const m = (trigger && trigger.message) || '';
  if (/不想练|不练了|今天不练|算了|不想动|摆烂|懒得练/.test(m)) {
    return { state: 'S3', confidence: 0.95, reason: 'explicit_refusal' };
  }
  if (/只有\s*\d+\s*分钟|\d+\s*分钟|时间不够|没时间|被占|没器械|调整|改|换|替代|替换/.test(m)) {
    return { state: 'S2', confidence: 0.86, reason: 'constrained_requires_adjustment' };
  }
  return { state: 'S1', confidence: 0.82, reason: 'no_significant_deviation' };
}

module.exports = { classifyIntent };
