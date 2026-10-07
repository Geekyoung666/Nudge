'use strict';

/**
 * Nudge v1.5 — Phase 11 LLM Adapter（REFERENCE §27 / §33 / §46）
 *
 * complete(cfg, body, visitorId) 是 canonical 可复用实现，被 routes/llm.js 的
 * POST /api/llm/complete 直接消费。分类结果（不 throw，结构化返回）：
 *   { ok:true,  text, input_tokens, output_tokens, usage, budget,
 *     memory: { summaryMemory, recentHistory } }
 *   { ok:false, code:'LLM_NOT_CONFIGURED'|'LLM_BUDGET_EXCEEDED'|'LLM_TIMEOUT'|'LLM_PROVIDER_ERROR'|'LLM_CONTEXT_EXCEEDED',
 *     message_key, retryable, detail, remaining_rmb? }
 *
 * V14 长记忆（滑动窗口 + 摘要压缩）：
 *  - 前端随请求携带 summaryMemory + recentHistory（最近 6 轮 = 12 条）+ 当前输入；
 *  - 后端发现 recentHistory > 12 条时：移出最老 2 轮（4 条）与旧摘要合并，
 *    发起一次轻量压缩请求（max_tokens=100），生成 ≤100 字新摘要；
 *  - 最终 messages 结构（严格）：system(NUDGE_SYSTEM_PROMPT + 【用户历史摘要】) →
 *    recentHistory 按时间序 → 当前用户消息；
 *  - 压缩后的 { summaryMemory, recentHistory } 随响应回传，前端同步覆盖本地状态；
 *  - 极限保护：对「摘要 + 历史 + 当前输入」的会话载荷估算 token，超过
 *    max_input_tokens（默认 1200）→ LLM_CONTEXT_EXCEEDED（固定的 System Prompt
 *    为常量基线，不计入该动态额度）；此检查在预算预留之前，失败不计费。
 *
 * 硬约束：
 *  - API Key / base_url 绝不出现在返回值、错误 detail、日志中；
 *  - detail 只用固定枚举文案，绝不透传上游原始异常文本（可能含 URL）；
 *  - 已配置真实 Key → 必走真实 fetch（不再走 DEMO mock），System Prompt 恒为 messages 第一项；
 *  - 预算护栏（llmBudget）：worst-case 预留 → 剩余预算检查 → 成功按 usage 结算
 *    （压缩调用的 usage 一并计入实际扣除）/ 无 usage 按预留上限结算；
 *  - simulate：setFault('timeout'|'error') 确定性故障注入，仅用于验证。
 */

const { NUDGE_SYSTEM_PROMPT } = require('../fixtures/llmPrompt');
const budget = require('./llmBudget');

const DEFAULT_TIMEOUT_MS = 15000;

// —— V14 记忆参数 ——
const MAX_HISTORY_MSGS = 12;        // 滑动窗口上限：6 轮 × 2 条
const COMPRESS_BATCH = 4;           // 触发压缩时移出最老 2 轮（4 条）
const COMPRESS_MAX_TOKENS = 100;    // 压缩请求的轻量输出上限
const SUMMARY_MAX_CHARS = 220;      // 摘要防御性硬上限（模型被约束 ≤100 字）
const HISTORY_ENTRY_MAX = 800;      // 单条历史防御性截断（前端已截 100）

let simFault = null;            // null | 'timeout' | 'error'（确定性注入）

function setFault(mode) {
  simFault = (mode === 'timeout' || mode === 'error') ? mode : null;
}
function getFault() { return simFault; }
function __reset() { simFault = null; }

