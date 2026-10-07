'use strict';

/**
 * Nudge v1.5 — Phase 7 Decision Console（只读 decision_events）
 * REFERENCE §13 / §14 / §26 / §29 / §30
 *
 * 设计约束（Phase 7）：
 *  - Decision Console 只读 decision_events（§26；要求 #4）。本文件不写任何业务逻辑，
 *    仅把已落库的 Decision Object 派生为 7 阶段供前端消费。
 *  - 前端不拼装假 Trace（要求 #2）：所有 stage 由本路由从 decision_events.payload_json 派生，
 *    前端只负责渲染，不得 if(scenario===...) 自建卡片。
 *  - 不展示 Chain-of-Thought（§14 禁止）：只返回结构化摘要
 *    （trigger / state / context / intent / planner / policy / action +
 *     decision / why / confidence / context_used / context_not_loaded / policy_scope）。
 *  - Pulse 与 Console 同一数据源：SSE 流与详情接口都读取同一 decision_events 行，
 *    派生出同一 stages 数组。
 *
 * 不修改任何 Runtime 文件；不引入 Math.random 决定逻辑；不暴露 API Key / stack / CoT。
 */

const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const { errorShape } = require('./common');
const agentRuntime = require('../runtime/agentRuntime');
const SCENARIOS = require('../fixtures/scenarios');

// Canonical Decision Pulse stages（REFERENCE §29）
const STAGES = ['TRIGGER', 'STATE', 'CONTEXT', 'INTENT', 'PLANNER', 'POLICY', 'ACTION'];

// ---------------------------------------------------------------------------
// 从 decision_events.payload_json 派生 7 阶段（Pulse 与 Console 共用同一函数）
// ---------------------------------------------------------------------------
function deriveStages(d) {
  if (!d || typeof d !== 'object') return [];
  const stages = [];

  // 1) TRIGGER（§13 trigger + intervention）
  stages.push({
    stage: 'TRIGGER',
    status: 'completed',
    summary: (d.trigger && d.trigger.type) || 'user_input',
    detail: {
      type: d.trigger && d.trigger.type,
      source: d.trigger && d.trigger.source,
      input_id: d.trigger && d.trigger.input_id,
      worth_processing: d.intervention && d.intervention.worth_processing,
      value: d.intervention && d.intervention.value,
      reason_code: d.intervention && d.intervention.reason_code
    }
  });

  // 2) STATE（来自 /run 写入同一行的 state；或仅引用 state_summary）
  const stateEmbedded = d.state || null;
  const stateUsed = !!(d.context && Array.isArray(d.context.used) && d.context.used.includes('state_summary'));
  stages.push({
    stage: 'STATE',
    status: stateUsed ? 'completed' : 'skipped',
    summary: stateUsed ? 'state_evaluated' : 'state_not_loaded',
    detail: stateEmbedded
      ? { fields: stateEmbedded, used: stateUsed }
      : { note: 'state_summary referenced via context.used', used: stateUsed }
  });

  // 3) CONTEXT（§11 used / not_loaded；reasons 为结构化路由理由，非 CoT）
  stages.push({
    stage: 'CONTEXT',
    status: 'completed',
    summary: 'layers:' + ((d.context && d.context.used) || []).join(','),
    detail: {
      used: (d.context && d.context.used) || [],
      not_loaded: (d.context && d.context.not_loaded) || [],
      reasons: d.reasons || null
    }
  });

  // 4) INTENT（§4 S1/S2/S3 + confidence）
  stages.push({
    stage: 'INTENT',
    status: 'completed',
    summary: (d.intent && d.intent.state) || 'S1',
    detail: {
      state: d.intent && d.intent.state,
      confidence: d.intent && d.intent.confidence
    }
  });

  // 5) PLANNER（§6 Goal→Stimulus→...→Dose）
  stages.push({
    stage: 'PLANNER',
    status: 'completed',
    summary: (d.planner && d.planner.action) || 'no_op',
    detail: {
      action: d.planner && d.planner.action,
      goal: d.planner && d.planner.goal,
      stimulus: d.planner && d.planner.stimulus,
      fidelity: d.planner && d.planner.fidelity
    }
  });

  // 6) POLICY（§16 autonomy/scope/risk/permission/long_term_write）
  stages.push({
    stage: 'POLICY',
    status: 'completed',
    summary: 'scope:' + ((d.policy && d.policy.scope) || 'TODAY') + ' risk:' + ((d.policy && d.policy.risk) || 'LOW'),
    detail: d.policy || null
  });

  // 7) ACTION（§15 agent action + writes）
  stages.push({
    stage: 'ACTION',
    status: 'completed',
    summary: (d.action && d.action.type) || 'NO_OP',
    detail: {
      type: d.action && d.action.type,
      scope: d.action && d.action.scope,
      writes: d.writes || null
    }
  });

  return stages;
}

// 把 decision_events 行转成 Console 友好结构（只读 payload_json，不拼接任何前端逻辑）
function toConsoleView(row) {
  const raw = row.payload_json ? JSON.parse(row.payload_json) : null;
  if (!raw) return null;
  const stages = deriveStages(raw);
  const decisionText =
    ((raw.planner && raw.planner.action ? String(raw.planner.action).toUpperCase() : 'NO_OP')) +
    ' · ' + ((raw.action && raw.action.scope) || 'TODAY');
  return {
    decision_id: row.decision_id,
    event_id: row.id,
    scenario_id: row.scenario_id,
    created_at: row.created_at,
    action: row.action,
    policy_scope: row.policy_scope,
    result: row.result,
    // §14 结构化 Decision Trace 摘要（允许显示字段）
    trace: {
      decision: decisionText,
      why: raw.reasons || { note: raw.intervention && raw.intervention.reason_code },
      confidence: raw.intent && raw.intent.confidence,
      context_used: raw.context && raw.context.used,
      context_not_loaded: raw.context && raw.context.not_loaded,
      action: raw.action && raw.action.type,
      policy_scope: raw.policy && raw.policy.scope
    },
    decision_object: raw,
    stages
  };
}

