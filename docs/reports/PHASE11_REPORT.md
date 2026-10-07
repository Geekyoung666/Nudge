# Nudge v1.5 — Phase 11 交付报告：Error / Fallback + LLM Budget Guard

> Canonical Source: Nudge_REFERENCE_v1.5.md（§27 Adapter / §33-35 / §37 / §40 / §42 / §45-46 / §48）
> 模式：仅 Hy3 免费额度 · DEMO_MODE 确定性 fixture · 无真实 LLM Key

---

## 1. 变更文件列表（9 个，全部在允许清单内）

| 文件 | 状态 | 职责 |
|---|---|---|
| `server/tools/toolRegistry.js` | 新增 | 统一执行入口 `run(tool,args,ctx)`：超时控制、确定性故障注入、fallback 链、永不 throw |
| `server/tools/mockWeather.js` | 新增 | 确定性天气 fixture + lastGood 内存缓存；fallback 返回缓存并标记 Canonical 枚举 `STALE`（来源区分用 `data.fallback_source: 'cache'/'fixture'`） |
| `server/tools/mockCalendar.js` | 新增 | 确定性 busy/free slots；降级显式 `calendar_available:false`（不可用≠空闲） |
| `server/tools/mockMaps.js` | 新增 | 确定性距离/ETA（与 discovery fixture 1.2km 对齐）；降级 distance/eta=null |
| `server/tools/mockVenue.js` | 新增 | 读 repository venues；`facilities.exists` 与 `availability.status` 严格分离输出 |
| `server/tools/llmAdapter.js` | 新增 | complete 分类返回 `LLM_NOT_CONFIGURED / LLM_TIMEOUT / LLM_PROVIDER_ERROR / OK`；DEMO 确定性 mock；detail 仅固定枚举 |
| `server/tools/llmBudget.js` | 新增 | canonical 预算闸门：worstCaseCost / guardAndReserve / reconcile / release / view |
| `public/scripts/error.js` | 新增 | safeFetch（超时+归一化+不 reject）、toast / Loading / Error(↻retry) / Empty 三态、全局守卫、内联样式 |
| `public/scripts/app.js` | 修改 | 动态加载 error.js（index.html 不在清单）；api 升级 safeFetch；bootstrap 失败→error 卡+retry，壳不白屏 |

## 2. 关键代码片段

**Weather 失败 → latest cached → freshness 标记 → 决策继续（要求 1）**

```js
// mockWeather.js
async function fallback(args, ctx, err) {
  if (lastGood && lastGood.data) {
    return { data: Object.assign({}, lastGood.data, { freshness: 'STALE_CACHED', cached_at: lastGood.cached_at }), freshness: 'STALE_CACHED' };
  }
  return { data: Object.assign({}, DEMO_WEATHER, { observed_at: null, freshness: 'STALE_FIXTURE' }), freshness: 'STALE_FIXTURE' };
}
// registry.failPath: fallback 成功 → { ok:true, meta:{ degraded:true, freshness, fallback_reason } }
```

**超预算 → 拒绝 + hard_stop，绝不偷偷放行（要求 4）**

```js
// llmBudget.js
if (worst > remaining + 1e-9) {
  repository.setHardStop(visitorId, 1);
  record(visitorId, cfg, 'blocked', worst, null, null, null);
  return { allowed:false, code:'LLM_BUDGET_EXCEEDED', message_key:'errors.budgetExceeded', retryable:false, remaining_rmb:remaining, requested_worst_case_rmb:worst };
}
```

**无 usage → 按预留上限结算，不乐观估算（要求 5）**

```js
const finalCost = actual > 0 ? actual : worst;   // charged_from: 'usage' | 'reserve_cap'
```

**safeFetch 永不 reject（前端不白屏的根基）**

