'use strict';

/**
 * Nudge v1.5 — Phase 11 Venue Tool（REFERENCE §10 / §37）
 *
 * 读取 repository 的 venue（SQLite），输出严格保持 §10 语义：
 *   facilities[].exists 与 availability[].status 分离——
 *   「器械不存在」与「器械被占」是两个事实，绝不互相改写。
 *
 * found:false 不是工具错误（查询成功但库中无此 venue）→ ok:true + found:false，
 * 由上层（C0 基线 / Policy）决定如何处理 existence 未知。
 * 降级语义：DB 查询失败 → 显式 venue_available:false，不阻塞其他源。
 */

const repository = require('../db/repository');

const DEFAULT_VENUE_ID = 'gym_001';

async function run(args, ctx) {
  const venueId = (args && args.venue_id) || DEFAULT_VENUE_ID;
  const v = repository.getVenue(venueId);
  if (!v) {
    return {
      found: false,
      venue_id: venueId,
      exists_unknown: true,
      facilities: [],
      availability: [],
      freshness: 'UNKNOWN',
      observed_at: new Date().toISOString()
    };
  }
  return {
    found: true,
    venue_id: v.venue_id,
    name: v.name,
    location: v.location,
    // §10：exists（设施存在性）与 availability（当前可用性）分列输出
    facilities: (v.facilities || []).map(function (f) {
      return { name: f.name, exists: !!f.exists };
    }),
    availability: (v.availability || []).map(function (a) {
      return { name: a.name, status: a.status, observed_at: a.observed_at, source: a.source, confidence: a.confidence };
    }),
    confidence: v.confidence,
    freshness: 'CURRENT',
    observed_at: new Date().toISOString()
  };
}

async function fallback(args, ctx, err) {
  return {
    data: {
      venue_available: false,
      venue_id: (args && args.venue_id) || DEFAULT_VENUE_ID,
      found: null,
      facilities: [],
      availability: [],
      confidence: 0,
      freshness: 'UNKNOWN',          // Canonical 枚举（REFERENCE §4）
      note: 'venue_lookup_failed_availability_unknown'
    },
    freshness: 'UNKNOWN'
  };
}

module.exports = {
  name: 'venue',
  timeoutMs: 2000,
  run,
  fallback
};