function errResult(code, messageKey, retryable, detail, extra) {
  var r = { ok: false, code: code, message_key: messageKey, retryable: retryable !== false, detail: detail || null };
  if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

// 上游 HTTP 状态 → 用户可读的中文错误描述（绝不透传 URL / API Key 等敏感信息）。
// 前端 errorToText 会直接展示 detail，从而实现“具体原因”透传而非无脑吞错。
function upstreamErrorDetail(status) {
  switch (status) {
    case 401: return 'API Key 无效或认证失败 (401)';
    case 403: return '无访问权限 (403)';
    case 404: return '模型不存在或接口路径错误 (404)';
    case 429: return '请求过于频繁，已被上游限流 (429)';
    default:
      if (status >= 500) return '上游 LLM 服务内部错误 (' + status + ')';
      return '上游返回错误状态 (' + status + ')';
  }
}

/** 归一化前端回传的历史：仅保留 user/assistant、截断超长、限制总量。 */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const c = String(m.content == null ? '' : m.content).slice(0, HISTORY_ENTRY_MAX);
    if (!c) continue;
    out.push({ role: m.role, content: c });
    if (out.length >= 40) break;
  }
  return out;
}

/** 粗估 token：CJK ≈0.8/字、其它 ≈0.3/字符（偏保守，够护栏用）。 */
function estimateTokens(text) {
  let cjk = 0, other = 0;
  const s = String(text || '');
  for (const ch of s) {
    if ((ch >= '\u3000' && ch <= '\u9fff') || (ch >= '\uff00' && ch <= '\uffef')) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 0.8 + other * 0.3);
}

/**
 * messages 构造（V14 严格结构）：
 *   system(NUDGE_SYSTEM_PROMPT +【用户历史摘要】) → recentHistory 按时间序 → 当前用户消息。
 * 返回值仅存在于服务端请求构造内存中，绝不进入响应 / 日志 / SQLite。
 */
function buildMessages(body) {
  const b = body || {};
  const summary = typeof b.summaryMemory === 'string' ? b.summaryMemory : '';
  const history = sanitizeHistory(b.recentHistory);
  let sys = NUDGE_SYSTEM_PROMPT + (summary ? ('\n\n【用户历史摘要】：' + summary) : '');
  const msgs = [{ role: 'system', content: sys }];

  // —— DST：未完成任务注入（跨滑动窗口挂起的任务）——
  // 前端在每轮请求携带 active_task（null 表示无）。存在时：
  //   1) 在 System Prompt 末尾追加【未完成任务】指令；
  //   2) 在 system 之后、history 之前插入一条虚拟 assistant 消息（系统备注），
  //      让模型在最近 4 轮对话之外仍能“记住”之前挂起的意图。
  const at = (typeof b.active_task === 'string' && b.active_task.trim()) ? b.active_task.trim() : '';
  if (at) {
    sys += '\n\n【未完成任务】用户之前发起了一个未完成的请求：\u2018' + at + '\u2019。'
         + '如果用户现在的问题与此相关，请结合最近的 4 轮对话，继续处理这个任务。不要假装忘记。';
    msgs[0] = { role: 'system', content: sys };
    msgs.push({ role: 'assistant', content: '（系统备注：用户之前要求 ' + at + '，该任务尚未完成）' });
  }

  for (const m of history) msgs.push({ role: m.role, content: m.content });
  msgs.push({ role: 'user', content: (b.message == null ? '' : String(b.message)) });
  return msgs;
}

/** 压缩请求的 messages：独立轻量 system + 旧摘要与被移出对话。 */
function compressionMessages(oldSummary, dropped) {
  const sys = '你是对话记忆压缩器。把【已有摘要】与【被移出的对话】合并为一段不超过100字的中文摘要：保留用户姓名、目标、数字、承诺与未决事项；省略寒暄与重复内容。直接输出摘要正文，不要任何前缀、解释或引号。';
  let txt = '【已有摘要】：' + (oldSummary || '（无）') + '\n【被移出的对话】：\n';
  for (const m of dropped) txt += (m.role === 'user' ? '用户' : '助手') + '：' + m.content + '\n';
  return [{ role: 'system', content: sys }, { role: 'user', content: txt }];
}

