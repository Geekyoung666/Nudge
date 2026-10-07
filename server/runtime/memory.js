'use strict';

/**
 * Nudge v1.5 — Phase 6 Runtime · Memory persistence policy
 * REFERENCE §9 Memory + §16 Policy (long_term_write) + §19 Deviation + 硬规则 #8
 *
 * 核心约束：
 *  - 长期写入受 Policy / Permission 控制（long_term_write = allowed / blocked / confirm_required）。
 *  - 单次偏差只写 deviations，绝不写长期 Memory（规则 #8）。
 *  - 未确认（pending_confirmation）前，不写长期计划、不写长期记忆。
 *  - 允许自动写入（status=active）：明确确认的偏好、达到重复阈值的稳定行为、明确确认的长期目标。
 *  - 不能自动写入：一次不想练 / 一次加班 / 一次设备占用 / 一次疲劳 / 一次情绪化表达。
 */

const repository = require('../db/repository');

// 单次偏差类别：一次性、不构成长期记忆（REFERENCE §9 "Single deviation must not become memory"）
const SINGLE_DEVIATION_TYPES = new Set([
  'single_deviation',     // 一次不想练 / 一次拒绝
  'one_time_overtime',    // 一次加班
  'equipment_occupied',   // 一次设备占用
  'one_time_fatigue',     // 一次疲劳
  'emotional_expression'  // 一次情绪化表达
]);

// 重复行为达到阈值才允许自动写入长期记忆（REFERENCE §9 source = repeated_behavior）
const REPEAT_THRESHOLD = 3;

function isSingleDeviation(type) {
  return SINGLE_DEVIATION_TYPES.has(type);
}

// 明确允许的 3 类自动写入（status=active，无需二次确认）
// REFERENCE §9 allowed source: user_confirmed / repeated_behavior / demo_fixture
function canAutoWrite(candidate) {
  const src = candidate.source;
  const type = candidate.type;
  // 明确确认的偏好（稳定偏好）
  if (src === 'user_confirmed' && type === 'stable_preference') return true;
  // 明确确认的长期目标
  if (src === 'user_confirmed' && type === 'long_term_goal') return true;
  // 达到重复阈值的稳定行为
  if (src === 'repeated_behavior' && (Number(candidate.repeat_count) || 0) >= REPEAT_THRESHOLD) return true;
  return false;
}

// 长期写入闸门：结合 Policy.long_term_write 与候选分类
// 返回 'auto_write' | 'propose_pending' | 'block'
function decideLongTermWrite(candidate, policy) {
  // 单次偏差：任何情况下都不写长期 Memory（规则 #8）
  if (isSingleDeviation(candidate.type)) return 'block';

  const p = (policy && policy.long_term_write) || 'blocked';
  if (p === 'blocked') return 'block';

  // 明确允许的 3 类：即便 confirm_required 也可直接写 active（用户已确认 / 已达阈值）
  if (canAutoWrite(candidate)) return 'auto_write';

  // 其余候选：先 pending，待用户确认
  return 'propose_pending';
}

// 确定性 ID（不依赖 Math.random，避免影响决策确定性）
function stableId(obj) {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// 写入待确认提案（status=pending_confirmation）——尚未成为长期记忆
function proposeMemory(userId, candidate) {
  const memoryId = candidate.memory_id || ('mem_' + stableId({ k: candidate.key, v: candidate.value, t: candidate.type }));
  repository.insertMemory({
    memory_id: memoryId,
    user_id: userId,
    type: candidate.type || 'inferred_preference',
    key: candidate.key,
    value: candidate.value,
    source: candidate.source || 'agent_proposed',
    confidence: candidate.confidence != null ? candidate.confidence : 0.6,
    status: 'pending_confirmation'
  });
  return repository.getMemory(memoryId);
}

// 自动写入长期记忆（status=active）——仅用于 3 类明确允许的候选
function autoWriteMemory(userId, candidate) {
  const memoryId = candidate.memory_id || ('mem_' + stableId({ k: candidate.key, v: candidate.value, t: candidate.type }));
  repository.insertMemory({
    memory_id: memoryId,
    user_id: userId,
    type: candidate.type,
    key: candidate.key,
    value: candidate.value,
    source: candidate.source,
    confidence: candidate.confidence != null ? candidate.confidence : 0.95,
    status: 'active'
  });
  return repository.getMemory(memoryId);
}

// 确认待确认提案 -> active。仅当当前为 pending_confirmation（REFERENCE §19）。
function confirmMemory(userId, memoryId) {
  const item = repository.getMemory(memoryId);
  if (!item || item.user_id !== userId) return null;
  if (item.status === 'pending_confirmation') {
    repository.updateMemoryStatus(memoryId, 'active', {
      source: 'user_confirmed',
      confidence: Math.max(Number(item.confidence) || 0, 0.9)
    });
  }
  return repository.getMemory(memoryId);
}

// 单次偏差：只写 deviations 表，不写长期 Memory（规则 #8）
function insertDeviation(userId, { decisionId, type, reason, payload }) {
  const db = repository.getDb();
  const id = 'dev_' + decisionId;
  db.prepare(
    `INSERT OR IGNORE INTO deviations (id, user_id, created_at, type, reason, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    new Date().toISOString(),
    type || 'single_deviation',
    reason || null,
    JSON.stringify(payload || {})
  );
  return db.prepare(`SELECT * FROM deviations WHERE id = ?`).get(id);
}

// 兼容占位：长期记忆不会从单次偏差自动写入
function shouldWriteMemory() {
  return false;
}

module.exports = {
  SINGLE_DEVIATION_TYPES,
  REPEAT_THRESHOLD,
  isSingleDeviation,
  canAutoWrite,
  decideLongTermWrite,
  proposeMemory,
  autoWriteMemory,
  confirmMemory,
  insertDeviation,
  shouldWriteMemory
};
