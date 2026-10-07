# Nudge

> **Nudge - Proactive when it matters.**
>
> 一个主动干预型个人运动 AI Agent 原型。

[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.x-blue)](https://expressjs.com)
[![License](https://img.shields.io/badge/license-MIT--proto-orange)]()

- **GitHub 仓库**：<https://github.com/Geekyoung666/Nudge>
- **体验 Demo**：`<在此填入你的部署地址，例如 https://your-domain 或 http://localhost:3000>`

> 说明：本项目当前为 **v1.5 Demo（DEMO_MODE）**，所有外部依赖（天气 / 地图 / 场馆 / 日历 / LLM）均由确定性 fixtures 与 mock 适配器驱动，不接入任何真实第三方 API。

---

## 界面预览

> 请在此插入一张高保真 UI 截图（建议 `docs/images/ui_preview.png`）：

![Nudge UI](./docs/images/ui_preview.png)

Nudge 采用**全屏数字人作为 Agent 本体**，结合极简**毛玻璃卡片**承载交互。用户看到的是一个"会主动开口"的运动伙伴，而非传统表单式工具。

---

## 核心特性

| 特性 | 说明 |
| --- | --- |
| **Agent Runtime 决策链路** | 单条 Canonical Flow 驱动全部核心场景：`Normalize → Intervention Gate → Intent → Context Router → Planner → Policy → Action → Persistence → Decision Event`。前端不实现任何业务逻辑。 |
| **滑动窗口 + 结构化长期记忆** | 对话历史采用滑动窗口（12 条 ≈ 6 轮，溢出即压缩合并摘要）控制 Token 成本；长期记忆按 `active / pending_confirmation` 状态结构化落库，单次偏差不写长期记忆。 |
| **XAI 决策控制台** | 每次决策输出完整 Trace：Trigger、Context 路由理由（C0→C3）、Policy 裁决、Action 与写入项，前端 `console.js` 可视化呈现，可解释、可审计。 |
| **LLM 预算护栏（Budget Guard）** | 可选 LLM 增强必须先经 Budget Guard（worst-case 预留 / reconcile / release），按访客计量成本并暴露 `hard_stop`；超预算或未配置一律降级为确定性 fallback，绝不阻断主链。 |
| **174 项自动化断言（Phase 12 验收）** | 6 套单元/集成套件 + Playwright 真实浏览器端到端，全部通过；详见 `docs/reports/PHASE12_ACCEPTANCE.md`。 |

---

## 系统架构

分层结构：**UI → API → Agent Runtime → Tool Adapters → SQLite**。

```text
┌─────────────────────────────────────────────────────────────┐
│  UI  (public/ · Vanilla JS)                                  │
│  index.html / app.js / home.js / console.js / error.js       │
│  → 仅负责渲染与采集，不含任何业务逻辑（硬规则 #2 / #11）      │
└───────────────────────────┬─────────────────────────────────┘
                            │  fetch  (结构化 JSON，禁 CoT 回传)
┌───────────────────────────▼─────────────────────────────────┐
│  API  (server/routes/ · Express)                             │
│  /api/interactions · /api/decision · /api/llm · /api/memory  │
│  /api/permissions · /api/settings · /api/bootstrap · …       │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Agent Runtime  (server/runtime/)   ★ 所有决策在此产生        │
│  trigger → intent → contextRouter(C0→C3) → planner → policy   │
│  + memory (滑动窗口 / 长期记忆) + venue + discovery            │
└───────┬───────────────────────────────┬──────────────────────┘
        │                               │
┌───────▼──────────────┐   ┌────────────▼─────────────────────┐
│ Tool Adapters        │   │ LLM Adapter (server/tools/)       │
│ (server/tools/)      │   │ llmAdapter · llmBudget(BudgetGuard)│
│ mockWeather / Maps / │   │ 可选增强，须经 Budget Guard 包裹   │
│ Venue / Calendar /   │   └─────────────────────────────────────┘
│ toolRegistry         │
└───────────┬──────────┘
            │
┌───────────▼──────────┐
│ SQLite  (server/db/)  │  决策/记忆/偏差/预算/场馆 持久化
│ repository · schema   │
└──────────────────────┘
```

**设计原则**：前端是"哑"视图层，所有触发判定、意图分类、上下文路由、计划生成、策略裁决与持久化写入均由 Agent Runtime 完成。这保证了决策逻辑可单测、可审计、可复现（demo 模式完全确定性）。

---

## 工程亮点

### 为什么用原生 JS 而非框架
前端仅用 **HTML / CSS / Vanilla JS**，零构建（无 webpack / vite）、零运行时依赖。选择原生的目的很明确——把复杂度预算留给核心 Agent 逻辑（Runtime / Policy / Memory），而不是消耗在视图框架与构建链上。代价是手写少量 DOM 编排，收益是可移植、可审计、首屏极轻。

### 滑动窗口机制
多轮对话需兼顾"上下文延续"与"Token 成本控制"两个相互矛盾的诉求。`server/tools/llmAdapter.js` 的做法：

- 维护最近 `MAX_HISTORY_MSGS = 12`（≈ 6 轮 × 2）条消息的滑动窗口；
- 超过阈值时，将最老轮次移出窗口，并与上一轮压缩出的**摘要**合并，作为新上下文前缀；
- 未完成任务以 DST（Dialogue State Tracking）形式跨窗口挂起注入，避免"忘记"用户半截需求。

> 该窗口仅服务于**可选 LLM 增强**；主决策链本身不依赖 LLM（硬规则 #2），因此即使窗口为空也不影响核心干预判定。

### Policy 安全护栏
长期记忆写入受 `Policy` 与 `Permission` 双重约束（`server/runtime/policy.js` + `memory.js`）：

- 默认 `long_term_write = 'blocked'`，今日调整 / 明确拒绝（`S3`）均不写长期记忆；
- 单次偏差（`single_deviation` / `one_time_overtime` / `equipment_occupied` / `one_time_fatigue` / `emotional_expression`）**只写入 `deviations` 表，绝不进入长期记忆**（硬规则 #8）；
- 候选记忆先以 `pending_confirmation` 落库，**未经用户确认不成为 `active` 长期记忆**；仅"用户明确确认的偏好/目标"或"达到重复阈值（≥3 次）的稳定行为"允许自动写入。

### 错误透传
后端不"吞错"、不"兜底成成功"。上游真实错误（HTTP 状态码 + `detail`）被归一化为结构化 error shape 返回；前端 `error.js` 再映射为具体中文原因（如 `401` → API Key 无效、`404` → 模型/路径不存在、`429` → 触发限流、`5xx` → 上游错误、网络超时 → 明确超时提示）。密钥**绝不**进入响应体或日志。

---

## 快速开始

```bash
# 1) 安装依赖
npm install

# 2) 启动（默认 DEMO_MODE，确定性 fixtures，不接真实外部 API）
npm start
# 开发模式（文件改动自动重启）
npm run dev

# 3) 打开首页
open http://localhost:3000/
```

**配置你自己的 LLM（可选）**：进入界面右上角 **「设置」**，填入你的 LLM API Key 与模型参数。

> **API Key 安全约定**：Key 仅存于**服务端内存**（进程级 `llmConfigStore`），不写入 SQLite 明文、不写入 `localStorage`、不进入日志、不返回前端；服务重启后 Key 自动失效，需重新配置。

**语音功能（可选）**：长按语音使用浏览器端 Whisper tiny，模型权重不入库（约 42MB），clone 后拉取一次：

```bash
npm run fetch-model
```

---

## 演示与截图

> 以下为面向面试演示的占位图，请替换为实际截图（放置于 `docs/images/`，文件名保持即可）。

![Decision Console](./docs/images/decision_console.png)

决策控制台展示了从 **Trigger 到 Action** 的完整 Trace，包含 **Context 路由（C0→C3）理由**与 **Policy 拦截**结果，每一步都可点开查看结构化字段。

![Network Request](./docs/images/f12_network.png)

F12 网络面板展示了**真实的后端 API 交互**：每个决策对应一次 `/api/interactions` 或 `/api/decision` 请求，响应为结构化决策对象，无 Chain-of-Thought 泄露。

![Test Report](./docs/images/174_tests.png)

**174 项自动化断言**全部通过（Phase 12 验收：6 套单元/集成套件 + Playwright 真实浏览器端到端）。详见 `docs/reports/PHASE12_ACCEPTANCE.md`。

---

## 文档索引

| 文档 | 职责 |
| --- | --- |
| `README.md` | 项目入口：定位、架构、运行指南与演示说明（本文件）。 |
| `NUDGE_SYSTEM_PROMPT.md` | LLM System Prompt 规范；运行时由 `server/fixtures/llmPrompt.js` 内嵌副本使用，约束生成边界。 |
| `docs/reports/PHASE11_REPORT.md` | Phase 11 工具适配器（Weather/Maps/Venue/Calendar/LLM）验收报告。 |
| `docs/reports/PHASE12_ACCEPTANCE.md` | Phase 12 最终验收报告：**174 项自动化断言**与 XAI / Budget / 安全边界验收结论。 |
| `docs/reports/MOBILE_COMPAT_REPORT.md` | 移动端兼容性与响应式布局验收报告。 |

> 注：本仓库以 **Canonical Source = `NUDGE_SYSTEM_PROMPT.md` + 代码即规范** 为准；若后续补充 `AGENTS / PRD / REFERENCE` 类文档，应在此表登记其唯一职责，避免与代码产生第二套枚举/字段定义。

---

## 执行模式

通过环境变量 `DEMO_MODE` 控制：

| 值 | 模式 | 说明 |
| --- | --- | --- |
| 未设置 / `true` | `demo` | 默认。确定性 fixtures + mock 适配器，不接真实外部 API。 |
| `false` / `0` | `production_adapter` | 生产适配模式（替换为真实 LLM / Weather / Calendar / Maps / Venue 适配器的预留接入点）。 |

```bash
DEMO_MODE=true  npm start     # 默认 demo
DEMO_MODE=false npm start     # 生产适配模式（需自备真实适配器实现）
```

---

## 目录结构

```text
/nudge
  package.json              # Express 依赖与启动脚本
  README.md                 # 本文件
  NUDGE_SYSTEM_PROMPT.md    # LLM 系统提示词规范
  server/
    index.js                # Express 入口 + /api/health
    db/                     # SQLite schema 与访问层（repository）
    routes/                 # API 路由（interactions / decision / llm / memory / permissions …）
    runtime/                # Agent Runtime（trigger / intent / contextRouter / planner / policy / memory …）
    tools/                  # 工具与适配器（llmAdapter / llmBudget / mockWeather / mockMaps / mockVenue / mockCalendar / toolRegistry）
    fixtures/               # DEMO_MODE 确定性 fixtures + 内嵌 System Prompt
  public/
    index.html              # 前端首页（数字人 / 毛玻璃卡片）
    scripts/                # 前端逻辑（app / home / console / error / voice / text / i18n）
    styles/                 # 前端样式（app.css / console.css）
    assets/                 # 数字人素材
  docs/
    reports/                # Phase 交付与验收报告（历史归档）
    images/                 # README 演示截图占位目录（需手动补充）
```

> `node_modules/`、`nudge.db`、设计截图（`UI_*.png`）、语音权重（`public/models/`）与本地密钥（`.env`）均不入库，见 `.gitignore`。`docs/images/*.png` 当前同样被 `*.png` 忽略规则覆盖，提交演示图前请在 `.gitignore` 中显式放行（例如追加 `!docs/images/`）。
