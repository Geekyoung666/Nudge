'use strict';

// REFERENCE v1.5 §10 Venue Schema — gym_001
// 关键：facilities.exists 与 availability.status 分离；
// 用户反馈“深蹲架被占”只更新 availability，绝不改写 exists。
module.exports = {
  venue_id: 'gym_001',
  name: 'Demo Gym',
  location: 'demo_location',
  facilities: [
    { name: 'squat_rack', exists: true }
  ],
  availability: [
    {
      name: 'squat_rack',
      status: 'occupied',
      observed_at: '2026-10-02T18:30:00+08:00',
      source: 'user_report',
      confidence: 0.90
    }
  ],
  evidence: [],
  confidence: 0.84
};
