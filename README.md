# Nudge v1.5

> **Proactive when it matters.**

个人运动 Agent：以数字人为主要交互入口，基于真实上下文主动判断“现在是否值得干预，以及怎么调整今天的训练”。

本仓库当前为 **Phase 1 — 项目结构与启动** 的最小可运行版本：

- 后端 Express 服务已启动，提供 `GET /api/health` 及业务 API（`/api/interactions`、`/api/bootstrap`、`/api/llm/complete` 等）；
- 前端为数字人交互首页，已实现业务卡片 / 对话 / 设置 / 长按语音等（详见 `public/`）；
- 不接入任何真实外部 API，不配置任何真实 LLM API Key；
- 业务 Runtime / Scenario / Decision Console 在后续 Phase 实现。

## 技术栈

- Node.js **20+**（开发环境 Node 22 已验证）
- Express
- 纯静态前端（HTML / CSS / Vanilla JS），不引入框架
- 后续 Phase 将使用 SQLite（DEMO_MODE）

## 安装

```bash
npm install
```

## 启动

```bash
npm start
```

开发模式（文件改动自动重启）：

```bash
npm run dev
```

## 访问地址

- 首页：<http://localhost:3000/>
- 健康检查：<http://localhost:3000/api/health>

## 首次运行（语音功能）

语音识别使用浏览器端 Whisper tiny（`@xenova/transformers` 运行时库走 jsdelivr CDN，无需本地安装），但**模型权重不入库**（约 42MB）。clone 后需先拉取一次：

```bash
npm run fetch-model
```

脚本会把量化权重下载到 `public/models/Xenova/whisper-tiny/`（应用从同源 `/models/...` 读取）。已存在的文件会自动跳过，可重复执行。之后 `npm start` 即可使用长按语音。

> 若希望 clone 即离线可用、零配置，可把 `public/models/` 从 `.gitignore` 移除并手动提交权重；默认策略为保持仓库干净而选择运行时拉取。

## 执行模式

通过环境变量 `DEMO_MODE` 控制：

| 变量值 | 模式 | 说明 |
| --- | --- | --- |
| 未设置 / `true` | `demo` | 默认。确定性 fixtures，不接任何真实外部 API |
| `false` / `0` | `production_adapter` | 生产适配模式（后续 Phase 用于替换真实 LLM / Weather / Calendar / Maps / Venue / Web Search / MCP adapters） |

```bash
# 默认 demo 模式
npm start

# 显式 demo 模式
DEMO_MODE=true npm start

# 生产适配模式（本 Phase 不加载任何真实适配器）
DEMO_MODE=false npm start
```

## API Key 安全约定（后续 Phase 生效）

- API Key 仅保存在服务端内存或加密临时存储；
- 不写入 SQLite 明文、不写入 localStorage、不进入日志、不返回前端；
- 服务重启后 API Key 自动失效，需重新配置；
- 单访客 LLM 生成预算硬上限 **¥0.20**。

## 目录结构（当前）

```text
/nudge
  package.json              # Express 依赖与启动脚本
  README.md
  NUDGE_SYSTEM_PROMPT.md    # LLM 系统提示词规范（v1.2，运行时使用 server/fixtures/llmPrompt.js 内嵌副本）
  server/
    index.js                # Express 入口 + /api/health
    db/                     # SQLite schema 与访问层
    routes/                 # API 路由
    runtime/                # Agent Runtime（权限 / 预算 / 决策边界）
    tools/                  # 工具与适配器（weather / calendar / maps / venue / llm / budget…）
    fixtures/               # DEMO_MODE 确定性 fixtures + 内嵌 System Prompt
  public/
    index.html              # 前端首页（数字人 / 卡片）
    assets/                 # 静态资源（模型 / 图片等）
    models/                 # 前端模型 / 数据
    scripts/                # 前端逻辑（home / voice / text / app / i18n / error / console）
    styles/                 # 前端样式
  docs/
    reports/                # Phase 交付与验收报告（历史归档）
```

> 说明：`node_modules/`、`nudge.db`、设计截图（`UI_*.png`）、工作区内部配置（`.cloudstudio`、`.templates/`、`.codebuddy/`、`.genie/`）均不入库，见 `.gitignore`。