```js
// error.js — 网络异常/超时/非 JSON 全部归一化，调用方拿到 { ok:false, error:{code,message_key,retryable,status} }
.catch(function (err) {
  var timedOut = !!(ctrl && err && err.name === 'AbortError');
  return { ok:false, status:0, error: normalize(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', 'errors.internal', true, 0) };
});
```

**Key 零泄露（要求 10）**：llmAdapter 错误 detail 仅允许固定枚举 `timeout / upstream_status_NNN / network_error / injected_fault`，绝不透传异常原文（防 URL 泄露）；测试断言错误结果 JSON 不含 api_key / base_url / stack。

## 3. 验证命令与结果（60 项断言全过）

```bash
# ① tools 层桩测试（33 项）
node /tmp/test_tools_phase11.js                # → 33 passed, 0 failed

# ② 前端桩测试（22 项）：safeFetch 归一化 + bootstrap 失败→error卡→retry恢复
node /tmp/test_fe_phase11.js                   # → 22 passed, 0 failed

# ③ weather 故障不阻塞其他源（5 项）
node /tmp/test_concurrent_phase11.js           # → 5 passed, 0 failed
```

**Live 路由验证（DEMO 实例 :3000 / production_adapter 实例 :3100 + 127.0.0.1:19299 黑洞 socket）：**

| # | 场景 | 结果 |
|---|---|---|
| 1 | weather 注入 error → 决策继续 | ✅ ok:true + degraded:true + `STALE`（fallback_source=fixture）；有缓存后 → `STALE`（fallback_source=cache） |
| 2 | 未配置调 complete | ✅ `LLM_NOT_CONFIGURED`（retryable:true） |
| 3 | 假 Key + 黑洞上游 | ✅ 15s 超时 → `LLM_PROVIDER_ERROR` detail:"timeout"；**reserved_rmb 0.0024→0 全额释放**；usage record status=timeout |
| 4 | 高价 config（worst=1800） | ✅ `LLM_BUDGET_EXCEEDED`（retryable:false）+ hard_stop=true；换回低价仍拒绝（不偷偷 fallback） |
| 5 | `/api/llm/clear` 后 | ✅ Key 清除 → `LLM_NOT_CONFIGURED` |
| 6 | 前端 error 不白屏 | ✅ error 卡 + ↻ retry + 数字人壳存活；retry 后完整恢复渲染 |
| — | DEMO complete 全链 | ✅ reserve→reconcile：spent=0.000161（有 usage 按 actual） |
| — | 回归冒烟 | ✅ bootstrap/i18n dict(83 keys)/interactions/static error.js 全 200 |

落库证据（llm_usage_records）：`blocked:2, timeout:2, provider_error:1, reserved:6, completed:4`，失败记录 actual_cost_rmb=null。

## 4. 已知限制

1. **tools 层尚未接入 Agent Runtime**：weather/calendar/maps/venue adapter 就绪但 ContextRouter/Planner（后续 Phase 文件）尚未消费；`registry.run` 是为接入预留的唯一入口。
2. **routes/llm.js 为既有内联实现**（不在允许清单）：llmBudget.js 与其语义一致（worst-case 公式、hard_stop、reconcile 规则逐行对齐），Runtime 接入后应以 llmBudget 为 canonical，路由层可后续收敛。
3. **weather lastGood 缓存为进程内存**：重启即失效（fallback 回 STALE_FIXTURE 静态 fixture），不做持久化。
4. **error.js 由 app.js 动态加载**：因 index.html 不在 Phase 11 允许清单；动态加载失败时 app.js 保留原 fetch 降级路径，启动不阻断。
5. **超时阈值**：上游 LLM 超时 15s 沿用 routes/llm.js 现值；前端 safeFetch 默认 12s，均可用参数覆盖。
6. **hard_stop 无自动复位**：触发后需重启或后续提供管理接口（符合 §46 保守语义）。

## 5. 下一 Phase 建议

