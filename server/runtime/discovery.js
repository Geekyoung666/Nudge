'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Discovery adapter
 * REFERENCE §37 / §43 / §48 + 硬规则（DEMO_MODE 走 mock，PRODUCTION_ADAPTER_MODE 可替换真实源）
 *
 * DEMO_MODE：读 server/fixtures/discovery.js（确定性来源）。
 * PRODUCTION_ADAPTER_MODE：返回 ADAPTER_NOT_CONFIGURED 占位（真实 adapter 在后继 Phase 接入）。
 */

const { DEMO_MODE } = require('../routes/common');
const { rankProposals } = require('./discoveryPlanner');

function searchDiscovery(query, opts) {
  const requestId = 'discovery_' + (opts && opts.request_id ? opts.request_id : Date.now());

  if (DEMO_MODE) {
    const fx = require('../fixtures/discovery');
    return {
      request_id: requestId,
      window: { start_date: '2026-10-02', end_date: '2026-10-04' },
      places: fx.places,
      events: fx.events,
      planner_proposals: rankProposals(fx.planner_proposals),
      source_summary: fx.source_summary,
      tool_failures: fx.tool_failures
    };
  }

  // PRODUCTION_ADAPTER_MODE：占位（不阻塞，返回明确失败结构）
  return {
    request_id: requestId,
    window: { start_date: null, end_date: null },
    places: [],
    events: [],
    planner_proposals: [],
    source_summary: [{ source: 'adapter', tier: '-', status: 'not_configured', items: 0 }],
    tool_failures: [{ tool: 'discovery', error_code: 'ADAPTER_NOT_CONFIGURED' }]
  };
}

module.exports = { searchDiscovery };