/**
 * 轻量压缩调用（max_tokens=100）。失败不阻断主流程：
 * 确定性兜底 = 旧摘要 + 被移出内容顺接截断（宁可粗糙也不丢记忆）。
 */
async function compressMemory(cfg, oldSummary, dropped) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 10000);
  try {
    const url = cfg.base_url.replace(/\/$/, '') + '/chat/completions';
    console.log('[LLM] memory compress | dropped=' + dropped.length + ' old_summary_chars=' + (oldSummary || '').length);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.api_key },
      body: JSON.stringify({
        model: cfg.model,
        messages: compressionMessages(oldSummary, dropped),
        max_tokens: COMPRESS_MAX_TOKENS,
        temperature: 0.2
      }),
      signal: controller.signal
    });
    if (!resp.ok) throw new Error('status_' + resp.status);
    const data = await resp.json();
    const txt = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    if (!txt) throw new Error('empty');
    const u = data.usage || {};
    return {
      summary: txt.slice(0, SUMMARY_MAX_CHARS),
      usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 }
    };
  } catch (e) {
    const fallback = ((oldSummary ? oldSummary + '；' : '') +
      dropped.map(function (m) { return m.content; }).join('／')).slice(0, SUMMARY_MAX_CHARS);
    console.log('[LLM] memory compress fallback | reason=' + (e && e.message === 'timeout' ? 'timeout' : 'upstream'));
    return { summary: fallback, usage: { input_tokens: 0, output_tokens: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

async function complete(cfg, body, visitorId) {
  // 1) 未配置 API Key → LLM_NOT_CONFIGURED（retryable：配置后即可用）
  if (!cfg || !cfg.api_key) {
    return errResult('LLM_NOT_CONFIGURED', 'errors.llmNotConfigured', true, null);
  }

  // 2) 确定性故障注入（演练 / 验证，生产不设置）
  if (simFault === 'timeout') return errResult('LLM_TIMEOUT', 'errors.llmTimeout', true, 'timeout');
  if (simFault === 'error') return errResult('LLM_PROVIDER_ERROR', 'errors.llmProviderError', true, 'injected_fault');

  // 3) V14 记忆归一化：summaryMemory + recentHistory + 当前输入
  const b = body || {};
  const userMsg = b.message == null ? '' : String(b.message);
  let summaryMemory = typeof b.summaryMemory === 'string' ? b.summaryMemory.slice(0, SUMMARY_MAX_CHARS) : '';
  let recent = sanitizeHistory(b.recentHistory);
  let compUsage = { input_tokens: 0, output_tokens: 0 };

  // 4) 滑动窗口压缩：>6 轮（12 条）→ 移出最老 2 轮（4 条）与旧摘要合并压缩
  if (recent.length > MAX_HISTORY_MSGS) {
    const dropped = recent.splice(0, COMPRESS_BATCH);
    const comp = await compressMemory(cfg, summaryMemory, dropped);
    summaryMemory = comp.summary;
    compUsage = comp.usage;
    console.log('[LLM] memory compressed | kept=' + recent.length + ' new_summary_chars=' + summaryMemory.length);
  }

  // 5) 极限 Token 保护（在预算预留之前；失败不计费）：
  //    对「摘要 + 历史 + 当前输入」的动态会话载荷估算，超过 max_input_tokens 即拒绝。
  //    固定的 NUDGE_SYSTEM_PROMPT 是常量基线（每次请求都在），不计入该动态额度。
  const convoTokens = estimateTokens(summaryMemory) +
    recent.reduce(function (acc, m) { return acc + estimateTokens(m.content); }, 0) +
    estimateTokens(userMsg);
  const maxIn = Number(cfg.max_input_tokens) || 1200;
  if (convoTokens > maxIn) {
    console.log('[LLM] context exceeded | convo_tokens=' + convoTokens + ' max=' + maxIn);
    return errResult('LLM_CONTEXT_EXCEEDED', 'errors.llmContextExceeded', false, 'context_overflow');
  }

  // 6) 用量计量（预算拦截已彻底移除）：仅取 worst-case 估算供后续 reconcile 计费记录
  var worst = budget.guardAndReserve(visitorId, cfg).worst;

  // 7) 真实上游：已配置真实 Key → 必走真实 fetch；V14 严格 messages 结构。
  var base = cfg.base_url;
  if (!base) {
    budget.release(visitorId, cfg, worst, 'provider_error');
    return errResult('LLM_PROVIDER_ERROR', 'errors.llmProviderError', true, 'network_error');
  }

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, Number(cfg.timeout_ms) || DEFAULT_TIMEOUT_MS);
  try {
    var url = base.replace(/\/$/, '') + '/chat/completions';
    // 日志仅记录 visitor/model/url/结构概况，绝不记录 api_key / 历史内容
    console.log('[LLM] real upstream call | visitor=' + visitorId +
      ' model=' + cfg.model + ' url=' + url +
      ' history_msgs=' + recent.length + ' summary_chars=' + summaryMemory.length +
      ' convo_tokens~' + convoTokens);
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.api_key },
      body: JSON.stringify({
        model: cfg.model,
        messages: buildMessages({ message: userMsg, summaryMemory: summaryMemory, recentHistory: recent, active_task: b.active_task }),
        max_tokens: (body && body.maxOutputTokens) || cfg.max_output_tokens
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      budget.release(visitorId, cfg, worst, 'provider_error');
      return errResult('LLM_PROVIDER_ERROR', 'errors.llmProviderError', true, upstreamErrorDetail(resp.status));
    }
    var data = await resp.json();
    var ch = data.choices && data.choices[0];
    var u = data.usage || {};
    // 结算：主调用 + 压缩调用 usage 合并；无 usage / 全 0 → 按预留上限（不乐观估算为 0）
    var inTok = (u.prompt_tokens || 0) + compUsage.input_tokens;
    var outTok = (u.completion_tokens || 0) + compUsage.output_tokens;
    var rec = budget.reconcile(visitorId, cfg, worst, { input_tokens: inTok, output_tokens: outTok });
    var actualCost = rec.final_cost_rmb;
    var remain = rec.budget && rec.budget.remaining_rmb;
    console.log('[LLM] call done | model=' + cfg.model + ' in=' + inTok + ' out=' + outTok +
      ' (compress in=' + compUsage.input_tokens + ' out=' + compUsage.output_tokens + ')' +
      ' estimated_rmb=' + worst.toFixed(6) + ' actual_rmb=' + Number(actualCost).toFixed(6) +
      ' remaining_rmb=' + (remain != null ? Number(remain).toFixed(6) : '?') + ' charged_from=' + rec.charged_from);
    return {
      ok: true,
      text: (ch && ch.message && ch.message.content) || '',
      input_tokens: inTok,
      output_tokens: outTok,
      usage: { input_tokens: inTok, output_tokens: outTok, estimated_cost_rmb: worst, actual_cost_rmb: actualCost },
      budget: rec.budget,
      memory: { summaryMemory: summaryMemory, recentHistory: recent }
    };
  } catch (e) {
    budget.release(visitorId, cfg, worst, (e && e.name === 'AbortError') ? 'timeout' : 'provider_error');
    if (e && e.name === 'AbortError') return errResult('LLM_TIMEOUT', 'errors.llmTimeout', true, 'timeout');
    return errResult('LLM_PROVIDER_ERROR', 'errors.llmProviderError', true, '无法连接上游 LLM 服务（网络错误，请检查 base_url 与网络）');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  complete, buildMessages, setFault, getFault, __reset,
  DEFAULT_TIMEOUT_MS,
  __test: { sanitizeHistory, estimateTokens, compressionMessages, MAX_HISTORY_MSGS, COMPRESS_BATCH }
};
