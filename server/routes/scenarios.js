'use strict';

/**
 * Nudge v1.5 — Phase 5 Scenario run
 * REFERENCE §19 / §21 / §28
 *
 * POST /api/scenarios/run 必须走同一个 Agent Runtime（server/runtime/agentRuntime），
 * 不得在前端或路由层直接构造卡片（规则 #11；禁止 if(scenario==='limited_time'){ card.innerText=... }）。
 *
 * 同一 fixture + 同一输入 = 同一 decision（确定性，无 Math.random）。
 */

const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const { errorShape } = require('./common');
const agentRuntime = require('../runtime/agentRuntime');
const SCENARIOS = require('../fixtures/scenarios');

// GET /api/scenarios —— 返回 Canonical 场景元信息（REFERENCE §21）
router.get('/api/scenarios', (req, res) => {
  res.json({ scenarios: SCENARIOS.publicScenarioList() });
});

// POST /api/scenarios/run —— 通过同一 Runtime 执行指定场景
router.post('/api/scenarios/run', (req, res) => {
  const { scenario_id } = req.body || {};
  const sc = SCENARIOS.getScenario(scenario_id);
  if (!sc) {
    return res.status(404).json(errorShape('NOT_FOUND', 'errors.notFound', false, { scenario_id }));
  }

  // 走同一个 Agent Runtime；注入 fixture 的状态上下文 / Canonical 时间戳 / C3 资格
  // 保证确定性：不调用 LLM（DEMO_MODE），不引入任何随机。
  const result = agentRuntime.run(
    { scenario_id: sc.id, message: sc.input, input_id: 'scenario_' + sc.id, is_discovery: !!sc.is_discovery },
    {
      userId: repository.DEMO_USER,
      fixtureState: sc.state_overlay || null,
      scenarioTimestamp: sc.timestamp,
      c3Justified: sc.c3_justified
    }
  );

  const d = result.decision;
  const ctx = result.context;

  // §14 结构化 trace（固定顺序，禁止 CoT）
  const trace = {
    decision: result.reply.text,
    why: ctx.reasons,
    confidence: d.intent.confidence,
    context_used: d.context.used,
    route: ctx.route, // C0→C1→C2（或含 C3 当 justified）
    action: d.action.type,
    policy_scope: d.policy.scope
  };

  res.json({
    scenario_id: sc.id,
    decision: d,
    decision_id: d.decision_id,
    reply: result.reply,
    visible_state: result.state,
    plan: result.plan,
    discovery: result.discovery,
    trace,
    events: result.events,
    writes: d.writes,
    agent_state: result.agent_state
  });
});

module.exports = router;