1. **ContextRouter / Planner 接入 Tool Registry**：C0→C3 各层按权限加载 `registry.run('weather'/'calendar'/…)`，消费 `meta.degraded / freshness / data.calendar_available` 决定保守降级路径；Discovery 聚合器将 `w.error` 写入 `tool_failures[]`（不阻塞其他源已在 registry 保证）。
2. **Runtime 内 LLM 调用收敛到 llmBudget + llmAdapter**：`guardAndReserve → llmAdapter.complete → reconcile/release` 三段式替换散落实现。
3. **Console 展示 budget 视图**：`GET /api/llm/budget` 已就绪，可在 Settings 页展示 remaining/hard_stop。
4. **hard_stop 管理接口**（可选）：`POST /api/llm/unblock`（仅 DEV）。

---

## 6. 补充任务：嵌入 LLM System Prompt（Nudge_LLM_System_Prompt_v1.2.md）

### 变更文件（3 个，均在补充清单内）

| 文件 | 状态 | 内容 |
|---|---|---|
| `server/fixtures/llmPrompt.js` | 新建 | 完整嵌入 System Prompt v1.2（15031 bytes / 648 行）导出为 `NUDGE_SYSTEM_PROMPT`（CommonJS，与项目风格一致） |
| `server/tools/llmAdapter.js` | 修改 | 新增 `buildMessages(body)`；DEMO mock 与 production fetch 共用同一构造路径 |
| `server/tools/llmBudget.js` | **不改** | 不涉及请求构造；worst-case 按 `cfg.max_input_tokens` 上限估算，System Prompt 体积已被该上限覆盖 |

### 实现

```js
// llmAdapter.js — mock 与 production 共用（保证无缝切换，要求 5）
function buildMessages(body) {
  return [
    { role: 'system', content: NUDGE_SYSTEM_PROMPT },   // 恒为第一项（要求 2）
    { role: 'user', content: (body && body.message) || '' }
  ];
}
// production: body: JSON.stringify({ model, messages: buildMessages(body), max_tokens })
// DEMO mock: 同样调用 buildMessages；input token 估算计入 system 体积，clamp 到 max_input_tokens
```

嵌入方式：生成脚本 `JSON.stringify(源文件)` 写入 fixture（自动转义引号/反引号/换行），生成后 **roundtrip 校验与源文件逐字节一致**。

### 验证（16 项桩测试 + 4 项 live 全过）

```bash
node /tmp/test_prompt_phase11.js    # → 16 passed, 0 failed
```

| 检查 | 结果 |
|---|---|
| fixture 导出 === 源文件（逐字节，15031 bytes） | ✅ |
| `buildMessages`：messages[0] system / messages[1] user | ✅ |
| complete 响应不含任何 prompt 特征片段（`Nudge LLM System Prompt` / `Hard Constraints` / `Persona Architecture` 等） | ✅ |
| 未配置 Key → `LLM_NOT_CONFIGURED` 且无 prompt | ✅ |
| timeout 错误路径无 prompt | ✅ |
| input 估算计入 system → clamp 1200 → actual 0.0012 < worst 0.0024（预算护栏覆盖 system 体积） | ✅ |
| 源码静态检查：llmAdapter / llmPrompt 无 `console.*`；llmPrompt 无 fetch / sqlite 引用 | ✅ |
| live：`/api/llm/complete` 未配置 → `LLM_NOT_CONFIGURED`（CLEAN）；DEMO complete 成功（CLEAN） | ✅ |
| live：服务器日志 grep `Persona Architecture` → 0 命中 | ✅ |
| live：`strings nudge.db` grep → 0 命中（SQLite 零明文） | ✅ |

### 安全边界说明

