'use strict';

// REFERENCE v1.5 §37 / §40 / §48 Discovery fixtures（DEMO_MODE 确定性来源）
// places[] / events[] / planner_proposals[] / source_summary[] / tool_failures[]
// 来源分级 A=官方 / B=结构化 / C=可检索 / D=未核实（§39）。保留 source attribution 与 freshness（§45）。
module.exports = {
  places: [
    {
      id: 'place_gym_001',
      kind: 'PLACE',
      name: 'Demo Gym',
      category: 'gym',
      address: 'demo_location',
      open_now: true,
      current_opening_hours: '08:00-22:00',
      capabilities: ['squat', 'lower_body_strength'],
      distance_km: 1.2,
      source: { type: 'official_venue', name: 'Demo Gym', url: 'https://example.com/gym', tier: 'A' },
      checked_at: '2026-10-02T09:00:00Z',
      freshness: 'CURRENT',
      confidence: 0.9
    }
  ],
  events: [
    {
      id: 'event_001',
      kind: 'EVENT',
      title: '公开篮球活动',
      sport: 'basketball',
      start_time: '2026-10-02T19:00:00+08:00',
      end_time: '2026-10-02T21:00:00+08:00',
      timezone: 'Asia/Shanghai',
      distance_km: 2.4,
      venue_name: '社区综合运动馆',
      capabilities: ['basketball'],
      booking: 'registration',
      source: { type: 'official_event', name: '社区体育', url: 'https://example.com/event', tier: 'A' },
      checked_at: '2026-10-02T09:00:00Z',
      freshness: 'CURRENT',
      confidence: 0.88
    }
  ],
  planner_proposals: [
    {
      candidate_id: 'place_gym_001',
      type: 'PLACE',
      score: 0.86,
      goal: 'strength',
      stimulus: 'lower_body_strength',
      fit_reason: 'preserves lower-body strength stimulus',
      source_url: 'https://example.com/gym',
      recommended_scope: 'TODAY'
    }
  ],
  source_summary: [
    { source: 'official_venue', tier: 'A', status: 'ok', items: 1 },
    { source: 'official_event', tier: 'A', status: 'ok', items: 1 },
    { source: 'web_search', tier: 'C', status: 'ok', items: 0 }
  ],
  tool_failures: []
};
