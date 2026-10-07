'use strict';

// REFERENCE §5 State — 返回最新 canonical state 快照
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const { errorShape } = require('./common');

router.get('/api/state', (req, res) => {
  repository.ensureDemoData();
  const s = repository.getLatestState(repository.DEMO_USER);
  if (!s) return res.status(404).json(errorShape('NOT_FOUND', 'errors.notFound', false));
  res.json({ snapshot_at: s.snapshot_at, source: s.source, state: s.state });
});

module.exports = router;