- System Prompt 仅存在于：fixture 源文件 → 服务端内存常量 → 随请求发给上游。三条泄露路径（响应 / 日志 / SQLite）均已实证关闭。
- **架构现状**：`routes/llm.js`（不在允许清单）的内联 DEMO/production 实现未走 llmAdapter，故 live `/api/llm/complete` 的上游请求暂不含 system prompt；llmAdapter 作为 canonical 层已就绪，Runtime/路由收敛到 llmBudget + llmAdapter 后即自动生效（即 Phase 11 报告 §5.2 建议）。
- live 路由 DEMO 的 usage 估算（65 tokens）为 routes/llm.js 内联逻辑（不含 system）；llmAdapter 层估算（clamp 1200，含 system）更接近真实上游体积。

---

## 7. Canonical 对照检查（AGENTS / PRD / REFERENCE v1.5）

> 对照来源：用户提供的 AGENTS_Nudge_v1.5.md / Nudge_PRD_v1.5.md / Nudge_REFERENCE_v1.5.md / Nudge_LLM_System_Prompt_v1.2.md（三份文档中 System Prompt 内容与先前嵌入版逐字节一致，已 diff 确认）。

### 修正的偏差（1 处实质）

**自造 Freshness 枚举值违反 Canonical（AGENTS §1「不自行发明第三套」）**

| 原实现 | 修正后 |
|---|---|
| `STALE_CACHED` / `STALE_FIXTURE` / `UNAVAILABLE` | Canonical 枚举 `STALE` / `UNKNOWN`（REFERENCE §4），来源区分移入 `data.fallback_source: 'cache'/'fixture'` |

修正文件：mockWeather.js / mockCalendar.js / mockMaps.js / mockVenue.js；4 套测试同步更新后全过（33+5+16+22=76）。

### 确认一致的检查项

| Canonical 条目 | Phase 11 实现 | 状态 |
|---|---|---|
| AGENTS §4 目录结构 `/server/tools/` 7 文件名 | toolRegistry/mockWeather/mockCalendar/mockMaps/mockVenue/llmAdapter/llmBudget | ✅ 逐一同名 |
| AGENTS §14.1 预算 10 条（reserve→call→reconcile/release、超限拒绝、不偷偷 fallback） | llmBudget.js + routes 层 | ✅ |
| REFERENCE §34 `spent+reserved+worst<=budget` | guardAndReserve remaining 公式等价 | ✅ |
| REFERENCE §35 usage status 枚举 reserved/completed/blocked/provider_error/timeout | llmBudget record 全部命中 | ✅ |
| REFERENCE §33 config 默认值 1200/600/1.0/2.0/0.20 | llmBudget BUDGET_CAP_RMB + fixtures/llmBudget.js | ✅ |
| REFERENCE §20 统一 error shape 无 stack | errorShape / neutralError | ✅ |
| REFERENCE §43 adapter 四要素（success/results/error_code/freshness）+ 单源失败不阻塞 | registry {ok,data,error,meta.freshness} + 并发测试 | ✅ |
| REFERENCE §10 `exists != availability` | mockVenue 分离输出 | ✅ |
| AGENTS §20 Weather 失败→cached fixture→mark freshness→continue | mockWeather fallback 链 | ✅（枚举已修正） |
| PRD §26 失败时「保持数据→标记→继续判断」 | calendar/maps 显式 `*_available:false` + UNKNOWN | ✅ |
| REFERENCE §28 无 Math.random 决策 | 全部 fixture 确定性 | ✅ |
| System Prompt v1.2 完整嵌入 + 零泄露 | llmPrompt.js roundtrip 校验 + 响应/日志/DB 三路 grep | ✅ |
| AGENTS §14.2 max_input/output_tokens 默认 | llmAdapter clamp + worst-case 覆盖 system 体积 | ✅ |

### 说明项（不构成偏差）

- toolRegistry 错误 code 值（`TOOL_NOT_FOUND`/`TIMEOUT` 等）：REFERENCE §20 未定义工具域 code 全集（仅示例），message_key 统一走 Canonical `errors.toolUnavailable`，语义清晰可审计。
- mockWeather 观测时间戳用 UTC ISO（与 discovery fixture `checked_at` 风格一致），非决策输入。

