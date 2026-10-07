'use strict';

/**
 * Nudge v1.5 — Phase 1 entry point.
 *
 * 本阶段只建立最小可运行项目：
 *  - 启动 Express
 *  - 提供统一健康检查 GET /api/health
 *  - 不实现业务 Runtime / Scenario / Decision Console
 *
 * 执行模式仅由环境变量控制：
 *  - DEMO_MODE=true  （默认）确定性 fixtures，不接任何真实外部 API
 *  - DEMO_MODE=false 生产适配模式（本阶段不加载任何真实适配器）
 *
 * 工程约束（保持前置）：
 *  - 不接任何真实外部 API
 *  - 不配置真实 LLM API Key
 *  - 不向浏览器返回 stack trace / API Key
 *  - 所有 API 返回 JSON，统一 error shape
 */

const path = require('path');
const express = require('express');

// Phase 2：启动时确保数据库与表结构就绪（不配置任何真实外部 API / LLM Key）。
const repository = require('./db/repository');
repository.initializeDatabase();
repository.ensureDemoData();

const { visitorMiddleware, errorShape } = require('./routes/common');

const PORT = Number(process.env.PORT) || 3000;

// DEMO_MODE 默认开启；只有显式置为 false / 0 才进入生产适配模式。
const DEMO_MODE = !['false', '0', 'no'].includes(String(process.env.DEMO_MODE).toLowerCase());
const MODE = DEMO_MODE ? 'demo' : 'production_adapter';

const app = express();

app.use(express.json());

// 静态首页（空壳，业务卡片在后续 Phase 实现）。
app.use(express.static(path.join(__dirname, '..', 'public')));

// Phase 12 修复：浏览器自动请求 /favicon.ico，无文件时 404 会在 Console 留下
// error 噪音（验收 B 项要求页面无 JS/资源错误）。204 No Content 静默处理。
app.get('/favicon.ico', function (req, res) { res.status(204).end(); });

// 访客身份（httpOnly cookie，不落 localStorage）；所有 /api 均可读 req.visitorId
app.use('/api', visitorMiddleware);

// ---------------------------------------------------------------------------
// Phase 3 API 路由挂载（顺序无关，均为显式路径）
// ---------------------------------------------------------------------------
app.use(require('./routes/bootstrap'));
app.use(require('./routes/state'));
app.use(require('./routes/memory'));
app.use(require('./routes/permissions'));
app.use(require('./routes/settings'));
app.use(require('./routes/locale'));
app.use(require('./routes/scenarios'));
app.use(require('./routes/decisions')); // Phase 4：Runtime 驱动的 /api/decisions/run（置于 decision 之前以覆盖占位）
app.use(require('./routes/decision'));
app.use(require('./routes/interactions'));
app.use(require('./routes/demo'));
app.use(require('./routes/venue'));
app.use(require('./routes/discovery'));
app.use(require('./routes/llm'));

// ---------------------------------------------------------------------------
// 健康检查
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    product: 'nudge',
    version: '1.5.0',
    mode: MODE,
    demo_mode: DEMO_MODE,
    llm_configured: false,
    database: 'ready',
    timestamp: new Date().toISOString()
  });
});

// 未知 /api 路由：统一 error shape
app.use('/api', (req, res) => {
  res.status(404).json(errorShape('NOT_FOUND', 'errors.notFound', false));
});

// ---------------------------------------------------------------------------
// 统一错误处理（不暴露 stack trace，统一 error shape）
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json(errorShape('INTERNAL_ERROR', 'errors.internal', true));
});

app.listen(PORT, () => {
  // 仅打印启动信息，不打印任何密钥 / 内部状态。
  console.log(`[Nudge] server listening on http://localhost:${PORT} (mode=${MODE})`);
});

module.exports = app;
