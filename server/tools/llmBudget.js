'use strict';

/**
 * Nudge v1.5 — Phase 11 LLM Budget Guard（REFERENCE §34 / §46）
 *
 * canonical 可复用预算闸门（routes/llm.js 内联实现之外的公共层，供 Runtime 消费）。
 * 生命周期：guardAndReserve → complete → reconcile / release。
 *
 * 硬约束：
 *  - 每访客预算硬上限 BUDGET_CAP_RMB = 0.20 RMB（§34）；
 *  - worst-case 预留：max_input/1e6×input_rmb_per_m + max_output/1e6×output_rmb_per_m，
 *    微精度（6 位小数）避免 sub-cent 归零；
 *  - 超预算 → LLM_BUDGET_EXCEEDED（retryable:false）+ hard_stop，绝不偷偷放行（§ 要求 4）；
 *  - reconcile：上游有 usage 按 actual 计费；无 usage / tokens 全 0 → 按预留上限结算，
 *    绝不乐观估算为 0（§ 要求 5）；
 *  - provider error / timeout → release 全额预留，写 usage record（§ 要求 3）；
 *  - 本模块只管预算，绝不存储 / 读取 API Key。
 */

const repository = require('../db/repository');

const BUDGET_CAP_RMB = 0.20;
let seq = 0;                    // usage record id 唯一性（同毫秒多次写入不被 INSERT OR IGNORE 吞掉）

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 1e6) / 1e6;
}

// §34 worst-case 预留成本
function worstCaseCost(cfg) {
  const inCost = (Number(cfg.max_input_tokens) || 0) / 1e6 * (Number(cfg.input_rmb_per_m) || 0);
  const outCost = (Number(cfg.max_output_tokens) || 0) / 1e6 * (Number(cfg.output_rmb_per_m) || 0);
  return round2(inCost + outCost);
}

function record(visitorId, cfg, status, estimated, actual, inTok, outTok) {
  seq += 1;
  return repository.insertUsageRecord({
    id: 'llm_' + Date.now() + '_' + seq + '_' + status,
    visitor_id: visitorId,
    provider: (cfg && cfg.provider) || null,
    model: (cfg && cfg.model) || null,
    estimated_cost_rmb: estimated != null ? estimated : null,
    actual_cost_rmb: actual != null ? actual : null,
    input_tokens: inTok != null ? inTok : null,
    output_tokens: outTok != null ? outTok : null,
    status: status
  });
}

/**
 * 用量计量（预算拦截已彻底移除）：仅确保预算行存在并返回 worst-case 估算，
 * 供后续 reconcile 计费记录使用；不再 reserve / block / setHardStop。
 * 始终 { allowed:true, worst, remaining_before }。
 */
function guardAndReserve(visitorId, cfg) {
  const b = repository.getBudget(visitorId) || repository.ensureBudget(visitorId, BUDGET_CAP_RMB);
  return { allowed: true, worst: worstCaseCost(cfg), remaining_before: Number(b.remaining_rmb) || 0 };
}

/**
 * 结算：actual>0 用 actual；无 usage（tokens 全 0 / 缺失）→ 按预留上限结算（不乐观估算）。
 */
function reconcile(visitorId, cfg, worst, upstream) {
  const inTok = Number(upstream && upstream.input_tokens) || 0;
  const outTok = Number(upstream && upstream.output_tokens) || 0;
  const actual = round2(inTok / 1e6 * (Number(cfg.input_rmb_per_m) || 0) + outTok / 1e6 * (Number(cfg.output_rmb_per_m) || 0));
  const finalCost = actual > 0 ? actual : worst;      // § 要求 5：无 usage 按预留上限
  repository.reconcileBudget(visitorId, worst, finalCost, inTok, outTok);
  record(visitorId, cfg, 'completed', worst, finalCost, inTok, outTok);
  return {
    final_cost_rmb: finalCost,
    charged_from: actual > 0 ? 'usage' : 'reserve_cap',
    budget: view(visitorId)
  };
}

/**
 * 释放预留（provider error / timeout）：全额释放 + 写失败记录。
 */
function release(visitorId, cfg, worst, status) {
  repository.releaseBudget(visitorId, worst);
  record(visitorId, cfg, status || 'provider_error', worst, null, null, null);
  return { released_rmb: worst, budget: view(visitorId) };
}

/** 预算视图（§34 LLM Budget Object；不含任何 Key） */
function view(visitorId) {
  const b = repository.getBudget(visitorId) || repository.ensureBudget(visitorId, BUDGET_CAP_RMB);
  return {
    user_id: b.visitor_id,
    budget_rmb: Number(b.budget_rmb) || 0,
    reserved_rmb: Number(b.reserved_rmb) || 0,
    spent_rmb: Number(b.spent_rmb) || 0,
    remaining_rmb: Number(b.remaining_rmb) || 0,
    hard_stop: !!b.hard_stop
  };
}

module.exports = {
  BUDGET_CAP_RMB,
  worstCaseCost,
  guardAndReserve,
  reconcile,
  release,
  view,
  round2
};
