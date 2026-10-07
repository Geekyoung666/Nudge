'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Discovery Planner
 * REFERENCE §40 Discovery Planner Proposal + §39 source tier 优先级
 *
 * score 是产品内部候选排序指标，不是医学效果评分，也不代表训练效果百分比。
 * 冲突时按来源分级：A > B > C > D。
 */

function tierOf(p) {
  if (p.source_tier) return p.source_tier;
  if (p.source && p.source.tier) return p.source.tier;
  return null;
}

function rankProposals(proposals) {
  if (!Array.isArray(proposals)) return [];
  const tierWeight = { A: 4, B: 3, C: 2, D: 1 };
  return proposals.slice().sort((a, b) => {
    const ta = tierWeight[tierOf(a)] || 0;
    const tb = tierWeight[tierOf(b)] || 0;
    if (tb !== ta) return tb - ta;
    return (b.score || 0) - (a.score || 0);
  });
}

module.exports = { rankProposals, tierOf };
