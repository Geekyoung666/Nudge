'use strict';

// REFERENCE v1.5 §33 LLM Config 默认值 + §34 LLM Budget Object
// 开发阶段默认不配置真实 LLM API Key；此处只提供预算/定价默认值。
// API Key 绝不出现在本文件、不入库、不进日志、不返回前端。
module.exports = {
  // §34 预算（每个访客身份硬上限 0.20 RMB）
  budget_rmb: 0.20,
  // §33 默认配置（provider / pricing 占位，真实 Key 由开发者临时注入）
  provider: 'openai-compatible',
  base_url: '',
  model: '',
  input_rmb_per_m: 1.0,
  output_rmb_per_m: 2.0,
  max_input_tokens: 1200,
  max_output_tokens: 600,
  budget_cap_rmb: 0.20,
  // 开发阶段状态标记
  llm_not_configured: true
};
