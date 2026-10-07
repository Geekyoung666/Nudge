'use strict';

/**
 * Nudge v1.5 — Phase 2 data layer
 *
 * - 使用 Node 内置 node:sqlite（Node 22.5+，零原生依赖，生成标准 SQLite 文件）
 * - 字段与 REFERENCE Canonical Schema 对齐
 * - 所有写操作幂等（固定 ID + INSERT OR IGNORE），可重复 seed
 * - API Key 不入此层；仅预算/用量表，不存密钥
 *
 * 说明：本沙箱下 better-sqlite3 预编译包错误拉取了 darwin-arm64 二进制导致段错误，
 * 故采用内置 node:sqlite。运行环境需 Node 22.5+（验证环境 Node 22.13.1）。
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.NUDGE_DB || path.resolve(__dirname, '..', '..', 'nudge.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Canonical 匿名 demo 用户（无 PII，约束 #3）
const DEMO_USER = 'demo_user_001';

let db = null;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

// 创建表（幂等）。server 启动与 seed 都调用。
function initializeDatabase() {
  const database = getDb();
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  database.exec(sql);
  // Phase 6：memory_items 增加 pending_confirmation 状态列（幂等迁移；不改动 Canonical schema.sql）
  addMemoryStatusColumn(database);
  return database;
}

// 幂等迁移：为 memory_items 增加 status 列（active / pending_confirmation）。
// 已有行自动获得默认值 'active'，新写入由 insertMemory 显式指定。
function addMemoryStatusColumn(database) {
  const db = database || getDb();
  const cols = db.prepare(`PRAGMA table_info(memory_items)`).all().map((r) => r.name);
  if (!cols.includes('status')) {
    db.exec(`ALTER TABLE memory_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
function ensureUser(userId, identityType = 'demo') {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, identity_type, created_at) VALUES (?, ?, ?)`
    )
    .run(userId, identityType, nowIso());
  return getUser(userId);
}

function getUser(userId) {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
}

// ---------------------------------------------------------------------------
// state_snapshots
// ---------------------------------------------------------------------------
function upsertStateSnapshot(snapshot) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO state_snapshots (id, user_id, snapshot_at, source, payload_json)
       VALUES (@id, @user_id, @snapshot_at, @source, @payload_json)`
    )
    .run({
      id: snapshot.id,
      user_id: snapshot.user_id,
      snapshot_at: snapshot.snapshot_at,
      source: snapshot.source || 'demo_fixture',
      payload_json: JSON.stringify(snapshot.state)
    });
  return getLatestState(snapshot.user_id);
}

function getLatestState(userId) {
  const row = getDb()
    .prepare(`SELECT * FROM state_snapshots WHERE user_id = ? ORDER BY snapshot_at DESC LIMIT 1`)
    .get(userId);
  if (!row) return null;
  return { ...row, state: JSON.parse(row.payload_json) };
}

// ---------------------------------------------------------------------------
// goals
// ---------------------------------------------------------------------------
function ensureGoal(goal) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO goals (id, user_id, goal, description, created_at)
       VALUES (@id, @user_id, @goal, @description, @created_at)`
    )
    .run({
      id: goal.id,
      user_id: goal.user_id,
      goal: goal.goal,
      description: goal.description || null,
      created_at: nowIso()
    });
  return getDb().prepare(`SELECT * FROM goals WHERE id = ?`).get(goal.id);
}

// ---------------------------------------------------------------------------
// training_plans
// ---------------------------------------------------------------------------
function upsertPlan(plan) {
  const dbx = getDb();
  const ts = nowIso();
  dbx.prepare(
    `INSERT OR IGNORE INTO training_plans
       (plan_id, user_id, scope, goal, stimulus, movement, exercise, environment,
        dose_json, constraint_json, fidelity, guidance, created_at, updated_at)
     VALUES
       (@plan_id, @user_id, @scope, @goal, @stimulus, @movement, @exercise, @environment,
        @dose_json, @constraint_json, @fidelity, @guidance, @created_at, @updated_at)`
  ).run({
    plan_id: plan.plan_id,
    user_id: plan.user_id,
    scope: plan.scope,
    goal: plan.goal || null,
    stimulus: plan.stimulus || null,
    movement: plan.movement || null,
    exercise: plan.exercise || null,
    environment: plan.environment || null,
    dose_json: JSON.stringify(plan.dose || {}),
    constraint_json: JSON.stringify(plan.constraint || []),
    fidelity: plan.fidelity != null ? plan.fidelity : null,
    guidance: plan.guidance || null,
    created_at: ts,
    updated_at: ts
  });
  return getActivePlan(plan.user_id);
}

function getActivePlan(userId) {
  const row = getDb()
    .prepare(`SELECT * FROM training_plans WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(userId);
  if (!row) return null;
  return rowToPlan(row);
}

function getPlan(planId) {
  const row = getDb().prepare(`SELECT * FROM training_plans WHERE plan_id = ?`).get(planId);
  return row ? rowToPlan(row) : null;
}

function rowToPlan(row) {
  return {
    ...row,
    dose: JSON.parse(row.dose_json || '{}'),
    constraint: JSON.parse(row.constraint_json || '[]')
  };
}

// §29 每次变更生成 plan_adjustment，不覆盖历史
function insertPlanAdjustment(adjustment) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO plan_adjustments
         (plan_adjustment_id, previous_plan_id, new_plan_id, decision_id, scenario_id,
          scope, reason_code, payload_json, created_at)
       VALUES
         (@plan_adjustment_id, @previous_plan_id, @new_plan_id, @decision_id, @scenario_id,
          @scope, @reason_code, @payload_json, @created_at)`
    )
    .run({
      plan_adjustment_id: adjustment.plan_adjustment_id,
      previous_plan_id: adjustment.previous_plan_id || null,
      new_plan_id: adjustment.new_plan_id,
      decision_id: adjustment.decision_id || null,
      scenario_id: adjustment.scenario_id || null,
      scope: adjustment.scope || null,
      reason_code: adjustment.reason_code || null,
      payload_json: adjustment.payload_json ? JSON.stringify(adjustment.payload_json) : null,
      created_at: nowIso()
    });
  return getDb()
    .prepare(`SELECT * FROM plan_adjustments WHERE plan_adjustment_id = ?`)
    .get(adjustment.plan_adjustment_id);
}

function listPlanAdjustments(userId) {
  return getDb()
    .prepare(
      `SELECT pa.* FROM plan_adjustments pa
       JOIN training_plans tp ON tp.plan_id = pa.new_plan_id
       WHERE tp.user_id = ? ORDER BY pa.created_at DESC`
    )
    .all(userId);
}

// ---------------------------------------------------------------------------
// memory_items
// ---------------------------------------------------------------------------
function insertMemory(item) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO memory_items
         (memory_id, user_id, type, key, value, source, confidence, status, created_at, updated_at)
       VALUES (@memory_id, @user_id, @type, @key, @value, @source, @confidence, @status, @created_at, @updated_at)`
    )
    .run({
      memory_id: item.memory_id,
      user_id: item.user_id,
      type: item.type,
      key: item.key,
      value: item.value != null ? String(item.value) : null,
      source: item.source || null,
      confidence: item.confidence != null ? item.confidence : null,
      status: item.status || 'active',
      created_at: nowIso(),
      updated_at: nowIso()
    });
  return getMemory(item.memory_id);
}

function getMemory(memoryId) {
  return getDb().prepare(`SELECT * FROM memory_items WHERE memory_id = ?`).get(memoryId);
}

// 长期记忆确认：仅 pending_confirmation -> active；可附带来源 / 置信度提升。
function updateMemoryStatus(memoryId, status, extra) {
  const sets = ['status = ?', 'updated_at = ?'];
  const vals = [status, nowIso()];
  if (extra) {
    if (extra.source !== undefined) { sets.push('source = ?'); vals.push(extra.source); }
    if (extra.confidence !== undefined) { sets.push('confidence = ?'); vals.push(extra.confidence); }
  }
  vals.push(memoryId);
  getDb()
    .prepare(`UPDATE memory_items SET ${sets.join(', ')} WHERE memory_id = ?`)
    .run(...vals);
  return getMemory(memoryId);
}

function listPendingMemories(userId) {
  return getDb()
    .prepare(`SELECT * FROM memory_items WHERE user_id = ? AND status = 'pending_confirmation' ORDER BY created_at ASC`)
    .all(userId);
}

function listMemory(userId) {
  return getDb()
    .prepare(`SELECT * FROM memory_items WHERE user_id = ? ORDER BY created_at ASC`)
    .all(userId);
}

// ---------------------------------------------------------------------------
// venues / venue_observations
// ---------------------------------------------------------------------------
function upsertVenue(venue) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO venues
         (venue_id, name, location, facilities_json, availability_json, evidence_json, confidence, created_at)
       VALUES (@venue_id, @name, @location, @facilities_json, @availability_json, @evidence_json, @confidence, @created_at)`
    )
    .run({
      venue_id: venue.venue_id,
      name: venue.name,
      location: venue.location || null,
      facilities_json: JSON.stringify(venue.facilities || []),
      availability_json: JSON.stringify(venue.availability || []),
      evidence_json: JSON.stringify(venue.evidence || []),
      confidence: venue.confidence != null ? venue.confidence : null,
      created_at: nowIso()
    });
  return getVenue(venue.venue_id);
}

function getVenue(venueId) {
  const row = getDb().prepare(`SELECT * FROM venues WHERE venue_id = ?`).get(venueId);
  if (!row) return null;
  return {
    ...row,
    facilities: JSON.parse(row.facilities_json || '[]'),
    availability: JSON.parse(row.availability_json || '[]'),
    evidence: JSON.parse(row.evidence_json || '[]')
  };
}

// §10 单次反馈只写 availability，绝不改写 facilities.exists
function insertVenueObservation(obs) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO venue_observations
         (id, venue_id, facility, status, observed_at, source, confidence, created_at)
       VALUES (@id, @venue_id, @facility, @status, @observed_at, @source, @confidence, @created_at)`
    )
    .run({
      id: obs.id,
      venue_id: obs.venue_id,
      facility: obs.facility,
      status: obs.status,
      observed_at: obs.observed_at,
      source: obs.source || null,
      confidence: obs.confidence != null ? obs.confidence : null,
      created_at: nowIso()
    });
  return getDb().prepare(`SELECT * FROM venue_observations WHERE id = ?`).get(obs.id);
}

function listVenueObservations(venueId) {
  return getDb()
    .prepare(`SELECT * FROM venue_observations WHERE venue_id = ? ORDER BY observed_at DESC`)
    .all(venueId);
}

// ---------------------------------------------------------------------------
// permissions / settings
// ---------------------------------------------------------------------------
function ensurePermissions(userId) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO permissions (user_id) VALUES (?)`
    )
    .run(userId);
  return getPermissions(userId);
}

function getPermissions(userId) {
  return getDb().prepare(`SELECT * FROM permissions WHERE user_id = ?`).get(userId);
}

function ensureSettings(userId) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO settings (user_id) VALUES (?)`
    )
    .run(userId);
  return getSettings(userId);
}

function getSettings(userId) {
  return getDb().prepare(`SELECT * FROM settings WHERE user_id = ?`).get(userId);
}

// ---------------------------------------------------------------------------
// LLM budget（§33-35）。仅预算/用量，不存 API Key。
// ---------------------------------------------------------------------------
function ensureBudget(visitorId, budgetRmb = 0.20) {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO llm_visitor_budgets
         (visitor_id, budget_rmb, reserved_rmb, spent_rmb, remaining_rmb, hard_stop, created_at, updated_at)
       VALUES (@visitor_id, @budget_rmb, 0.0, 0.0, @budget_rmb, 0, @created_at, @updated_at)`
    )
    .run({ visitor_id: visitorId, budget_rmb: budgetRmb, created_at: now, updated_at: now });
  return getBudget(visitorId);
}

function getBudget(visitorId) {
  return getDb()
    .prepare(`SELECT * FROM llm_visitor_budgets WHERE visitor_id = ?`)
    .get(visitorId);
}

function insertUsageRecord(record) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO llm_usage_records
         (id, visitor_id, provider, model, estimated_cost_rmb, actual_cost_rmb,
          input_tokens, output_tokens, status, created_at)
       VALUES (@id, @visitor_id, @provider, @model, @estimated_cost_rmb, @actual_cost_rmb,
               @input_tokens, @output_tokens, @status, @created_at)`
    )
    .run({
      id: record.id,
      visitor_id: record.visitor_id,
      provider: record.provider || null,
      model: record.model || null,
      estimated_cost_rmb: record.estimated_cost_rmb != null ? record.estimated_cost_rmb : null,
      actual_cost_rmb: record.actual_cost_rmb != null ? record.actual_cost_rmb : null,
      input_tokens: record.input_tokens != null ? record.input_tokens : null,
      output_tokens: record.output_tokens != null ? record.output_tokens : null,
      status: record.status,
      created_at: nowIso()
    });
  return getDb().prepare(`SELECT * FROM llm_usage_records WHERE id = ?`).get(record.id);
}

// ---------------------------------------------------------------------------
// Phase 3 supplements：demo 数据保障 + settings/permissions 更新 + 事件写入 + 预算闸门
// ---------------------------------------------------------------------------

// 保障 demo 数据存在（幂等；不覆盖 Phase 2 seed 已写入内容）
function ensureDemoData() {
  ensureUser(DEMO_USER, 'demo');
  ensurePermissions(DEMO_USER);
  ensureSettings(DEMO_USER);
  if (!getPlan('plan_001')) upsertPlan(require('../fixtures/plans'));
  if (!getLatestState(DEMO_USER)) upsertStateSnapshot(require('../fixtures/states'));
  // 按 memory_id 幂等写入（INSERT OR IGNORE），确保 mem_pending_001 在既有 mem_001 上也能补齐
  require('../fixtures/memory').forEach((m) => insertMemory(m));
  if (!getVenue('gym_001')) upsertVenue(require('../fixtures/venues'));
  return true;
}

const SETTINGS_FIELDS = {
  locale: 'string',
  active_intervention_enabled: 'bool',
  max_daily_interventions: 'int',
  voice_input_enabled: 'bool'
};

function updateSettings(userId, patch) {
  const sets = [];
  const vals = [];
  for (const [k, t] of Object.entries(SETTINGS_FIELDS)) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (t === 'bool') v = v ? 1 : 0;
    else if (t === 'int') v = Number(v) || 0;
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length) {
    vals.push(userId);
    getDb().prepare(`UPDATE settings SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
  }
  return getSettings(userId);
}

const PERM_FIELDS = {
  training_adjustment_enabled: 'bool',
  training_adjustment_autonomy_level: 'string',
  active_intervention_enabled: 'bool',
  active_intervention_max_per_day: 'int',
  calendar_enabled: 'bool',
  location_enabled: 'bool',
  weather_enabled: 'bool',
  maps_enabled: 'bool',
  venue_enabled: 'bool'
};

function updatePermissions(userId, patch) {
  const flat = {};
  const setBool = (k, v) => { flat[k] = v ? 1 : 0; };
  const setInt = (k, v) => { flat[k] = Number(v) || 0; };

  // Canonical 嵌套结构（REFERENCE §17）
  if (patch.training_adjustment) {
    if (patch.training_adjustment.enabled !== undefined) setBool('training_adjustment_enabled', patch.training_adjustment.enabled);
    if (patch.training_adjustment.autonomy_level !== undefined) flat.training_adjustment_autonomy_level = String(patch.training_adjustment.autonomy_level);
  }
  if (patch.active_intervention) {
    if (patch.active_intervention.enabled !== undefined) setBool('active_intervention_enabled', patch.active_intervention.enabled);
    if (patch.active_intervention.max_per_day !== undefined) setInt('active_intervention_max_per_day', patch.active_intervention.max_per_day);
  }
  for (const k of ['calendar', 'location', 'weather', 'maps', 'venue']) {
    if (patch[k] && patch[k].enabled !== undefined) setBool(k + '_enabled', patch[k].enabled);
  }

  // 扁平别名（向后兼容）
  if (patch.training_adjustment_enabled !== undefined) setBool('training_adjustment_enabled', patch.training_adjustment_enabled);
  if (patch.training_adjustment_autonomy_level !== undefined) flat.training_adjustment_autonomy_level = String(patch.training_adjustment_autonomy_level);
  if (patch.active_intervention_enabled !== undefined) setBool('active_intervention_enabled', patch.active_intervention_enabled);
  if (patch.active_intervention_max_per_day !== undefined) setInt('active_intervention_max_per_day', patch.active_intervention_max_per_day);
  for (const k of ['calendar', 'location', 'weather', 'maps', 'venue']) {
    if (patch[k + '_enabled'] !== undefined) setBool(k + '_enabled', patch[k + '_enabled']);
  }

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(flat)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length) {
    vals.push(userId);
    getDb().prepare(`UPDATE permissions SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
  }
  return getPermissions(userId);
}

function insertInteractionEvent(ev) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO interaction_events (id, user_id, created_at, type, payload_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ev.id, ev.user_id, ev.created_at || nowIso(), ev.type, ev.payload_json ? JSON.stringify(ev.payload_json) : null);
  return getDb().prepare(`SELECT * FROM interaction_events WHERE id = ?`).get(ev.id);
}

function insertDecisionEvent(ev) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO decision_events
         (id, user_id, decision_id, scenario_id, created_at, trigger_type,
          context_used_json, context_not_loaded_json, action, policy_scope, result, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ev.id,
      ev.user_id,
      ev.decision_id || null,
      ev.scenario_id || null,
      ev.created_at || nowIso(),
      ev.trigger_type || null,
      ev.context_used_json ? JSON.stringify(ev.context_used_json) : null,
      ev.context_not_loaded_json ? JSON.stringify(ev.context_not_loaded_json) : null,
      ev.action || null,
      ev.policy_scope || null,
      ev.result || null,
      ev.payload_json ? JSON.stringify(ev.payload_json) : null
    );
  return getDb().prepare(`SELECT * FROM decision_events WHERE id = ?`).get(ev.id);
}

function getLatestDecision(userId) {
  const row = getDb()
    .prepare(`SELECT * FROM decision_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(userId);
  if (!row) return null;
  return { ...row, payload: row.payload_json ? JSON.parse(row.payload_json) : null };
}

// §46 严格预算闸门：reserve / release / reconcile（不依赖第三方估算器，上限可解释）
function round2(x) {
  // 微精度（6 位小数），避免 sub-cent 预算被四舍五入归零
  return Math.round((Number(x) + Number.EPSILON) * 1e6) / 1e6;
}

function reserveBudget(visitorId, amt) {
  const b = getBudget(visitorId) || ensureBudget(visitorId, 0.2);
  const reserved = round2(b.reserved_rmb + amt);
  const remaining = round2(b.budget_rmb - b.spent_rmb - reserved);
  getDb()
    .prepare(`UPDATE llm_visitor_budgets SET reserved_rmb = ?, remaining_rmb = ?, updated_at = ? WHERE visitor_id = ?`)
    .run(reserved, remaining, nowIso(), visitorId);
  return getBudget(visitorId);
}

function releaseBudget(visitorId, amt) {
  const b = getBudget(visitorId) || ensureBudget(visitorId, 0.2);
  const reserved = round2(Math.max(0, b.reserved_rmb - amt));
  const remaining = round2(b.budget_rmb - b.spent_rmb - reserved);
  getDb()
    .prepare(`UPDATE llm_visitor_budgets SET reserved_rmb = ?, remaining_rmb = ?, updated_at = ? WHERE visitor_id = ?`)
    .run(reserved, remaining, nowIso(), visitorId);
  return getBudget(visitorId);
}

function reconcileBudget(visitorId, reservedAmt, actualCost, inputTokens, outputTokens) {
  const b = getBudget(visitorId) || ensureBudget(visitorId, 0.2);
  const spent = round2(b.spent_rmb + actualCost);
  const reserved = round2(Math.max(0, b.reserved_rmb - reservedAmt));
  const remaining = round2(b.budget_rmb - spent - reserved);
  getDb()
    .prepare(`UPDATE llm_visitor_budgets SET reserved_rmb = ?, spent_rmb = ?, remaining_rmb = ?, updated_at = ? WHERE visitor_id = ?`)
    .run(reserved, spent, remaining, nowIso(), visitorId);
  return getBudget(visitorId);
}

function setHardStop(visitorId, val) {
  getDb()
    .prepare(`UPDATE llm_visitor_budgets SET hard_stop = ?, updated_at = ? WHERE visitor_id = ?`)
    .run(val ? 1 : 0, nowIso(), visitorId);
  return getBudget(visitorId);
}

module.exports = {
  DB_PATH,
  DEMO_USER,
  getDb,
  initializeDatabase,
  ensureDemoData,
  // users
  ensureUser,
  getUser,
  // state
  upsertStateSnapshot,
  getLatestState,
  // goals
  ensureGoal,
  // plans
  upsertPlan,
  getActivePlan,
  getPlan,
  insertPlanAdjustment,
  listPlanAdjustments,
  // memory
  insertMemory,
  getMemory,
  updateMemoryStatus,
  listPendingMemories,
  listMemory,
  // venues
  upsertVenue,
  getVenue,
  insertVenueObservation,
  listVenueObservations,
  // permissions / settings
  ensurePermissions,
  getPermissions,
  ensureSettings,
  getSettings,
  // settings / permissions 更新
  updateSettings,
  updatePermissions,
  // 事件写入
  insertInteractionEvent,
  insertDecisionEvent,
  getLatestDecision,
  // llm budget + 闸门
  ensureBudget,
  getBudget,
  insertUsageRecord,
  reserveBudget,
  releaseBudget,
  reconcileBudget,
  setHardStop
};
