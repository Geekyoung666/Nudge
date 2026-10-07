-- Nudge v1.5 canonical schema
-- Canonical Source: Nudge_REFERENCE_v1.5.md §26 (DB Minimum Schema) + §33-35 (LLM budget/usage)
-- 字段与 REFERENCE Canonical Schema 对齐。
-- 最小数据原则：不采集姓名 / 手机号 / 身份证 / 精确地址（仅匿名 demo_user_001）。
-- API Key 绝不入库（仅服务端内存 / 加密临时存储）。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  identity_type TEXT NOT NULL DEFAULT 'demo',
  created_at    TEXT NOT NULL
);

-- §5 State：整份 canonical state 作为 payload_json 存储，保留所有指标与 freshness/confidence
CREATE TABLE IF NOT EXISTS state_snapshots (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  source      TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §6 Goal 层级（长期目标）
CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  goal        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §7 Canonical Plan Object
CREATE TABLE IF NOT EXISTS training_plans (
  plan_id      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  scope        TEXT NOT NULL,
  goal         TEXT,
  stimulus     TEXT,
  movement     TEXT,
  exercise     TEXT,
  environment  TEXT,
  dose_json    TEXT,
  constraint_json TEXT,
  fidelity     REAL,
  guidance     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §29 Persistence Versioning：每次计划变更不覆盖历史，生成 plan_adjustment
CREATE TABLE IF NOT EXISTS plan_adjustments (
  plan_adjustment_id TEXT PRIMARY KEY,
  previous_plan_id   TEXT,
  new_plan_id        TEXT NOT NULL,
  decision_id        TEXT,
  scenario_id        TEXT,
  scope              TEXT,
  reason_code        TEXT,
  payload_json       TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY (new_plan_id) REFERENCES training_plans(plan_id)
);

-- §9 Memory Schema（长期写入受 Policy / Permission 控制）
CREATE TABLE IF NOT EXISTS memory_items (
  memory_id  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT,
  source     TEXT,
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §10 Venue：facilities / availability 分别存储，exists != availability
CREATE TABLE IF NOT EXISTS venues (
  venue_id        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  location        TEXT,
  facilities_json TEXT,
  availability_json TEXT,
  evidence_json   TEXT,
  confidence      REAL,
  created_at      TEXT NOT NULL
);

-- §10 venue_observation：单次现场反馈只写 availability，绝不改写 facility.exists
CREATE TABLE IF NOT EXISTS venue_observations (
  id          TEXT PRIMARY KEY,
  venue_id    TEXT NOT NULL,
  facility    TEXT NOT NULL,
  status      TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source      TEXT,
  confidence  REAL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(venue_id)
);

-- §17 Permission Schema
CREATE TABLE IF NOT EXISTS permissions (
  user_id                   TEXT PRIMARY KEY,
  training_adjustment_enabled INTEGER NOT NULL DEFAULT 1,
  training_adjustment_autonomy_level TEXT NOT NULL DEFAULT 'L4',
  active_intervention_enabled INTEGER NOT NULL DEFAULT 1,
  active_intervention_max_per_day INTEGER NOT NULL DEFAULT 1,
  calendar_enabled          INTEGER NOT NULL DEFAULT 0,
  location_enabled          INTEGER NOT NULL DEFAULT 0,
  weather_enabled           INTEGER NOT NULL DEFAULT 0,
  maps_enabled              INTEGER NOT NULL DEFAULT 0,
  venue_enabled             INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §18 Settings Schema（locale 是 presentation setting）
CREATE TABLE IF NOT EXISTS settings (
  user_id                 TEXT PRIMARY KEY,
  locale                  TEXT NOT NULL DEFAULT 'zh-CN',
  active_intervention_enabled INTEGER NOT NULL DEFAULT 1,
  max_daily_interventions INTEGER NOT NULL DEFAULT 1,
  voice_input_enabled     INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §26 Event 最小字段
CREATE TABLE IF NOT EXISTS interaction_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §21 Audit / Decision Event
CREATE TABLE IF NOT EXISTS decision_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  decision_id TEXT,
  scenario_id TEXT,
  created_at  TEXT NOT NULL,
  trigger_type TEXT,
  context_used_json TEXT,
  context_not_loaded_json TEXT,
  action      TEXT,
  policy_scope TEXT,
  result      TEXT,
  payload_json TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §19 Deviation（单次偏差 != long-term memory）
CREATE TABLE IF NOT EXISTS deviations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  type        TEXT,
  reason      TEXT,
  payload_json TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- §33-35 LLM Budget / Usage。仅预算与用量；API Key 不在此处、不入库。
CREATE TABLE IF NOT EXISTS llm_visitor_budgets (
  visitor_id    TEXT PRIMARY KEY,
  budget_rmb    REAL NOT NULL DEFAULT 0.20,
  reserved_rmb  REAL NOT NULL DEFAULT 0.0,
  spent_rmb     REAL NOT NULL DEFAULT 0.0,
  remaining_rmb REAL NOT NULL DEFAULT 0.20,
  hard_stop     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_usage_records (
  id          TEXT PRIMARY KEY,
  visitor_id  TEXT NOT NULL,
  provider    TEXT,
  model       TEXT,
  estimated_cost_rmb REAL,
  actual_cost_rmb    REAL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  status      TEXT,
  created_at  TEXT NOT NULL
);
