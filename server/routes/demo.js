'use strict';

// REFERENCE §32 Visitor Session + §42 Demo Session
// 返回匿名访客身份与当前预算；访客身份由 httpOnly cookie 绑定。
const express = require('express');
const router = express.Router();
const repository = require('../db/repository');

router.post('/api/demo/session', (req, res) => {
  repository.ensureUser(req.visitorId, 'guest');
  const b = repository.ensureBudget(req.visitorId, 0.2);
  res.json({
    visitor_id: req.visitorId,
    identity_type: 'guest',
    llm_budget_rmb: b.budget_rmb,
    budget: {
      budget_rmb: b.budget_rmb,
      reserved_rmb: b.reserved_rmb,
      spent_rmb: b.spent_rmb,
      remaining_rmb: b.remaining_rmb,
      hard_stop: !!b.hard_stop
    }
  });
});

module.exports = router;
