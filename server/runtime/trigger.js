'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Trigger & Normalize Input
 * REFERENCE §2 / §19 / §28
 *
 * 把任意 Request 规范化为统一 Trigger 对象。
 * 约束：不得引入随机性（§28），同样输入 → 同样触发结果。
 */

// djb2 —— 确定性字符串哈希，禁止 Math.random
function stableHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

// 关键词 → 核心四场景（REFERENCE §21）
const SCENARIO_KEYWORDS = [
  { id: 'refusal', re: /不想练|不练了|今天不练|算了|不想动|摆烂|懒得练|不去了|不去了/ },
  { id: 'limited_time', re: /只有\s*\d+\s*分钟|只剩\s*\d+\s*分钟|\d+\s*分钟|时间不够|没时间|没空|赶时间/ },
  { id: 'venue_blocked', re: /深蹲架|被占|器械|没器械|没场地|没杠铃|被用了|占用了/ }
];

// REFERENCE §44 —— 这些查询必须进入 C2（Discovery）
const DISCOVERY_KEYWORDS =
  /附近|最近|哪里|附近哪里|什么活动|篮球|场馆|健身房|今天晚上|今晚|明天|后天|有空|有没有.?活动|去哪.?练|周边/;

function detectScenario(message) {
  for (const s of SCENARIO_KEYWORDS) {
    if (s.re.test(message)) return s.id;
  }
  return null;
}

function isDiscoveryQuery(message) {
  return DISCOVERY_KEYWORDS.test(message);
}

function normalizeInput(raw) {
  const message = (raw && raw.message ? String(raw.message) : '').trim();
  const scenarioId = raw && raw.scenario_id ? String(raw.scenario_id) : null;
  const detected = detectScenario(message);

  // scenario_id 优先；否则用关键词命中（REFERENCE §28：same input → same decision）
  const resolvedScenario = scenarioId || detected;
  // 显式 is_discovery（来自 fixture/场景定义，如 find_venue）优先；否则按关键词推断
  const isDiscovery = (raw && typeof raw.is_discovery === 'boolean')
    ? raw.is_discovery
    : (isDiscoveryQuery(message) && !resolvedScenario);

  const hasCjk = /[一-龥]/.test(message);
  const hasLatin = /[a-zA-Z]/.test(message);
  const language = hasCjk && !hasLatin ? 'zh-CN' : hasLatin && !hasCjk ? 'en-US' : 'zh-CN';

  return {
    type: scenarioId ? 'scenario' : message ? 'user_input' : 'system',
    source: scenarioId ? 'demo_fixture' : 'interaction',
    input_id: raw && raw.input_id ? raw.input_id : scenarioId || 'msg_' + stableHash(message || 'empty'),
    message,
    scenario_id: resolvedScenario,
    detected_scenario: detected,
    is_discovery: isDiscovery,
    language
  };
}

module.exports = { normalizeInput, detectScenario, isDiscoveryQuery, stableHash };
