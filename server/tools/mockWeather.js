'use strict';

/**
 * Nudge v1.5 — Phase 11 Weather Tool（REFERENCE §37/§45）
 *
 * DEMO_MODE 确定性天气 fixture，无 Math.random。
 * 核心降级语义（§ 要求 1）：
 *   run 失败（注入故障 / 超时 / 异常）→ fallback 返回 latest cached fixture →
 *   标记 freshness（Canonical 枚举 STALE）→ registry 返回 ok:true + meta.degraded=true →
 *   决策仍可继续。缓存 / 静态 fixture 的来源区分用 data.fallback_source（非枚举扩展）。
 *
 * 缓存仅存本模块内存（lastGood），重启即失效——不是持久化数据源。
 */

const DEMO_WEATHER = {
  location: 'demo_location',
  condition: 'rain',                      // 与 scenarios.js weather_change 场景对齐
  temperature_c: 18,
  wind_level: 3,
  source: 'demo_fixture',
  confidence: 0.85
};

// latest good 观测缓存（内存级）
let lastGood = null;

function buildCurrent() {
  // observed_at 用当前时间（非随机决策；仅记录观测时刻）
  return Object.assign({}, DEMO_WEATHER, {
    observed_at: new Date().toISOString(),
    freshness: 'CURRENT'
  });
}

async function run(args, ctx) {
  const data = buildCurrent();
  if (args && args.location) data.location = String(args.location);
  lastGood = { data: data, cached_at: new Date().toISOString() };
  return data;
}

// Weather unavailable → latest cached fixture → freshness 标记 → 决策继续
// freshness 使用 Canonical 枚举（REFERENCE §4：CURRENT/SAME_DAY/STALE/EXPIRED/UNKNOWN），
// 缓存/静态 fixture 的来源区分通过 data.fallback_source 表达，不扩展枚举。
async function fallback(args, ctx, err) {
  if (lastGood && lastGood.data) {
    return {
      data: Object.assign({}, lastGood.data, {
        freshness: 'STALE',
        fallback_source: 'cache',
        cached_at: lastGood.cached_at
      }),
      freshness: 'STALE'
    };
  }
  // 从未成功过：回静态 fixture（仍然可决策，freshness 显式降级）
  return {
    data: Object.assign({}, DEMO_WEATHER, {
      observed_at: null,
      freshness: 'STALE',
      fallback_source: 'fixture'
    }),
    freshness: 'STALE'
  };
}

// 测试辅助：清空缓存（确定性演练）
function __reset() { lastGood = null; }

module.exports = {
  name: 'weather',
  timeoutMs: 2000,
  run,
  fallback,
  __reset
};
