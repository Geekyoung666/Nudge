'use strict';

/**
 * Nudge v1.5 — Phase 2 seed
 *
 * 运行：node server/db/seed.js
 * 幂等：所有数据使用固定 ID + INSERT OR IGNORE，可重复执行。
 * 仅 seed 匿名 demo_user_001；不采集任何 PII；不配置真实 LLM API Key。
 */

const repository = require('./repository');

const STATE = require('../fixtures/states');
const PLAN = require('../fixtures/plans');
const VENUE = require('../fixtures/venues');
const MEMORY = require('../fixtures/memory');
const LLM_BUDGET = require('../fixtures/llmBudget');

const DEMO_USER = 'demo_user_001';

function seed() {
  repository.initializeDatabase();

  // user
  repository.ensureUser(DEMO_USER, 'demo');

  // state
  repository.upsertStateSnapshot({
    id: STATE.id,
    user_id: STATE.user_id,
    snapshot_at: STATE.snapshot_at,
    source: STATE.source,
    state: STATE.state
  });

  // goal（来自基线计划 goal）
  repository.ensureGoal({
    id: 'goal_001',
    user_id: DEMO_USER,
    goal: PLAN.goal,
    description: 'baseline long-term goal'
  });

  // plan
  repository.upsertPlan(PLAN);

  // memory
  for (const m of MEMORY) {
    repository.insertMemory(m);
  }

  // venue
  repository.upsertVenue(VENUE);

  // permissions / settings
  repository.ensurePermissions(DEMO_USER);
  repository.ensureSettings(DEMO_USER);

  // llm budget
  repository.ensureBudget(DEMO_USER, LLM_BUDGET.budget_rmb);

  // 报告
  const state = repository.getLatestState(DEMO_USER);
  const plan = repository.getActivePlan(DEMO_USER);
  const memory = repository.listMemory(DEMO_USER);
  const permissions = repository.getPermissions(DEMO_USER);
  const settings = repository.getSettings(DEMO_USER);
  const budget = repository.getBudget(DEMO_USER);
  const venue = repository.getVenue(VENUE.venue_id);

  console.log('[seed] demo_user_001 seeded.');
  console.log('  state       :', state ? 'ok (' + Object.keys(state.state).length + ' metrics)' : 'MISSING');
  console.log('  plan        :', plan ? `ok (${plan.plan_id}, scope=${plan.scope})` : 'MISSING');
  console.log('  memory      :', memory.length, 'item(s)');
  console.log('  venue       :', venue ? `${venue.venue_id} exists(squat_rack)=${venue.facilities[0].exists}` : 'MISSING');
  console.log('  permissions :', JSON.stringify(permissions));
  console.log('  settings    :', JSON.stringify(settings));
  console.log('  llm budget  :', JSON.stringify(budget));
}

seed();
