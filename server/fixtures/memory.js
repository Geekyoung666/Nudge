'use strict';

// REFERENCE v1.5 §9 Memory Schema — demo_user_001
// 仅 seed 稳定、已确认的长期偏好；单次偏差不写入此处。
// Phase 6：新增一条 Agent 提出的待确认提案（status=pending_confirmation），
// 用于演示「长期写入需经用户确认」的完整生命周期（POST /api/memory/confirm 后转 active）。
module.exports = [
  {
    memory_id: 'mem_001',
    user_id: 'demo_user_001',
    type: 'stable_preference',
    key: 'preferred_training_time',
    value: 'evening',
    source: 'user_confirmed',
    confidence: 0.98,
    status: 'active'
  },
  {
    memory_id: 'mem_pending_001',
    user_id: 'demo_user_001',
    type: 'inferred_preference',
    key: 'prefers_bodyweight_home',
    value: 'true',
    source: 'agent_proposed',
    confidence: 0.62,
    status: 'pending_confirmation'
  }
];
