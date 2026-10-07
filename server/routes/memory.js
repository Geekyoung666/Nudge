'use strict';

// REFERENCE §9 / §16 / §19 Memory + Memory Confirm
// - Memory Confirm 只允许确认已有 pending proposal（REFERENCE §19）。
// - 长期写入受 Policy / Permission 控制（long_term_write）。
// - 单次偏差（一次不想练 / 加班 / 设备占用 / 疲劳 / 情绪化表达）绝不写长期记忆。
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const memoryMod = require('../runtime/memory');
const { errorShape } = require('./common');

// GET /api/memory —— 返回长期记忆（含 status）与待确认提案列表
router.get('/api/memory', (req, res) => {
  repository.ensureDemoData();
  const uid = repository.DEMO_USER;
  res.json({
    memory: repository.listMemory(uid),
    pending: repository.listPendingMemories(uid)
  });
});

// POST /api/memory/propose —— 演示用：Agent 提出长期记忆候选，受 Policy / 单次偏差闸门控制。
// 这是 Agent Runtime 在真实链路中会调用的能力（Phase 6 以端点形式暴露以便端到端验证）。
//  - 单次偏差 -> 拒绝（MEMORY_WRITE_BLOCKED）
//  - 明确允许的 3 类（user_confirmed 偏好/目标、达阈值的重复行为） -> 直接写 active
//  - 其余候选 -> 写 pending_confirmation，待 /api/memory/confirm 确认
router.post('/api/memory/propose', (req, res) => {
  const body = req.body || {};
  if (!body.key) {
    return res.status(400).json(errorShape('INVALID_INPUT', 'errors.invalidInput', false, { field: 'key' }));
  }
  const uid = repository.DEMO_USER;
  const candidate = {
    type: body.type || 'inferred_preference',
    key: body.key,
    value: body.value,
    source: body.source || 'agent_proposed',
    confidence: body.confidence != null ? Number(body.confidence) : undefined,
    repeat_count: body.repeat_count
  };

  // 长期写入受 Permission 控制：training_adjustment 关闭 -> blocked
  const perm = repository.getPermissions(uid) || {};
  const policy = {
    long_term_write: perm.training_adjustment_enabled ? 'confirm_required' : 'blocked',
    autonomy_level: perm.training_adjustment_autonomy_level || 'L4'
  };

  const decision = memoryMod.decideLongTermWrite(candidate, policy);
  if (decision === 'block') {
    return res.status(400).json(errorShape('MEMORY_WRITE_BLOCKED', 'errors.invalidInput', false, { reason: 'single_deviation_or_disallowed' }));
  }

  const item = decision === 'auto_write'
    ? memoryMod.autoWriteMemory(uid, candidate)
    : memoryMod.proposeMemory(uid, candidate);

  res.json({ decision, memory: item });
});

// POST /api/memory/confirm —— 只允许确认已存在的 pending proposal（REFERENCE §19）
router.post('/api/memory/confirm', (req, res) => {
  const { memory_id } = req.body || {};
  if (!memory_id) {
    return res.status(400).json(errorShape('INVALID_INPUT', 'errors.invalidInput', false, { field: 'memory_id' }));
  }
  const uid = repository.DEMO_USER;
  const item = repository.getMemory(memory_id);
  if (!item || item.user_id !== uid) {
    return res.status(404).json(errorShape('NOT_FOUND', 'errors.notFound', false, { memory_id }));
  }
  if (item.status !== 'pending_confirmation') {
    // 仅允许确认 pending；已是 active / 不存在 pending 则返回当前状态（409）
    return res.status(409).json(errorShape('MEMORY_NOT_PENDING', 'errors.notFound', false, { status: item.status, memory_id }));
  }
  const confirmed = memoryMod.confirmMemory(uid, memory_id);
  res.json({ confirmed: true, memory: confirmed });
});

module.exports = router;
