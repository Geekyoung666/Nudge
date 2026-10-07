'use strict';

// REFERENCE v1.5 §22 i18n Dictionary — key → { 'zh-CN', 'en-US' }
// 所有可见文案通过 t(key) 获取，禁止在前端硬编码第二套语言。
// 此 fixture 为 Canonical 字典来源：服务端经 GET /api/i18n/dict 下发，前端 NudgeI18n 消费。
//
// 约定：
//  - 业务 key 不翻译（goal / stimulus / movement / exercise / environment / dose.* 等
//    Canonical 字段名在两种 locale 下都以英文原样展示）。
//  - State 指标属于展示标签（State labels），提供翻译；数据 key 本身不变。

module.exports = {
  // ---- 导航 / Top Bar ----
  'nav.home':              { 'zh-CN': '主页', 'en-US': 'Home' },
  'nav.memory':            { 'zh-CN': '记忆', 'en-US': 'Memory' },
  'nav.decision':          { 'zh-CN': '决策', 'en-US': 'Decision' },
  'nav.permission':        { 'zh-CN': '权限', 'en-US': 'Permissions' },
  'nav.settings':          { 'zh-CN': '设置', 'en-US': 'Settings' },
  'nav.language.title':    { 'zh-CN': '切换语言（不刷新页面）', 'en-US': 'Switch language (no reload)' },
  'gender.title':          { 'zh-CN': '切换数字人形象（仅展示，不重建实例）', 'en-US': 'Switch avatar presentation (instance is reused)' },
  'mic.title':             { 'zh-CN': '语音输入（点击后浏览器会请求麦克风权限）', 'en-US': 'Voice input (the browser will ask for mic permission)' },

  // ---- Home ----
  'home.today':            { 'zh-CN': '今天的你', 'en-US': 'Today' },
  'home.state':            { 'zh-CN': '状态', 'en-US': 'State' },
  'home.next':             { 'zh-CN': '下一步', 'en-US': 'Next' },
  'home.empty.state':      { 'zh-CN': '暂无状态数据', 'en-US': 'No state data' },
  'home.empty.plan':       { 'zh-CN': '暂无计划', 'en-US': 'No plan yet' },

  // State labels（展示标签；数据 key 保持英文）
  'state.sleep':           { 'zh-CN': '睡眠', 'en-US': 'Sleep' },
  'state.fatigue':         { 'zh-CN': '疲劳', 'en-US': 'Fatigue' },
  'state.sedentary':       { 'zh-CN': '久坐', 'en-US': 'Sedentary' },
  'state.leg_soreness':    { 'zh-CN': '腿部酸痛', 'en-US': 'Leg soreness' },

  // ---- 对话 / Voice ----
  'chat.placeholder':      { 'zh-CN': '说点什么…（回车发送）', 'en-US': 'Say something… (Enter to send)' },
  'chat.send':             { 'zh-CN': '发送', 'en-US': 'Send' },
  'chat.you':              { 'zh-CN': '你', 'en-US': 'You' },
  'chat.agent':            { 'zh-CN': 'Nudge', 'en-US': 'Nudge' },
  'chat.noReply':          { 'zh-CN': '（无回复）', 'en-US': '(No reply)' },
  'chat.connFailed':       { 'zh-CN': '（连接失败）', 'en-US': '(Connection failed)' },
  'chat.welcome':          { 'zh-CN': '你好，我是 Nudge。说说你今天的状态，或点左侧场景看我的决策过程。', 'en-US': "Hi, I'm Nudge. Tell me how you feel today, or run a scenario on the left to see my reasoning." },
  'voice.hint.initial':    { 'zh-CN': '点击 🎙 说话；若浏览器不支持或拒绝权限，文字输入始终可用。', 'en-US': 'Click 🎙 to speak. Text input always works if unsupported or denied.' },
  'voice.hint.listening':  { 'zh-CN': '正在聆听…说完自动发送。', 'en-US': 'Listening… will send when you finish.' },
  'voice.hint.noSpeech':   { 'zh-CN': '没有检测到语音，可继续文字输入或重试。', 'en-US': 'No speech detected. Type instead or retry.' },
  'voice.hint.denied':     { 'zh-CN': '麦克风权限被拒绝，文字输入仍可使用。', 'en-US': 'Microphone denied. Text input still works.' },
  'voice.hint.unavailable':{ 'zh-CN': '语音识别暂时不可用，文字输入仍可使用。', 'en-US': 'Speech recognition unavailable. Text input still works.' },
  'voice.hint.startFail':  { 'zh-CN': '语音识别启动失败，文字输入仍可使用。', 'en-US': 'Failed to start speech recognition. Text input still works.' },
  'voice.hint.unsupported':{ 'zh-CN': '当前浏览器不支持语音识别，文字输入始终可用。', 'en-US': 'Speech recognition not supported. Text input always works.' },

  // ---- Memory ----
  'memory.title':          { 'zh-CN': '记忆', 'en-US': 'Memory' },
  'memory.sub':            { 'zh-CN': '只读 canonical data（/api/bootstrap）。长期写入由 Policy/Permission 控制，前端不实现。', 'en-US': 'Read-only canonical data (/api/bootstrap). Long-term writes are governed by Policy/Permission on the server.' },
  'memory.empty':          { 'zh-CN': '暂无记忆条目。', 'en-US': 'No memory entries.' },

  // ---- Settings / Permission ----
  'settings.title':        { 'zh-CN': '设置', 'en-US': 'Settings' },
  'settings.sub':          { 'zh-CN': '只读 canonical data（/api/bootstrap）。', 'en-US': 'Read-only canonical data (/api/bootstrap).' },
  'settings.prefs':        { 'zh-CN': '偏好', 'en-US': 'Preferences' },
  'settings.locale':       { 'zh-CN': '语言', 'en-US': 'Language' },
  'settings.activeIntervention': { 'zh-CN': '主动干预', 'en-US': 'Active intervention' },
  'settings.maxDaily':     { 'zh-CN': '每日上限', 'en-US': 'Daily cap' },
  'settings.voiceInput':   { 'zh-CN': '语音输入', 'en-US': 'Voice input' },
  'settings.perms':        { 'zh-CN': '权限', 'en-US': 'Permissions' },
  'perm.trainingAdjustment': { 'zh-CN': '训练调整', 'en-US': 'Training adjustment' },
  'perm.activeIntervention': { 'zh-CN': '主动干预', 'en-US': 'Active intervention' },
  'perm.calendar':         { 'zh-CN': '日历', 'en-US': 'Calendar' },
  'perm.location':         { 'zh-CN': '位置', 'en-US': 'Location' },
  'perm.weather':          { 'zh-CN': '天气', 'en-US': 'Weather' },
  'perm.maps':             { 'zh-CN': '地图', 'en-US': 'Maps' },
  'perm.venue':            { 'zh-CN': '场地', 'en-US': 'Venue' },
  'perm.allowed':          { 'zh-CN': '允许', 'en-US': 'Allowed' },
  'perm.denied':           { 'zh-CN': '未授权', 'en-US': 'Not allowed' },
  'perm.perDay':           { 'zh-CN': '/天', 'en-US': '/day' },
  'common.on':             { 'zh-CN': '开', 'en-US': 'On' },
  'common.off':            { 'zh-CN': '关', 'en-US': 'Off' },
  'common.back':           { 'zh-CN': '← 返回主页', 'en-US': '← Back to Home' },

  // ---- Decision Console ----
  'console.title':         { 'zh-CN': '决策控制台', 'en-US': 'Decision Console' },
  'console.hint':          { 'zh-CN': '只读 decision_events', 'en-US': 'read-only decision_events' },
  'runner.title':          { 'zh-CN': '运行场景', 'en-US': 'Run scenario' },
  'pulse.done':            { 'zh-CN': '⌁ 决策已更新', 'en-US': '⌁ decision updated' },
  'trace.summary':         { 'zh-CN': '决策摘要', 'en-US': 'Decision trace' },
  'trace.decision':        { 'zh-CN': '决策', 'en-US': 'Decision' },
  'trace.why':             { 'zh-CN': '为什么', 'en-US': 'Why' },
  'trace.confidence':      { 'zh-CN': '置信度', 'en-US': 'Confidence' },
  'trace.contextUsed':     { 'zh-CN': '已加载上下文', 'en-US': 'Context used' },
  'trace.contextNotLoaded':{ 'zh-CN': '未加载上下文', 'en-US': 'Not loaded' },
  'trace.action':          { 'zh-CN': '动作', 'en-US': 'Action' },
  'trace.policyScope':     { 'zh-CN': '策略范围', 'en-US': 'Policy scope' },
  'history.title':         { 'zh-CN': '历史回放', 'en-US': 'Replay' },
  'history.empty':         { 'zh-CN': '暂无决策记录。', 'en-US': 'No decisions yet.' },
  'console.empty':         { 'zh-CN': '运行一个场景，或点击下方历史回放。', 'en-US': 'Run a scenario, or replay from history below.' },
  'stage.trigger':         { 'zh-CN': '触发', 'en-US': 'Trigger' },
  'stage.state':           { 'zh-CN': '状态', 'en-US': 'State' },
  'stage.context':         { 'zh-CN': '上下文', 'en-US': 'Context' },
  'stage.intent':          { 'zh-CN': '意图', 'en-US': 'Intent' },
  'stage.planner':         { 'zh-CN': '计划', 'en-US': 'Planner' },
  'stage.policy':          { 'zh-CN': '策略', 'en-US': 'Policy' },
  'stage.action':          { 'zh-CN': '动作', 'en-US': 'Action' },

  // ---- Error / fallback ----
  'errors.toolUnavailable':{ 'zh-CN': '工具暂不可用', 'en-US': 'Tool temporarily unavailable' },
  'errors.internal':       { 'zh-CN': '服务异常', 'en-US': 'Internal error' },
  'errors.invalidInput':   { 'zh-CN': '输入无效', 'en-US': 'Invalid input' },
  'errors.budgetExceeded': { 'zh-CN': '生成预算已用尽', 'en-US': 'LLM budget exceeded' },
  'errors.llmNotConfigured': { 'zh-CN': 'LLM 未配置', 'en-US': 'LLM not configured' },
  'errors.llmProviderError': { 'zh-CN': 'LLM 上游调用失败', 'en-US': 'LLM provider error' },
  'errors.notFound':       { 'zh-CN': '未找到', 'en-US': 'Not found' }
};
