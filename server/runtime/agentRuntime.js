'use strict';

/**
 * Nudge v1.5 — Phase 4 Agent Runtime 主链（Canonical flow）
 *
 * Request → Normalize Input → Load State → Load Baseline/Deviation
 * → Intervention Gate → Intent → Context Router → Planner → Policy
 * → Action → Persistence → Decision Event → Response
 *
 * 硬规则：
 *  - 核心 Runtime 不依赖 LLM（规则 #2）。
 *  - LLM 仅作为 C3 / 高价值生成 / 摘要的可选增强，且必须经过 Budget Guard（规则 #13）。
 *    未配置 / 超预算 → 确定性 fallback，绝不阻断主链。
 *  - 每个 Decision 写入 decision_events（规则 #11）。
 *  - 响应只返回结构化摘要，禁止 Chain-of-Thought（规则 #12）。
 *
 * 同一 Runtime 驱动核心四场景（规则 #11：前端不实现 S1/S2/S3、Fidelity、Memory 写入、
 * Policy、Venue existence 更新）。
 */

const repository = require('../db/repository');
const { llmConfigStore, round2 } = require('../routes/common');

const triggerMod = require('./trigger');
const contextRouter = require('./contextRouter');
const intentMod = require('./intent');
const plannerMod = require('./planner');
const policyMod = require('./policy');
const memoryMod = require('./memory');
const venueMod = require('./venue');
const discoveryMod = require('./discovery');

// 确定性回复（REFERENCE §19 / §21）
const REPLY_MAP = {
  limited_time: '我看到你只剩 20 分钟了。我先尽量保留主要训练刺激。',
  venue_blocked: '深蹲架被占了，我帮你换成等效的下肢动作。',
  refusal: '今天不想练也没关系，我记录下来，不强行干预。',
  complex_context: '情况有点复杂，我帮你把信息理清楚再决定。'
};

// 干预门（Intervention Gate）：C0 能结束就立即 NO_OP（硬规则 #1）
function interventionGate({ trigger }) {
  if (!trigger.message && !trigger.scenario_id) {
    return { worth_processing: false, value: 'low', reason_code: 'empty_input' };
  }
  if (trigger.scenario_id === 'refusal' || /不想练|不练了|今天不练|算了|不想动/.test(trigger.message)) {
    return { worth_processing: false, value: 'low', reason_code: 'user_choice_no_intervention' };
  }
  return { worth_processing: true, value: 'high', reason_code: 'important_deviation' };
}

function planToObject(planRow) {
  if (!planRow) return null;
  return {
    plan_id: planRow.plan_id,
    scope: planRow.scope,
    goal: planRow.goal,
    stimulus: planRow.stimulus,
    movement: planRow.movement,
    exercise: planRow.exercise,
    environment: planRow.environment,
    dose: planRow.dose,
    constraint: planRow.constraint,
    fidelity: planRow.fidelity,
    guidance: planRow.guidance
  };
}

// ---------------------------------------------------------------------------
// 可选 LLM 增强（仅 C3 / 高价值）：必须经过 Budget Guard（规则 #13）
// ---------------------------------------------------------------------------
function maybeEnhanceWithLLM(decision, visitorId) {
  const cfg = llmConfigStore.get(visitorId);
  if (!cfg || !cfg.api_key) {
    return { used: false, reason: 'LLM_NOT_CONFIGURED' };
  }
  const b = repository.getBudget(visitorId) || repository.ensureBudget(visitorId, 0.20);
  const remaining = round2(b.budget_rmb - b.spent_rmb - b.reserved_rmb);
  // 请求级最坏成本（调用前确定，§46）
  const worst = round2(
    ((cfg.max_input_tokens || 0) / 1e6) * (cfg.input_rmb_per_m || 0) +
    ((cfg.max_output_tokens || 0) / 1e6) * (cfg.output_rmb_per_m || 0)
  );
  if (worst > remaining + 1e-9) {
    repository.setHardStop(visitorId, 1);
    return { used: false, reason: 'LLM_BUDGET_EXCEEDED' };
  }
  // reserve → 调用（DEMO 为确定性 mock，不真实联网）→ reconcile
  repository.reserveBudget(visitorId, worst);
  repository.reconcileBudget(visitorId, worst, round2(0), 0, 0);
  return { used: true, reason: 'mock_upstream_demo' };
}

