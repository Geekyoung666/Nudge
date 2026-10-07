'use strict';

// REFERENCE §18 / §19 Locale — 改变 locale 不改变业务数据（只写入 settings.locale，持久化）
// REFERENCE §22 i18n — 字典 Canonical 来源为 server/fixtures/i18n.js，经 /api/i18n/dict 下发前端
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const { errorShape } = require('./common');
const I18N_FIXTURE = require('../fixtures/i18n');

router.get('/api/locale', (req, res) => {
  repository.ensureDemoData();
  const s = repository.getSettings(repository.DEMO_USER);
  res.json({ locale: s.locale });
});

router.post('/api/locale', (req, res) => {
  const { locale } = req.body || {};
  if (!['zh-CN', 'en-US'].includes(locale)) {
    return res.status(400).json(errorShape('INVALID_INPUT', 'errors.invalidInput', false, { field: 'locale' }));
  }
  const updated = repository.updateSettings(repository.DEMO_USER, { locale });
  res.json({ locale: updated.locale, settings: { locale: updated.locale } });
});

// 全量字典（两种 locale），前端 NudgeI18n 启动时拉取并缓存
router.get('/api/i18n/dict', (req, res) => {
  repository.ensureDemoData();
  const s = repository.getSettings(repository.DEMO_USER);
  res.json({ locale: s.locale, dict: I18N_FIXTURE });
});

module.exports = router;
