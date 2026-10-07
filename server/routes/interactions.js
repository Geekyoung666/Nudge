'use strict';

/**
 * Nudge v1.5 — Phase 4 · Interaction route（接入同一 Agent Runtime）
 * REFERENCE §19 Interaction
 */

const express = require('express');
const router = express.Router();
const repository = require('../db/repository');
const runtime = require('../runtime/agentRuntime');
const { errorShape } = require('./common');

router.post('/api/interactions', (req, res) => {
  const { session_id, message, input_type } = req.body || {};
  repository.ensureDemoData();

  const interaction_id = 'interaction_' + Date.now();
  repository.insertInteractionEvent({
    id: interaction_id,
    user_id: repository.DEMO_USER,
    type: input_type || 'text',
    payload_json: { session_id: session_id || null, message: message || '' }
  });

  try {
    const result = runtime.run(
      { message, input_type, input_id: interaction_id },
      { userId: repository.DEMO_USER, visitorId: req.visitorId }
    );
    res.json({
      interaction_id,
      reply: result.reply,
      decision: result.decision,
      state: result.state,
      plan: result.plan,
      memory: repository.listMemory(repository.DEMO_USER),   // AGENTS §9：response 必须含 memory
      agent_state: result.agent_state,
      discovery: result.discovery,
      context: result.context,
      llm_enhancement: result.llm_enhancement,
      events: result.events
    });
  } catch (err) {
    res.status(500).json(errorShape('INTERNAL_ERROR', 'errors.internal', true));
  }
});

module.exports = router;