// ---------------------------------------------------------------------------
// Canonical Decision Object（REFERENCE §13）
// ---------------------------------------------------------------------------
function buildDecisionObject({ trigger, gate, intent, ctx, planned, policy, decisionId, timestamp, venue }) {
  const writes = {
    state: false,
    plan_adjustment: !!planned.changed && planned.action !== 'NO_OP',
    memory: false, // 单次偏差 / 今日调整不写长期记忆（规则 #8）
    venue: !!trigger.scenario_id && trigger.scenario_id === 'venue_blocked'
  };
  // Venue Intelligence 事实摘要（REFERENCE §10）：venue 已加载时呈现
  // exists != availability 分离事实——字段沿用 Canonical Venue Schema，不新增业务字段。
  const venueIntelligence = venue ? {
    venue_id: venue.venue_id,
    facilities: (venue.facilities || []).map((f) => ({ name: f.name, exists: !!f.exists })),
    availability: (venue.availability || []).map((a) => ({ name: a.name, status: a.status, observed_at: a.observed_at, source: a.source })),
    rule: 'exists != availability'
  } : null;
  return {
    decision_id: decisionId,
    timestamp: timestamp || new Date().toISOString(),
    trigger: { type: trigger.type, source: trigger.source, input_id: trigger.input_id },
    intervention: {
      worth_processing: gate.worth_processing,
      value: gate.worth_processing ? 'high' : 'low',
      reason_code: gate.reason_code
    },
    intent: { state: intent.state, confidence: intent.confidence },
    context: { used: ctx.used, not_loaded: ctx.not_loaded },
    planner: {
      action: (planned.action || 'NO_OP').toLowerCase(),
      goal: planned.plan.goal,
      stimulus: planned.plan.stimulus,
      fidelity: planned.plan.fidelity
    },
    policy: {
      autonomy_level: policy.autonomy_level,
      scope: policy.scope,
      risk: policy.risk,
      permission: policy.permission,
      cooldown: policy.cooldown,
      long_term_write: policy.long_term_write
    },
    action: { type: planned.action, scope: policy.scope },
    venue_intelligence: venueIntelligence,
    writes
  };
}

