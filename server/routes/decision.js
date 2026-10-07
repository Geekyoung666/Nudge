'use strict';

// REFERENCE §13 Decision Object + §19 decisions/run（Runtime 占位，确定性）
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');

function defaultDecision(tag) {
  return {
    decision_id: 'decision_' + (tag || 'default'),
    timestamp: new Date().toISOString(),
    trigger: { type: 'user_input', source: 'interaction', input_id: 'interaction_runtime' },
    intervention: { worth_processing: true, value: 'high', reason_code: 'user_request' },
    intent: { state: 'S2', confidence: 0.86 },
    context: { used: ['state_summary', 'recent_training'], not_loaded: ['calendar', 'weather', 'venue'] },
    planner: { action: 'replan', goal: 'strength', stimulus: 'lower_body_strength', fidelity: 0.82 },
    policy: { autonomy_level: 'L4', scope: 'TODAY', risk: 'LOW', permission: 'training_adjustment', cooldown: null, long_term_write: 'blocked' },
    action: { type: 'REPLAN', scope: 'TODAY' },
    writes: { state: true, plan_adjustment: true, memory: false, venue: false }
  };
}

router.get('/api/decision/latest', (req, res) => {
  repository.ensureDemoData();
  const latest = repository.getLatestDecision(repository.DEMO_USER);
  if (latest && latest.payload) {
    return res.json({ decision: latest.payload, decision_id: latest.decision_id, timestamp: latest.created_at });
  }
  // 无历史时返回确定性默认决策（Runtime 占位）
  res.json({ decision: defaultDecision('default'), decision_id: 'decision_default', timestamp: new Date().toISOString() });
});

router.post('/api/decisions/run', (req, res) => {
  const { message, scenario_id } = req.body || {};
  repository.ensureDemoData();
  const decision = defaultDecision(scenario_id || (message ? 'user_input' : 'idle'));
  repository.insertDecisionEvent({
    id: 'dec_' + Date.now(),
    user_id: repository.DEMO_USER,
    decision_id: decision.decision_id,
    scenario_id: scenario_id || null,
    trigger_type: scenario_id ? 'scenario' : 'user_input',
    context_used_json: decision.context.used,
    context_not_loaded_json: decision.context.not_loaded,
    action: decision.action.type,
    policy_scope: decision.policy.scope,
    result: 'pending_runtime',
    payload_json: decision
  });
  res.json({ decision, reply: { text: '（确定性回复）已收到输入。' }, agent_state: 'THINKING' });
});

module.exports = router;
