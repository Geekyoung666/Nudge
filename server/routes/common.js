'use strict';

/**
 * Nudge v1.5 — Phase 3 共享工具
 * - DEMO_MODE / MODE 读取（与 index.js 一致）
 * - 服务端内存 LLM 配置存储（含 API Key，重启即失效，永不入库 / 不返回前端 / 不进日志）
 * - 统一 error shape
 * - 访客身份中间件（httpOnly cookie，不落 localStorage）
 */

const crypto = require('crypto');

const DEMO_MODE = !['false', '0', 'no'].includes(String(process.env.DEMO_MODE).toLowerCase());
const MODE = DEMO_MODE ? 'demo' : 'production_adapter';

// visitor_id -> { provider, base_url, model, api_key, input_rmb_per_m, ... }
// 仅存在于服务端内存；服务重启后自动失效（满足约束 #10）。
const llmConfigStore = new Map();

function round2(x) {
  // 微精度（6 位小数），避免 sub-cent 预算被四舍五入归零
  return Math.round((Number(x) + Number.EPSILON) * 1e6) / 1e6;
}

function errorShape(code, messageKey, retryable = true, extra = {}) {
  return { error: { code, message_key: messageKey, retryable, ...extra } };
}

function parseCookies(req) {
  const out = {};
  const h = req.headers && req.headers.cookie;
  if (!h) return out;
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) {
      const k = p.slice(0, i).trim();
      const v = p.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

// 访客身份：guest cookie（httpOnly）/ stable visitor identity。
// 每个访客对应一个独立 LLM 预算（约束 #8）。
function visitorMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  let vid = cookies.nudge_visitor;
  if (!vid) {
    vid = 'guest_' + crypto.randomBytes(8).toString('hex');
    res.cookie('nudge_visitor', vid, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 3600 * 1000
    });
  }
  req.visitorId = vid;
  next();
}

module.exports = { DEMO_MODE, MODE, llmConfigStore, round2, errorShape, visitorMiddleware };
