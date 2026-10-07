'use strict';

// REFERENCE §19 Bootstrap — 聚合返回 user / state / plan / memory / permissions / settings / locale
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');

function permView(p) {
  if (!p) return {};
  return {
    training_adjustment: { enabled: !!p.training_adjustment_enabled, autonomy_level: p.training_adjustment_autonomy_level },
    active_intervention: { enabled: !!p.active_intervention_enabled, max_per_day: p.active_intervention_max_per_day },
    calendar: { enabled: !!p.calendar_enabled },
    location: { enabled: !!p.location_enabled },
    weather: { enabled: !!p.weather_enabled },
    maps: { enabled: !!p.maps_enabled },
    venue: { enabled: !!p.venue_enabled }
  };
}

function settingView(s) {
  if (!s) return {};
  return {
    locale: s.locale,
    active_intervention_enabled: !!s.active_intervention_enabled,
    max_daily_interventions: s.max_daily_interventions,
    voice_input_enabled: !!s.voice_input_enabled
  };
}

router.get('/api/bootstrap', (req, res) => {
  repository.ensureDemoData();
  const uid = repository.DEMO_USER;
  const user = repository.getUser(uid);
  const state = repository.getLatestState(uid);
  const plan = repository.getActivePlan(uid);
  const memory = repository.listMemory(uid);
  const perms = repository.getPermissions(uid);
  const settings = repository.getSettings(uid);
  res.json({
    user: { id: uid, identity_type: user ? user.identity_type : 'demo' },
    state: state ? state.state : {},
    plan: plan || {},
    memory,
    permissions: permView(perms),
    settings: settingView(settings),
    locale: settings ? settings.locale : 'zh-CN',
    digital_human: { gender: 'female', state: 'IDLE' }
  });
});

module.exports = router;
