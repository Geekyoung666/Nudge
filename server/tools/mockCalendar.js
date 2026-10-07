'use strict';

/**
 * Nudge v1.5 — Phase 11 Calendar Tool（REFERENCE §37/§40）
 *
 * DEMO_MODE 确定性日历 fixture（无 Math.random）。
 * 降级语义（§ 要求 2：Discovery/mock 失败不阻塞其他源、不阻塞决策）：
 *   run 失败 → fallback 返回显式「日历不可用」数据（calendar_available:false），
 *   绝不返回空 busy_slots 冒充「全天空闲」——不可用 ≠ 空闲，由 Planner 走保守路径。
 */

const DEMO_CALENDAR = {
  date: '2026-10-02',
  timezone: 'Asia/Shanghai',
  busy_slots: [
    { start: '09:00', end: '18:00', title: 'demo_work', kind: 'fixture' }
  ],
  free_slots: [
    { start: '18:00', end: '22:00', title: 'demo_free_evening', kind: 'fixture' }
  ],
  source: 'demo_fixture',
  confidence: 0.9
};

async function run(args, ctx) {
  const data = Object.assign({}, DEMO_CALENDAR, {
    observed_at: new Date().toISOString(),
    freshness: 'CURRENT'
  });
  if (args && args.date) data.date = String(args.date);
  return data;
}

// 显式降级：不可用状态显式传达，不冒充空闲
async function fallback(args, ctx, err) {
  return {
    data: {
      calendar_available: false,
      date: (args && args.date) || DEMO_CALENDAR.date,
      timezone: DEMO_CALENDAR.timezone,
      busy_slots: [],
      free_slots: [],
      observed_at: null,
      source: 'unavailable',
      confidence: 0,
      freshness: 'UNKNOWN',          // Canonical 枚举（REFERENCE §4）
      note: 'calendar_lookup_failed_assume_unknown'
    },
    freshness: 'UNKNOWN'
  };
}

module.exports = {
  name: 'calendar',
  timeoutMs: 2000,
  run,
  fallback
};
