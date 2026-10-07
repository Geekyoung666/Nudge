'use strict';

/**
 * Nudge v1.5 — Phase 11 Tool Registry（REFERENCE §27 Adapter 接口）
 *
 * 每个外部工具 = { name, timeoutMs, run(args,ctx), fallback(args,ctx,err) }。
 * registry.run(tool, args, ctx) 是唯一执行入口：
 *  - 超时控制：run 超过 adapter.timeoutMs 视为失败，进入 fallback；
 *  - 失败注入（DEMO 演练）：setFault(tool, 'error' | 'timeout') 确定性模拟故障路径，
 *    仅用于验证 fallback，绝不参与业务决策（无 Math.random）；
 *  - fallback 后仍失败 → 返回统一 error shape（无 stack trace）；
 *  - 永不 throw：单个工具失败不阻塞调用方 / 其他工具（§ 要求 7）。
 *
 * 统一返回：
 *   { ok, tool, data, error:{code,message_key,retryable}|null,
 *     meta:{ degraded, freshness, duration_ms, fallback_reason } }
 */

const DEFAULT_TIMEOUT_MS = 2000;

const adapters = new Map();
const faults = new Map();          // tool -> 'error' | 'timeout' | null（测试注入）

function neutralError(code, messageKey, retryable, extra) {
  return { code: code || 'TOOL_ERROR', message_key: messageKey || 'errors.toolUnavailable', retryable: retryable !== false, ...(extra || {}) };
}

function withTimeout(promise, ms, toolName) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error('tool_timeout');
      e.code = 'timeout';
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function register(adapter) {
  if (!adapter || !adapter.name) throw new Error('adapter.name required');
  adapters.set(adapter.name, adapter);
  return adapter;
}

function get(name) { return adapters.get(name) || null; }
function list() { return Array.from(adapters.keys()); }

// —— 故障注入（确定性；演示/验证 fallback 路径用，生产不设置） ——
function setFault(tool, mode) {
  if (mode === null) faults.delete(tool);
  else faults.set(tool, mode);            // 'error' | 'timeout'
}
function getFault(tool) { return faults.get(tool) || null; }

/**
 * 执行工具。任何情况都不 throw。
 */
async function run(tool, args, ctx) {
  const adapter = adapters.get(tool);
  const t0 = Date.now();
  if (!adapter) {
    return { ok: false, tool, data: null, error: neutralError('TOOL_NOT_FOUND', 'errors.toolUnavailable', false), meta: { degraded: true, duration_ms: 0 } };
  }

  // 1) 注入的确定性故障 → 直接走失败路径
  const fault = faults.get(tool);
  if (fault === 'error' || fault === 'timeout') {
    const err = new Error(fault === 'timeout' ? 'tool_timeout' : 'injected_fault');
    err.code = fault === 'timeout' ? 'timeout' : 'injected_fault';
    return failPath(adapter, args, ctx, err, Date.now() - t0);
  }

  // 2) 正常执行（带超时）
  try {
    const data = await withTimeout(Promise.resolve(adapter.run(args, ctx)), adapter.timeoutMs || DEFAULT_TIMEOUT_MS, tool);
    return { ok: true, tool, data, error: null, meta: { degraded: false, duration_ms: Date.now() - t0 } };
  } catch (err) {
    return failPath(adapter, args, ctx, err, Date.now() - t0);
  }
}

// 失败 → adapter.fallback → 仍失败 → 统一 error（无 stack）
async function failPath(adapter, args, ctx, err, elapsed) {
  const reason = err.code === 'timeout' ? 'timeout' : (err.code || 'tool_error');
  try {
    if (typeof adapter.fallback !== 'function') throw err;
    const fb = await adapter.fallback(args, ctx, err);
    return {
      ok: true,                       // 降级成功：调用方拿到可用数据继续决策
      tool: adapter.name,
      data: fb.data,
      error: neutralError(reason.toUpperCase(), 'errors.toolUnavailable', true, { detail: reason }),
      meta: { degraded: true, freshness: fb.freshness || null, duration_ms: elapsed, fallback_reason: reason }
    };
  } catch (fbErr) {
    return {
      ok: false,
      tool: adapter.name,
      data: null,
      error: neutralError(reason.toUpperCase(), 'errors.toolUnavailable', true),
      meta: { degraded: true, duration_ms: elapsed, fallback_reason: reason, fallback_failed: true }
    };
  }
}

module.exports = { register, run, get, list, setFault, getFault, neutralError, DEFAULT_TIMEOUT_MS };
