'use strict';

// REFERENCE §10 Venue Feedback
// 单次反馈只写 availability，绝不改写 facilities.exists（约束 #11，前端不得更新 Venue existence）
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const { errorShape } = require('./common');

router.post('/api/venue/feedback', (req, res) => {
  const { venue_id, facility, status, source } = req.body || {};
  if (!venue_id || !facility || !status) {
    return res.status(400).json(errorShape('INVALID_INPUT', 'errors.invalidInput', false, { fields: 'venue_id,facility,status' }));
  }
  repository.ensureDemoData();
  const venue = repository.getVenue(venue_id);
  if (!venue) return res.status(404).json(errorShape('NOT_FOUND', 'errors.notFound', false, { venue_id }));
  const obs = repository.insertVenueObservation({
    id: 'vo_' + Date.now(),
    venue_id,
    facility,
    status,
    observed_at: new Date().toISOString(),
    source: source || 'user_report',
    confidence: 0.9
  });
  // 只写 availability，绝不改写 facilities.exists
  const after = repository.getVenue(venue_id);
  res.json({ ok: true, observation: obs, venue: { venue_id, facilities: after.facilities, availability: after.availability } });
});

module.exports = router;
