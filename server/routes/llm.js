'use strict';

// REFERENCE §33-35 / §42 / §46 LLM Config + Budget Guard + Complete
//
// 安全约束：
//  - API Key 仅存服务端内存（llmConfigStore），重启即失效；不入库 / 不写 localStorage / 不返回前端 / 不进日志。
//  - 每个访客预算硬上限 0.20 RMB；reserve → call → reconcile / release（由 llmBudget 与 llmAdapter 实施）。
//  - 未配置 Key 返回 LLM_NOT_CONFIGURED；超预算返回 LLM_BUDGET_EXCEEDED（retryable:false）+ hard_stop。
//  - POST /api/llm/complete 的真实调用链（预算护栏 + System Prompt + 真实 fetch + 计费结算）委托 llmAdapter.complete 实施。

const express = require('express');
const router = express.Router();
const { llmConfigStore, errorShape } = require('./common');
const repository = require('../db/repository');
const llmAdapter = require('../tools/llmAdapter');

function budgetView(b) {
  if (!b) return null;
  return {
    user_id: b.visitor_id,
    budget_rmb: b.budget_rmb,
    reserved_rmb: b.reserved_rmb,
    spent_rmb: b.spent_rmb,
    remaining_rmb: b.remaining_rmb,
    hard_stop: !!b.hard_stop
  };
}

// POST /api/llm/complete —— 委托 canonical adapter（含预算护栏 + System Prompt + 真实 fetch + 计费结算）
async function llmComplete(req, res) {
  const vid = req.visitorId;
  const cfg = llmConfigStore.get(vid);
  const body = req.body || {};
  // DST：显式透传前端挂起的未完成任务（active_task）给 adapter 注入 System Prompt。
  // 未配置 / 非字符串 / 纯空白一律归一为 null，避免把脏值注入提示词。
  const activeTask = (typeof body.active_task === 'string' && body.active_task.trim()) ? body.active_task.trim() : null;
  const r = await llmAdapter.complete(cfg, {
    message: body.message,
    summaryMemory: body.summaryMemory,
    recentHistory: body.recentHistory,
    active_task: activeTask,
    maxOutputTokens: body.maxOutputTokens
  }, vid);
  if (!r.ok) {
    const extra = {};
    if (r.remaining_rmb != null) extra.remaining_rmb = r.remaining_rmb;
    if (r.detail != null) extra.detail = r.detail;   // 透传真实错误细节（401/404/超时等）给前端
    return res.status(200).json(errorShape(r.code, r.message_key, r.retryable, extra));
  }
  return res.json({ completion: r.text, usage: r.usage, budget: r.budget, memory: r.memory || null });
}

// POST /api/llm/config — 接收 Key，仅存服务端内存（llmConfigStore）；响应绝不返回 api_key。
// 绝对禁止明文写入 SQLite（budget 行不含任何 Key 字段）。
router.post('/api/llm/config', (req, res) => {
  const vid = req.visitorId;
  const b = req.body || {};
  if (!b.api_key) return res.status(400).json(errorShape('INVALID_INPUT', 'errors.invalidInput', false, { field: 'api_key' }));
  llmConfigStore.set(vid, {
    provider: b.provider || 'openai-compatible',
    base_url: b.base_url || '',
    model: b.model || '',
    api_key: b.api_key,                                   // 仅内存，重启即失效
    input_rmb_per_m: b.input_rmb_per_m != null ? Number(b.input_rmb_per_m) : 1.0,   // 默认 1 元/百万 token
    output_rmb_per_m: b.output_rmb_per_m != null ? Number(b.output_rmb_per_m) : 2.0, // 默认 2 元/百万 token
    max_input_tokens: b.max_input_tokens != null ? Number(b.max_input_tokens) : 1200,
    max_output_tokens: b.max_output_tokens != null ? Number(b.max_output_tokens) : 600,
    timeout_ms: b.timeout_ms != null ? Number(b.timeout_ms) : 15000,
    budget_cap_rmb: 0.2
  });
  repository.ensureBudget(vid, 0.2);                      // 仅建预算行（不含 Key）
  res.json({ configured: true, provider: b.provider || 'openai-compatible', model: b.model || '', budget_cap_rmb: 0.2, notice: 'api_key stored in server memory only; not returned.' });
});

// POST /api/llm/clear — 清除服务端内存中的 Key（重启也会失效）
router.post('/api/llm/clear', (req, res) => {
  llmConfigStore.delete(req.visitorId);
  res.json({ configured: false, notice: 'LLM config cleared from server memory.' });
});

// GET /api/llm/budget — 用量视图（预算拦截已彻底移除，hard_stop 恒 false）
router.get('/api/llm/budget', (req, res) => {
  // 预算上限已废弃：remaining 恒“不限”；仍返回真实累计花费（spent_rmb）以展示工程能力。
  const b = repository.getBudget(req.visitorId) || repository.ensureBudget(req.visitorId, 0.2);
  res.json({
    budget: {
      user_id: b.visitor_id,
      budget_rmb: '无限 (开发者模式)',
      reserved_rmb: 0,
      spent_rmb: Number(b.spent_rmb) || 0,
      remaining_rmb: '不限',
      hard_stop: false,
      disabled: true
    }
  });
});

router.post('/api/llm/complete', llmComplete);

module.exports = router;
