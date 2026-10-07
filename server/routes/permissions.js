'use strict';

// REFERENCE §17 Permission — GET + PATCH
// PATCH 支持 Canonical 嵌套结构（training_adjustment / active_intervention / calendar / location / weather / maps / venue）
// 以及扁平别名（*_enabled / *_autonomy_level / *_max_per_day），统一映射到权限表列。
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

router.get('/api/permissions', (req, res) => {
  repository.ensureDemoData();
  res.json({ permissions: permView(repository.getPermissions(repository.DEMO_USER)) });
});

router.patch('/api/permissions', (req, res) => {
  const updated = repository.updatePermissions(repository.DEMO_USER, req.body || {});
  res.json({ permissions: permView(updated) });
});

module.exports = router;
