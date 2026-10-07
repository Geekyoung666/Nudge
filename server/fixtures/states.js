'use strict';

// REFERENCE v1.5 §5 State Schema — demo_user_001 初始快照（deterministic fixture）
// 所有指标均含 value / unit_or_scale / trend / source / observed_at / freshness / confidence。
module.exports = {
  id: 'state_001',
  user_id: 'demo_user_001',
  snapshot_at: '2026-10-02T17:50:00+08:00',
  source: 'demo_fixture',
  state: {
    sleep: {
      value: 5.8,
      unit_or_scale: 'h',
      trend: 'down',
      source: 'demo_fixture',
      observed_at: '2026-10-02T08:00:00+08:00',
      freshness: 'SAME_DAY',
      confidence: 0.95
    },
    fatigue: {
      value: 7,
      unit_or_scale: '10',
      trend: 'up',
      source: 'user_report',
      observed_at: '2026-10-02T17:50:00+08:00',
      freshness: 'CURRENT',
      confidence: 0.90
    },
    sedentary: {
      value: 8,
      unit_or_scale: 'h',
      trend: 'up',
      source: 'demo_fixture',
      observed_at: '2026-10-02T17:30:00+08:00',
      freshness: 'SAME_DAY',
      confidence: 0.90
    },
    leg_soreness: {
      value: 6,
      unit_or_scale: '10',
      trend: 'stable',
      source: 'demo_fixture',
      observed_at: '2026-10-02T17:45:00+08:00',
      freshness: 'CURRENT',
      confidence: 0.86
    }
  }
};