// 只读查询 decision_events（使用导出的 getDb 做 raw 查询，不改动 repository.js）
function queryDecisionEvents(opts) {
  opts = opts || {};
  const db = repository.getDb();
  const where = ['user_id = ?'];
  const params = [repository.DEMO_USER];
  if (opts.decision_id) {
    where.push('decision_id = ?');
    params.push(opts.decision_id);
  }
  const rows = db
    .prepare(
      `SELECT * FROM decision_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(...params, opts.limit || 50);
  return rows;
}

// ---------------------------------------------------------------------------
// POST /api/decisions/run —— 走同一 Agent Runtime（Phase 4）
//   并 enrichment 一行：把 state + reasons 嵌入同一 decision_events 行的 payload_json，
//   供 Console 只读消费（满足「Console 数据必须来自 decision_events」）。
// ---------------------------------------------------------------------------
router.post('/api/decisions/run', (req, res) => {
  const { message, scenario_id } = req.body || {};
  repository.ensureDemoData();

  // 与 scenarios 路由一致：注入 fixture 状态上下文 / Canonical 时间戳 / C3 资格，保证确定性
  let runtimeOpts = { userId: repository.DEMO_USER, visitorId: req.visitorId };
  if (scenario_id) {
    const sc = SCENARIOS.getScenario(scenario_id);
    if (sc) {
      runtimeOpts = {
        userId: repository.DEMO_USER,
        visitorId: req.visitorId,
        fixtureState: sc.state_overlay || null,
        scenarioTimestamp: sc.timestamp,
        c3Justified: sc.c3_justified
      };
    }
  }

  const result = agentRuntime.run(
    { message, scenario_id },
    runtimeOpts
  );

  // enrichment：state + reasons 写入同一 decision_events 行（不新增数据来源，仍是 decision_events）
  const evId = result.events && result.events.decision_event_id;
  if (evId) {
    const row = repository.getDb().prepare('SELECT payload_json FROM decision_events WHERE id = ?').get(evId);
    if (row) {
      try {
        const payload = JSON.parse(row.payload_json || '{}');
        if (result.state) payload.state = result.state;
        if (result.context && result.context.reasons) payload.reasons = result.context.reasons;
        repository.getDb()
          .prepare('UPDATE decision_events SET payload_json = ? WHERE id = ?')
          .run(JSON.stringify(payload), evId);
      } catch (_) {
        // 容错：enrichment 失败不影响主链返回
      }
    }
  }

  res.json({
    decision_id: result.decision.decision_id,
    decision: result.decision,
    reply: result.reply,
    agent_state: result.agent_state,
    events: result.events,
    state: result.state,
    context: result.context,
    writes: result.decision.writes
  });
});

// ---------------------------------------------------------------------------
// GET /api/decisions —— 历史列表（只读 decision_events）
// ---------------------------------------------------------------------------
router.get('/api/decisions', (req, res) => {
  repository.ensureDemoData();
  const rows = queryDecisionEvents({ limit: 50 });
  const items = rows.map((r) => ({
    decision_id: r.decision_id,
    event_id: r.id,
    scenario_id: r.scenario_id,
    action: r.action,
    policy_scope: r.policy_scope,
    result: r.result,
    created_at: r.created_at
  }));
  res.json({ decisions: items, count: items.length });
});

// ---------------------------------------------------------------------------
// GET /api/decisions/:decision_id/stream —— Decision Pulse SSE（§30）
//   与 Console 同一数据源：读取同一 decision_events 行，派生同一 stages 顺序广播。
// ---------------------------------------------------------------------------
router.get('/api/decisions/:decision_id/stream', (req, res) => {
  repository.ensureDemoData();
  const rows = queryDecisionEvents({ decision_id: req.params.decision_id, limit: 1 });
  if (!rows.length) {
    return res.status(404).json(errorShape('NOT_FOUND', 'errors.notFound', false, { decision_id: req.params.decision_id }));
  }
  const view = toConsoleView(rows[0]);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const stages = view.stages;
  let i = 0;
  const sendNext = () => {
    if (i >= stages.length) {
      res.write('event: decision_complete\n');
      res.write('data: ' + JSON.stringify({ decision_id: view.decision_id, event_id: view.event_id }) + '\n\n');
      return res.end();
    }
    const s = stages[i++];
    res.write('event: trace_stage\n');
    res.write('data: ' + JSON.stringify({ stage: s.stage, status: s.status, summary: s.summary }) + '\n\n');
    // 顺序推进（固定步长，非随机；仅用于 Pulse 动画节奏）
    setTimeout(sendNext, 170);
  };
  sendNext();

  req.on('close', () => {
    try { res.end(); } catch (_) {}
  });
});

// ---------------------------------------------------------------------------
// GET /api/decisions/:decision_id —— 完整 Decision Object + 7 阶段（Console 只读数据源）
// ---------------------------------------------------------------------------
router.get('/api/decisions/:decision_id', (req, res) => {
  repository.ensureDemoData();
  const rows = queryDecisionEvents({ decision_id: req.params.decision_id, limit: 1 });
  if (!rows.length) {
    return res.status(404).json(errorShape('NOT_FOUND', 'errors.notFound', false, { decision_id: req.params.decision_id }));
  }
  const view = toConsoleView(rows[0]);
  if (!view) {
    return res.status(500).json(errorShape('INTERNAL_ERROR', 'errors.internal', true));
  }
  res.json(view);
});

module.exports = router;