// ---------------------------------------------------------------------------
// 主链
// ---------------------------------------------------------------------------
function run(rawInput, { userId, visitorId, fixtureState, scenarioTimestamp, c3Justified } = {}) {
  repository.ensureDemoData();
  const uid = userId || repository.DEMO_USER;
  const vid = visitorId || 'guest_runtime';

  // 1) Normalize Input / Trigger
  const trigger = triggerMod.normalizeInput(rawInput || {});

  // 2) Load State（Scenario fixture 可注入确定性状态上下文，硬覆盖 demo 基线以保证确定性）
  const state = repository.getLatestState(uid);
  const baseState = state ? state.state : null;
  const stateObj = fixtureState ? Object.assign({}, baseState, fixtureState) : baseState;

  // 3) Load Baseline（原始计划 plan_001）/ Deviation
  const baselineRow = repository.getPlan('plan_001') || repository.getActivePlan(uid);
  const baselinePlan = planToObject(baselineRow);

  // 4) Intervention Gate
  const gate = interventionGate({ trigger });

  // 5) Intent（仅 S1/S2/S3）
  const intent = intentMod.classifyIntent({ trigger, state: stateObj, scenarioId: trigger.scenario_id });

  // 6) Context Router（严格 C0→C1→C2→C3，含理由）
  const permissionsRow = repository.getPermissions(uid) || {};
  const ctx = contextRouter.route({ scenarioId: trigger.scenario_id, trigger, intent, permissions: permissionsRow, c3Justified });

  // 按 route 选择性加载（绝不无脑全开，硬规则 #2）
  let memory = [];
  let venue = null;
  let discovery = null;
  if (ctx.used.includes('memory')) memory = repository.listMemory(uid);
  if (ctx.used.includes('venue')) venue = repository.getVenue('gym_001');
  if (trigger.is_discovery) discovery = discoveryMod.searchDiscovery(trigger.message, {});

  // 7) Planner（Goal→Stimulus→Movement→Exercise→Dose）
  const planned = plannerMod.buildPlan(baselinePlan, trigger.scenario_id, intent);

  // 8) Policy（Permission / Autonomy / Risk / Scope / Cooldown / Long-term write / Safety boundary）
  const policy = policyMod.decidePolicy({ intent, action: planned.action, permissions: permissionsRow, scenarioId: trigger.scenario_id });

  // 9) Action + 10) Persistence
  const decisionId = trigger.scenario_id
    ? 'decision_' + trigger.scenario_id
    : 'decision_' + triggerMod.stableHash(trigger.message || 'empty');

  const events = {
    decision_event_id: null,
    plan_adjustment_id: null,
    deviation_id: null,
    venue_observation_id: null
  };

  // Venue Intelligence：venue_blocked 只记录 availability 观察（不改 exists，硬规则 #9）
  if (trigger.scenario_id === 'venue_blocked' && venue) {
    const obs = venueMod.recordAvailabilityObservation('gym_001', 'squat_rack', 'occupied', 'user_report');
    events.venue_observation_id = obs.id;
  }

  // Plan Adjustment（仅当计划变更且非 NO_OP；§29 不覆盖历史）
  let finalPlan = baselinePlan;
  if (planned.changed && planned.action !== 'NO_OP') {
    const newPlanId = 'plan_adj_' + decisionId;
    repository.upsertPlan({
      plan_id: newPlanId,
      user_id: uid,
      scope: 'TODAY',
      goal: planned.plan.goal,
      stimulus: planned.plan.stimulus,
      movement: planned.plan.movement,
      exercise: planned.plan.exercise,
      environment: planned.plan.environment,
      dose: planned.plan.dose,
      constraint: planned.plan.constraint,
      fidelity: planned.plan.fidelity,
      guidance: planned.plan.guidance
    });
    const pa = repository.insertPlanAdjustment({
      plan_adjustment_id: 'pa_' + decisionId,
      previous_plan_id: baselineRow ? baselineRow.plan_id : null,
      new_plan_id: newPlanId,
      decision_id: decisionId,
      scenario_id: trigger.scenario_id || null,
      scope: 'TODAY',
      reason_code: trigger.scenario_id || 'user_adjustment',
      payload_json: planned.plan
    });
    events.plan_adjustment_id = pa.plan_adjustment_id;
    finalPlan = planToObject(repository.getPlan(newPlanId));
  }

  // Deviation（单次偏差，不写长期 Memory；S3 拒绝）
  if (intent.state === 'S3') {
    const dev = memoryMod.insertDeviation(uid, {
      decisionId,
      type: 'single_deviation',
      reason: 'user_refusal',
      payload: { scenario_id: trigger.scenario_id, message: trigger.message, intent: intent.state }
    });
    events.deviation_id = dev.id;
  }

  // 11) Decision Event（每个 Decision 都写入 decision_events，规则 #11）
  const decision = buildDecisionObject({ trigger, gate, intent, ctx, planned, policy, decisionId, timestamp: scenarioTimestamp, venue });
  const decisionEvent = repository.insertDecisionEvent({
    id: 'de_' + decisionId + '_' + Date.now(),
    user_id: uid,
    decision_id: decisionId,
    scenario_id: trigger.scenario_id || null,
    trigger_type: trigger.type,
    context_used_json: ctx.used,
    context_not_loaded_json: ctx.not_loaded,
    action: planned.action,
    policy_scope: policy.scope,
    result: gate.worth_processing ? 'processed' : 'no_op',
    payload_json: decision
  });
  events.decision_event_id = decisionEvent.id;

  // 12) Response（结构化摘要，禁止 CoT）
  const replyText = REPLY_MAP[trigger.scenario_id] ||
    (intent.state === 'S3'
      ? '今天不想练也没关系。'
      : intent.state === 'S2'
        ? '好的，我按你的约束调整一下今天的计划。'
        : '一切正常，按计划进行就好。');

  // 可选 LLM 增强（仅高价值 / C3；未配置或超预算自动 fallback）
  const llm = (planned.action === 'SUBSTITUTE' || planned.action === 'INTERVENE' || ctx.route.includes('C3'))
    ? maybeEnhanceWithLLM(decision, vid)
    : { used: false, reason: 'not_requested' };

  return {
    decision,
    state: stateObj,
    plan: finalPlan,
    reply: { text: replyText },
    agent_state: 'SPEAKING',
    llm_enhancement: llm,
    discovery: discovery || null,
    context: { route: ctx.route, reasons: ctx.reasons, used: ctx.used, not_loaded: ctx.not_loaded },
    events
  };
}

module.exports = { run, buildDecisionObject, interventionGate };
