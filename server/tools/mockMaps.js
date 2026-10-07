'use strict';

/**
 * Nudge v1.5 — Phase 11 Maps Tool（REFERENCE §37/§40）
 *
 * DEMO_MODE 确定性距离 / ETA fixture（无 Math.random）。
 * 距离与 discovery.js 的 place_gym_001（1.2 km）对齐，保证 fixture 自洽。
 * 降级语义（§ 要求 2）：run 失败 → 显式 maps_available:false，
 * 不返回伪造的 distance/eta（上层不得用降级值做路径决策）。
 */

const DEMO_MAPS = {
  distance_km: 1.2,
  eta_min: 15,
  mode: 'walk',
  source: 'demo_fixture',
  confidence: 0.85
};

async function run(args, ctx) {
  const data = Object.assign({}, DEMO_MAPS, {
    origin: (args && args.origin) || 'demo_origin',
    destination: (args && args.destination) || 'demo_destination',
    observed_at: new Date().toISOString(),
    freshness: 'CURRENT'
  });
  return data;
}

async function fallback(args, ctx, err) {
  return {
    data: {
      maps_available: false,
      origin: (args && args.origin) || 'demo_origin',
      destination: (args && args.destination) || 'demo_destination',
      distance_km: null,
      eta_min: null,
      observed_at: null,
      source: 'unavailable',
      confidence: 0,
      freshness: 'UNKNOWN',          // Canonical 枚举（REFERENCE §4）
      note: 'maps_lookup_failed_distance_unknown'
    },
    freshness: 'UNKNOWN'
  };
}

module.exports = {
  name: 'maps',
  timeoutMs: 2000,
  run,
  fallback
};
