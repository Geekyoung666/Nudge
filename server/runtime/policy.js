'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Policy
 * REFERENCE §16 Policy Schema + 硬规则 #7
 *
 * Policy 决定 Permission / Autonomy / Risk / Scope / Cooldown / Long-term write / Safety boundary。
 * 单次偏差 / 今日调整均不写长期记忆（§29）。
 */

function decidePolicy({ intent, action, permissions, scenarioId }) {
  const perm = permissions || {};
  const autonomyLevel = perm.training_adjustment_autonomy_level || 'L4';

  let scope = 'TODAY';
  let risk = 'LOW';
  let permission = 'training_adjustment';
  let cooldown = null;
  let long_term_write = 'blocked';
  let safety_boundary = 'no_medical_claim';

  if (intent && intent.state === 'S3') {
    // 明确拒绝：停止劝说，不写长期记忆，暂停今日主动干预
    permission = 'intervention_paused';
    cooldown = 'until_next_session';
    long_term_write = 'blocked';
    safety_boundary = 'respect_user_choice_no_persuasion';
  }

  if (action === 'NO_OP') {
    permission = (intent && intent.state === 'S3') ? 'intervention_paused' : 'none';
  } else if (action === 'ASK') {
    permission = 'ask_clarification';
  }

  if (scenarioId === 'limited_time' || scenarioId === 'venue_blocked') {
    // 今日调整，不写长期记忆（§29）
    long_term_write = 'blocked';
  }

  return {
    autonomy_level: autonomyLevel,
    scope,
    risk,
    permission,
    cooldown,
    long_term_write,
    safety_boundary
  };
}

module.exports = { decidePolicy };
