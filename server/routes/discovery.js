'use strict';

// REFERENCE §36-48 Discovery Search / Apply
// DEMO_MODE 读 server/fixtures/discovery.js（确定性）；PRODUCTION_ADAPTER_MODE 调用真实 adapter（接口见 §43/§27）。
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const { DEMO_MODE, errorShape } = require('./common');
const discoveryFixture = require('../fixtures/discovery');

router.post('/api/discovery/search', (req, res) => {
  const request_id = 'discovery_' + Date.now();
  const window = { start_date: '2026-10-02', end_date: '2026-10-04' };
  if (DEMO_MODE) {
    return res.json({
      request_id,
      window,
      places: discoveryFixture.places,
      events: discoveryFixture.events,
      planner_proposals: discoveryFixture.planner_proposals,
      source_summary: discoveryFixture.source_summary,
      tool_failures: discoveryFixture.tool_failures
    });
  }
  // 生产适配模式：真实 adapter 未在此 Phase 接入，返回结构占位 + 明确失败行为。
  return res.json({
    request_id,
    window,
    places: [],
    events: [],
    planner_proposals: [],
    source_summary: [{ source: 'none', status: 'not_configured' }],
    tool_failures: [{ tool: 'discovery', error_code: 'ADAPTER_NOT_CONFIGURED' }]
  });
});

// Discovery Apply：只允许生成 TODAY / SESSION 范围内的 Plan Adjustment（§42）；长期目标不变。
router.post('/api/discovery/apply', (req, res) => {
  const { candidate_id, type } = req.body || {};
  if (!candidate_id) return res.status(400).json(errorShape('INVALID_INPUT', 'errors.invalidInput', false, { field: 'candidate_id' }));
  repository.ensureDemoData();
  const adj = repository.insertPlanAdjustment({
    plan_adjustment_id: 'pa_' + Date.now(),
    previous_plan_id: null,
    new_plan_id: 'plan_001',
    scenario_id: null,
    scope: 'TODAY',
    reason_code: 'discovery_apply',
    payload_json: { candidate_id, type, recommended_scope: 'TODAY' }
  });
  res.json({ ok: true, plan_adjustment: adj, note: 'Only TODAY/SESSION adjustment; original long-term goal unchanged.' });
});

module.exports = router;
