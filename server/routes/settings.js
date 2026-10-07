'use strict';

// REFERENCE §18 Settings — GET + PATCH（locale 是 presentation setting）
// PATCH 支持：locale / active_intervention（-> active_intervention_enabled）/ max_daily_interventions / voice_input_enabled
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');

function settingView(s) {
  if (!s) return {};
  return {
    locale: s.locale,
    active_intervention_enabled: !!s.active_intervention_enabled,
    max_daily_interventions: s.max_daily_interventions,
    voice_input_enabled: !!s.voice_input_enabled
  };
}

router.get('/api/settings', (req, res) => {
  repository.ensureDemoData();
  res.json({ settings: settingView(repository.getSettings(repository.DEMO_USER)) });
});

router.patch('/api/settings', (req, res) => {
  const patch = req.body || {};
  const normalized = {};
  if (patch.locale !== undefined) normalized.locale = patch.locale;
  if (patch.max_daily_interventions !== undefined) normalized.max_daily_interventions = patch.max_daily_interventions;
  if (patch.voice_input_enabled !== undefined) normalized.voice_input_enabled = patch.voice_input_enabled;
  // active_intervention 是 Canonical 顶层键，映射到 active_intervention_enabled
  if (patch.active_intervention !== undefined) normalized.active_intervention_enabled = patch.active_intervention;
  if (patch.active_intervention_enabled !== undefined) normalized.active_intervention_enabled = patch.active_intervention_enabled;

  const updated = repository.updateSettings(repository.DEMO_USER, normalized);
  res.json({ settings: settingView(updated) });
});

module.exports = router;
