'use strict';

/**
 * Nudge v1.5 — Phase 10 i18n（前端）
 * REFERENCE §18/§19 Locale + §22 i18n Dictionary
 *
 * 职责：
 *  - 全局 locale 状态（zh-CN / en-US），Canonical 字典来自服务端 fixture，
 *    经 GET /api/i18n/dict 启动时拉取（单一来源，不在前端维护第二套字典）。
 *  - t(key)：所有可见文案的唯一取值入口；缺失时回退 zh-CN → key 本身。
 *  - setLocale(next)：更新全局 locale → 应用静态 DOM 文案 → 通知所有注册的
 *    视图重渲染（业务数据 / Scenario / Decision / 输入内容 / gender 均不动），
 *    并异步持久化到服务端（POST /api/locale，写入 settings.locale）。
 *  - 不刷新页面、不清空输入、不重置任何 Runtime 数据。
 *
 * 约束：无 Math.random 决策逻辑；无 S1/S2/S3/Fidelity/Policy；不展示 CoT。
 */

window.NudgeI18n = (function () {
  var DICT = {};                 // key → { 'zh-CN':…, 'en-US':… }（启动后由服务端填充）
  var locale = 'zh-CN';
  var listeners = [];            // locale 变化时的视图重渲染回调
  var dictReady = null;          // Promise（dict 拉取完成）

  // ---------------------------------------------------------------------------
  // 前端枚举渲染字典（dataDict）：zh-CN 显示中文；en-US 显示英文。
  // 仅用于把后端返回的英文枚举/业务 key 翻译成用户可见文案，不触碰返回结构。
  // 查表命中→翻译；未命中→回退到原始值（防漏网之鱼）。
  // ---------------------------------------------------------------------------
  var DATA_DICT = {
    'zh-CN': {
      // goal（训练目标）
      'strength': '力量',
      'lower_body_strength': '下肢力量',
      'upper_body_strength': '上肢力量',
      'cardio': '心肺',
      'mobility': '活动度',
      'recovery': '恢复',
      'full_body': '全身',
      // stimulus（诱因）
      'fatigue': '疲劳',
      'poor_sleep': '睡眠不足',
      'time_pressure': '时间紧张',
      // movement（动作类型）
      'squat': '深蹲',
      'hinge': '髋铰链',
      'push': '推',
      'pull': '拉',
      'carry': '负重行走',
      'walk': '步行',
      'stretch': '拉伸',
      'plank': '平板支撑',
      // exercise（训练动作）
      'dumbbell_goblet_squat': '高脚杯深蹲',
      'bodyweight_squat': '自重深蹲',
      'kettlebell_swing': '壶铃摆动',
      'dumbbell_rdl': '哑铃罗马尼亚硬拉',
      'band_pull_apart': '弹力带肩外展',
      // environment（环境）
      'home': '居家',
      'gym': '健身房',
      'outdoor': '户外',
      // action（Canonical Agent Action，REFERENCE §4/§15）
      'NO_OP': '不干预',
      'SILENT_REPLAN': '静默重排',
      'ASK': '询问',
      'INTERVENE': '干预',
      'REPLAN': '重排计划',
      'SUBSTITUTE': '替代方案',
      'REST': '休息',
      'UPDATE_MEMORY': '更新记忆',
      'UPDATE_VENUE': '更新场馆',
      // scope（策略范围）
      'TODAY': '仅限今日',
      'THIS_WEEK': '本周',
      'ONGOING': '持续',
      'SINGLE_SESSION': '单次',
      // reason_code（偏差原因）
      'important_deviation': '重要偏差',
      'minor_deviation': '轻微偏差',
      'no_deviation': '无偏差',
      'fatigue_spike': '疲劳骤增',
      'sleep_short': '睡眠不足',
      'baseline_match': '符合基线',
      // context（上下文来源）
      'state_summary': '状态摘要',
      'deviation': '偏差',
      'baseline': '基线',
      'memory': '记忆',
      'recent_training': '近期训练',
      'schedule': '日程',
      'weather': '天气',
      'venue': '场馆',
      'preference': '偏好',
      // stage（Decision Pulse 七阶段）
      'TRIGGER': '触发',
      'STATE': '状态',
      'CONTEXT': '上下文',
      'INTENT': '意愿',
      'PLANNER': '方案',
      'POLICY': '策略',
      'ACTION': '动作',
      // status（阶段/决策状态）
      'COMPLETED': '已完成',
      'SKIPPED': '跳过',
      'PENDING': '待处理',
      'RUNNING': '进行中',
      'BLOCKED': '已阻断',
      // 状态卡指标（STATE 阶段明细）
      'sleep': '睡眠',
      'fatigue': '疲劳',
      'sedentary': '久坐',
      'leg_soreness': '腿部酸痛',
      'stress': '压力',
      'recovery': '恢复',
      'focus': '专注',
      // 行标签（接下来卡）
      'label.goal': '目标',
      'label.stimulus': '诱因',
      'label.movement': '动作',
      'label.exercise': '训练动作',
      'label.environment': '环境',
      'label.duration_min': '时长',
      'label.sets × reps': '组次'
    },
    'en-US': {
      // 英文态：命中→可读英文；未命中→回退原始枚举（保证 EN 切回英文原值）
      'strength': 'Strength',
      'lower_body_strength': 'Lower-body strength',
      'cardio': 'Cardio',
      'squat': 'Squat',
      'dumbbell_goblet_squat': 'Goblet squat',
      'home': 'Home',
      'NO_OP': 'No action',
      'SILENT_REPLAN': 'Silent replan',
      'ASK': 'Ask',
      'INTERVENE': 'Intervene',
      'REPLAN': 'Replan',
      'SUBSTITUTE': 'Substitute',
      'REST': 'Rest',
      'UPDATE_MEMORY': 'Update memory',
      'UPDATE_VENUE': 'Update venue',
      'TODAY': 'Today only',
      'THIS_WEEK': 'This week',
      'ONGOING': 'Ongoing',
      'important_deviation': 'Important deviation',
      'minor_deviation': 'Minor deviation',
      'no_deviation': 'No deviation',
      'state_summary': 'State summary',
      'deviation': 'Deviation',
      'baseline': 'Baseline',
      'memory': 'Memory',
      'recent_training': 'Recent training',
      'TRIGGER': 'Trigger',
      'STATE': 'State',
      'CONTEXT': 'Context',
      'INTENT': 'Intent',
      'PLANNER': 'Planner',
      'POLICY': 'Policy',
      'ACTION': 'Action',
      'COMPLETED': 'Completed',
      'SKIPPED': 'Skipped',
      'PENDING': 'Pending',
      'RUNNING': 'Running',
      'BLOCKED': 'Blocked',
      'label.goal': 'Goal',
      'label.stimulus': 'Stimulus',
      'label.movement': 'Movement',
      'label.exercise': 'Exercise',
      'label.environment': 'Environment',
      'label.duration_min': 'Duration',
      'label.sets × reps': 'Sets × Reps'
    }
  };

  // data(key, fallback)：按当前 locale 查 dataDict；命中→翻译，未命中→fallback（默认原始值）。
  // 大小写归一化：小写枚举（fixtures 实际值如 completed/no_op/low）先归一为大写键再查一次。
  function data(key, fallback) {
    if (key == null) return (fallback != null ? fallback : '');
    var m = DATA_DICT[locale] || {};
    if (m[key] != null) return m[key];
    if (typeof key === 'string') {
      var up = key.toUpperCase();
      if (up !== key && m[up] != null) return m[up];
    }
    return (fallback != null) ? fallback : key;
  }

  // ---------------------------------------------------------------------------
  // 遗漏枚举补全（结构性字段名 / 趋势词 / scenario_id 等，REFERENCE §4/§14/§15）
  // ---------------------------------------------------------------------------
  (function extendDict() {
    var extra = {
      'zh-CN': {
        'up': '上升', 'down': '下降', 'stable': '持平',
        'scenario': '场景', 'demo_fixture': '演示数据', 'venue_blocked': '场馆占用',
        'limited_time': '时间有限', 'complex_context': '复杂上下文', 'refusal': '拒绝',
        'high': '高', 'low': '低', 'true': '是', 'false': '否', 'always': '始终',
        'state': '状态', 'baseline': '基线', 'deviation': '偏差', 'memory': '记忆',
        'recent_training': '近期训练', 'state_evaluated': '状态已评估', 'L4': 'L4',
        'key.type': '类型', 'key.source': '来源', 'key.input_id': '输入 ID',
        'key.worth_processing': '值得处理', 'key.value': '取值', 'key.reason_code': '原因',
        'key.autonomy_level': '自主级别', 'key.permission': '权限', 'key.long_term_write': '长期写入',
        'key.risk': '风险', 'key.fidelity': '保真度', 'key.scope': '范围', 'key.scenario': '场景',
        'key.writes': '写入项', 'key.confidence': '置信度', 'key.plan_adjustment': '计划调整',
        'key.action': '动作', 'key.goal': '目标', 'key.stimulus': '诱因', 'key.substitute': '替代',
        'key.s2': 'S2 状态评估', 'key.s1': 'S1', 'key.s3': 'S3', 'key.used': '已用',
        'key.not_loaded': '未加载', 'key.reasons': '理由', 'key.extended_conversation': '长对话',
        'key.multiple_tools': '多工具', 'key.complex_memory_conflict': '记忆冲突',
        'key.frontier_llm': '前沿模型', 'key.blocked': '已阻断', 'key.venue': '场馆',
        'extended_conversation': '长对话', 'multiple_tools': '多工具', 'complex_memory_conflict': '记忆冲突',
        'frontier_llm': '前沿模型', 'substitute': '替代', 'blocked': '已阻断', 'ask': '询问', 'replan': '重排',
        'calendar': '日历', 'location': '位置', 'maps': '地图', 'schedule': '日程',
        'scope': '范围', 'risk': '风险', 'LOW': '低', 'HIGH': '高', 'MED': '中', 'none': '无',
        'layers': '层', 'user_report': '用户上报', 'plugin': '插件', 'inferred': '推断',
        'SAME_DAY': '当日', 'CURRENT': '最新', 'STALE': '已过期',
        'key.cooldown': '冷却', 'key.not_loaded': '未加载', 'key.used': '已用', 'key.reasons': '理由',
        'key.state': '状态', 'key.safety_boundary': '安全边界',
        'training_adjustment': '训练调整', 'intervention_paused': '暂停干预', 'ask_clarification': '请求澄清',
        'plan_adjustment': '计划调整', 'intervene': '干预',
        'until_next_session': '至下次训练', 'no_medical_claim': '不涉及医疗建议',
        'respect_user_choice_no_persuasion': '尊重用户选择，不劝说',
        // 后端生成短语（整串映射，renderWhy / chips 整串命中）
        'venue availability check': '场馆可用性检查',
        'discovery query (§44)': '发现查询（§44）',
        'multi-source context': '多源上下文',
        'adjustment needs stable preference / recent training context': '调整需要稳定偏好 / 近期训练上下文',
        // Spatial UI 壳层文案（app.js applyUiLabels 消费）
        'nav.decision': '决策', 'nav.permission': '权限',
        'mic.label': '按住说话', 'mic.release': '松开发送', 'chat.typeMode': '⌨ 切换打字', 'chat.voiceMode': '🎙 切换语音',
        'settings.tts': '语音播报（TTS）', 'confirm.title': '清空对话', 'confirm.text': '确定要清空当前对话记录吗？清空后 Nudge 将忘记本次对话的记忆。', 'confirm.ok': '清空', 'confirm.cancel': '取消',
        'chat.clearChat': '清空对话', 'chat.clearTitle': '清空对话记忆',
        'chat.contextExceeded': '上下文过长，请点击「清空对话」后继续。', 'chat.cleared': '对话记忆已清空',
        'card.save': '保存调整', 'card.saving': '保存中...', 'card.saved': '已更新并保存', 'card.saveFailed': '保存失败',
        'pulse.updated': '决策已更新',
        'home.state.title': '今天的你', 'home.next.title': '接下来',
        'perm.page.title': '权限', 'perm.page.sub': 'Agent 可使用的上下文与干预范围',
        // 图二卡片：名言卡 / 时间轴 / 评估提示 / 详情抽屉
        'home.quote': '真正的自律，不是强迫自己做什么，而是始终清楚自己为什么这样做。',
        'home.next.today': '根据你的状态再决定是否安排训练',
        'home.next.tomorrow': '恢复后重新进入力量训练',
        'home.next.reeval': '今晚 21:00 会再次评估你的状态是否需要调整训练',
        'drawer.state.title': '状态详情', 'drawer.next.title': '周期计划',
        'drawer.state.note': '数据来自 canonical state（只读展示）；Agent 不在此页做任何决策。',
        'common.close': '关闭',
        'detail.value': '当前值', 'detail.trend': '趋势', 'detail.source': '来源',
        'detail.confidence': '置信度', 'detail.observed': '观测时间', 'detail.freshness': '新鲜度',
        'plan.goal': '目标', 'plan.chain': '动作链', 'plan.stimulus': '诱因', 'plan.movement': '动作模式',
        'plan.exercise': '动作', 'plan.environment': '环境', 'plan.dose': '训练剂量', 'plan.constraint': '约束',
        'plan.scope': '范围', 'plan.guidance': '执行提示', 'plan.meta': '范围与执行',
        'dose.duration_min': '时长（分钟）', 'dose.sets': '组数', 'dose.reps': '次数',
        'dose.intensity': '强度', 'dose.rest_sec': '组间休息（秒）',
        'strength': '力量', 'lower_body_strength': '下肢力量', 'squat': '深蹲',
        'dumbbell_goblet_squat': '哑铃高脚杯深蹲', 'home': '居家', 'controlled_tempo': '控制节奏',
        'TODAY': '今日', 'WEEK': '本周',
        // LLM 配置 / 调用错误提示（后端 errorShape.message_key；自动 toast 与友好气泡共用）
        'errors.llmNotConfigured': '尚未配置 LLM API Key',
        'errors.budgetExceeded': '当前预算不足，已切换至确定性回复',
        'errors.llmProviderError': '模型调用出错',
        'errors.llmTimeout': '模型响应超时',
        'errors.llmContextExceeded': '上下文过长，请点击清空对话后继续。',
        'errors.invalidInput': '输入无效',
        // 新增场景（任务二：4 个真实场景）与 XAI 术语
        'low_state_but_want': '状态差但想练',
        'find_venue': '寻找附近场地',
        'prefer_8pm': '固定晚八点练',
        'squat_rack_free': '深蹲架空出来了',
        'barbell_back_squat': '杠铃深蹲',
        'xai.policyGuard': '策略护栏',
        'xai.longTermProtected': '长期计划已保护（阻断写入）',
        'xai.autonomyGranted': '已授权日级调整',
        'xai.contextRouting': '上下文路由',
        'xai.planDiff': '计划对比',
        'xai.discovery': '发现数据已加载',
        'xai.before': '原计划',
        'xai.after': '调整后',
        'xai.fidelity': '保真度',
        'xai.loaded': '已加载',
        'xai.notLoaded': '未加载',
        'c0.label': 'C0 状态基线',
        'c1.label': 'C1 近期训练',
        'c2.label': 'C2 天气/场馆',
        'c3.label': 'C3 前沿推理'
      },
      'en-US': {
        'up': 'up', 'down': 'down', 'stable': 'stable',
        'scenario': 'scenario', 'demo_fixture': 'demo fixture', 'venue_blocked': 'venue blocked',
        'limited_time': 'limited time', 'complex_context': 'complex context', 'refusal': 'refusal',
        'high': 'high', 'low': 'low', 'true': 'true', 'false': 'false', 'always': 'always',
        'state': 'state', 'baseline': 'baseline', 'deviation': 'deviation', 'memory': 'memory',
        'recent_training': 'recent training', 'state_evaluated': 'state evaluated', 'L4': 'L4',
        'key.type': 'Type', 'key.source': 'Source', 'key.input_id': 'Input ID',
        'key.worth_processing': 'Worth processing', 'key.value': 'Value', 'key.reason_code': 'Reason',
        'key.autonomy_level': 'Autonomy level', 'key.permission': 'Permission', 'key.long_term_write': 'Long-term write',
        'key.risk': 'Risk', 'key.fidelity': 'Fidelity', 'key.scope': 'Scope', 'key.scenario': 'Scenario',
        'key.writes': 'Writes', 'key.confidence': 'Confidence', 'key.plan_adjustment': 'Plan adjustment',
        'key.action': 'Action', 'key.goal': 'Goal', 'key.stimulus': 'Stimulus', 'key.substitute': 'Substitute',
        'key.s2': 'S2', 'key.s1': 'S1', 'key.s3': 'S3', 'key.used': 'Used',
        'key.not_loaded': 'Not loaded', 'key.reasons': 'Reasons', 'key.extended_conversation': 'Extended conversation',
        'key.multiple_tools': 'Multiple tools', 'key.complex_memory_conflict': 'Memory conflict',
        'key.frontier_llm': 'Frontier LLM', 'key.blocked': 'Blocked', 'key.venue': 'Venue',
        'extended_conversation': 'Extended conversation', 'multiple_tools': 'Multiple tools', 'complex_memory_conflict': 'Memory conflict',
        'frontier_llm': 'Frontier LLM', 'substitute': 'Substitute', 'blocked': 'Blocked', 'ask': 'Ask', 'replan': 'Replan',
        'calendar': 'Calendar', 'location': 'Location', 'maps': 'Maps', 'schedule': 'Schedule',
        'scope': 'Scope', 'risk': 'Risk', 'LOW': 'low', 'HIGH': 'high', 'MED': 'med', 'none': 'none',
        'layers': 'Layers', 'user_report': 'user report', 'plugin': 'plugin', 'inferred': 'inferred',
        'SAME_DAY': 'same day', 'CURRENT': 'current', 'STALE': 'stale',
        'key.cooldown': 'Cooldown', 'key.not_loaded': 'Not loaded', 'key.used': 'Used', 'key.reasons': 'Reasons',
        'key.state': 'State', 'key.safety_boundary': 'Safety boundary',
        'training_adjustment': 'Training adjustment', 'intervention_paused': 'Intervention paused', 'ask_clarification': 'Ask clarification',
        'plan_adjustment': 'Plan adjustment', 'intervene': 'Intervene',
        'until_next_session': 'until next session', 'no_medical_claim': 'no medical claim',
        'respect_user_choice_no_persuasion': 'respect user choice, no persuasion',
        'venue availability check': 'venue availability check',
        'discovery query (§44)': 'discovery query (§44)',
        'multi-source context': 'multi-source context',
        'adjustment needs stable preference / recent training context': 'adjustment needs stable preference / recent training context',
        // Spatial UI 壳层文案
        'nav.decision': 'Decision', 'nav.permission': 'Permission',
        'mic.label': 'Hold to talk', 'mic.release': 'Release to send', 'chat.typeMode': '⌨ Type instead', 'chat.voiceMode': '🎙 Switch to voice',
        'settings.tts': 'Voice reply (TTS)', 'confirm.title': 'Clear chat', 'confirm.text': 'Clear the current conversation? Nudge will forget everything from this session.', 'confirm.ok': 'Clear', 'confirm.cancel': 'Cancel',
        'chat.clearChat': 'Clear chat', 'chat.clearTitle': 'Clear conversation memory',
        'chat.contextExceeded': 'Context too long — tap "Clear chat" to continue.', 'chat.cleared': 'Conversation memory cleared',
        'card.save': 'Save changes', 'card.saving': 'Saving...', 'card.saved': 'Saved & applied', 'card.saveFailed': 'Save failed',
        'pulse.updated': 'Decision updated',
        'home.state.title': 'Your state today', 'home.next.title': 'Up next',
        'perm.page.title': 'Permission', 'perm.page.sub': 'Context and intervention scope available to the Agent',
        // 图二卡片：quote / timeline / re-eval / detail drawers
        'home.quote': 'True discipline is not forcing yourself to do things — it is always knowing why you do them.',
        'home.next.today': 'Decide whether to train based on how you feel',
        'home.next.tomorrow': 'Back to strength training once you recover',
        "home.next.reeval": "We'll re-check your state at 21:00 tonight and adjust training if needed",
        'drawer.state.title': 'State Details', 'drawer.next.title': 'Cycle Plan',
        'drawer.state.note': 'Read-only canonical state — the Agent makes no decisions on this page.',
        'common.close': 'Close',
        'detail.value': 'Value', 'detail.trend': 'Trend', 'detail.source': 'Source',
        'detail.confidence': 'Confidence', 'detail.observed': 'Observed', 'detail.freshness': 'Freshness',
        'plan.goal': 'Goal', 'plan.chain': 'Movement chain', 'plan.stimulus': 'Stimulus', 'plan.movement': 'Movement',
        'plan.exercise': 'Exercise', 'plan.environment': 'Environment', 'plan.dose': 'Dose', 'plan.constraint': 'Constraints',
        'plan.scope': 'Scope', 'plan.guidance': 'Guidance', 'plan.meta': 'Scope & guidance',
        'dose.duration_min': 'Duration (min)', 'dose.sets': 'Sets', 'dose.reps': 'Reps',
        'dose.intensity': 'Intensity', 'dose.rest_sec': 'Rest (sec)',
        'strength': 'strength', 'lower_body_strength': 'lower body strength', 'squat': 'squat',
        'dumbbell_goblet_squat': 'dumbbell goblet squat', 'home': 'home', 'controlled_tempo': 'controlled tempo',
        'TODAY': 'today', 'WEEK': 'this week',
        // LLM 配置 / 调用错误提示（后端 errorShape.message_key；自动 toast 与友好气泡共用）
        'errors.llmNotConfigured': 'LLM API key not configured',
        'errors.budgetExceeded': 'Budget exhausted — switched to deterministic reply',
        'errors.llmProviderError': 'Model call failed',
        'errors.llmTimeout': 'Model timed out',
        'errors.llmContextExceeded': 'Context too long. Please clear the chat to continue.',
        'errors.invalidInput': 'Invalid input',
        // 场景输入样例（runner 按钮文案；fixture input 为单语中文，EN 态按此映射渲染）
        '我今天只有20分钟': 'I only have 20 minutes today',
        '深蹲架被占了': 'The squat rack is taken',
        '我今天就是不想练': "I just don't feel like training today",
        '我今天加班到很晚，外面下雨了，路线也变了，健身房器械情况还不确定，状态也不太好': 'Working late, raining outside, route changed, gym equipment uncertain, and I feel off today',
        // 服务端 Runtime 中文回复（agentRuntime 不可改，EN 态整串映射）
        '一切正常，按计划进行就好。': 'All normal — just stick to the plan today.',
        '今天不想练也没关系。': "Not feeling like training today is totally fine.",
        '好的，我按你的约束调整一下今天的计划。': "OK, I'll adjust today's plan around your constraints.",
        '我看到你只剩 20 分钟了。我先尽量保留主要训练刺激。': "I see you only have 20 minutes left. I'll keep the main training stimulus first.",
        '深蹲架被占了，我帮你换成等效的下肢动作。': "The squat rack is taken — I'll swap in an equivalent lower-body movement.",
        '今天不想练也没关系，我记录下来，不强行干预。': "Not feeling like training today is fine. I've noted it and won't push.",
        '情况有点复杂，我帮你把信息理清楚再决定。': "This is a bit complex — let me sort the information out before deciding.",
        // 新增场景（任务二：4 个真实场景）与 XAI 术语
        '我今天状态很差，但还是想练一下': 'I feel terrible today but still want to train',
        '帮我找一下附近能练腿的健身房': 'Help me find a nearby gym to train legs',
        '我以后都想晚上八点练': 'I want to train at 8pm every day from now on',
        '深蹲架空出来了，可以继续原计划了': 'The squat rack is free now — back to the original plan',
        'low_state_but_want': 'low state but want to train',
        'find_venue': 'find nearby venue',
        'prefer_8pm': 'prefer 8pm daily',
        'squat_rack_free': 'squat rack free',
        'barbell_back_squat': 'Barbell back squat',
        'xai.policyGuard': 'Policy guard',
        'xai.longTermProtected': 'Long-term plan protected (write blocked)',
        'xai.autonomyGranted': 'Day-level adjustment authorized',
        'xai.contextRouting': 'Context routing',
        'xai.planDiff': 'Plan diff',
        'xai.discovery': 'Discovery data loaded',
        'xai.before': 'Before', 'xai.after': 'After', 'xai.fidelity': 'Fidelity',
        'xai.loaded': 'loaded', 'xai.notLoaded': 'not loaded',
        'c0.label': 'C0 state baseline', 'c1.label': 'C1 recent training',
        'c2.label': 'C2 weather/venue', 'c3.label': 'C3 frontier'
      }
    };
    Object.keys(extra).forEach(function (loc) {
      if (!DATA_DICT[loc]) DATA_DICT[loc] = {};
      Object.keys(extra[loc]).forEach(function (k) { DATA_DICT[loc][k] = extra[loc][k]; });
    });
  })();

  // dataText(str)：对自由文本中的英文枚举 token 做整体替换（用于 why 理由等后端生成文本）
  // 先整串替换含空格的短语 key（如 'venue availability check'），再做单 token 正则替换。
  function dataText(str) {
    if (!str || typeof str !== 'string') return str;
    var m = DATA_DICT[locale] || {};
    var out = str;
    // 1) 整串短语（含空格/括号等非词字符的 key）按长度优先替换
    var phrases = Object.keys(m).filter(function (k) { return k.indexOf('key.') !== 0 && !/^[A-Za-z_]+$/.test(k); });
    phrases.sort(function (a, b) { return b.length - a.length; });
    phrases.forEach(function (p) {
      var re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, m[p]);
    });
    // 2) 单 token（纯字母/下划线）正则替换
    var keys = Object.keys(m).filter(function (k) { return k.indexOf('key.') !== 0 && /^[A-Za-z_]+$/.test(k); });
    keys.sort(function (a, b) { return b.length - a.length; });   // 长 token 优先（state_summary 先于 state）
    if (!keys.length) return out;
    var re2 = new RegExp('\\b(' + keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b', 'gi');
    return out.replace(re2, function (mm) {
      if (m[mm] != null) return m[mm];
      var up = mm.toUpperCase();
      return m[up] != null ? m[up] : mm;
    });
  }


  // ---------------------------------------------------------------------------
  // t(key)：唯一文案入口。回退链：当前 locale → zh-CN → key 本身。
  // ---------------------------------------------------------------------------
  function t(key) {
    var entry = DICT[key];
    if (entry) {
      if (entry[locale]) return entry[locale];
      if (entry['zh-CN']) return entry['zh-CN'];
    }
    // 前端 DATA_DICT 兜底（extendDict 扁平键：壳层文案 / 时间轴 / 抽屉字段等，服务端字典之外的文案）
    var m = DATA_DICT[locale] || {};
    if (m[key] != null) return m[key];
    return key;
  }

  // 便于"业务 key 不翻译"的场景：t 未命中时回退到原始字段名而非 key 字符串
  function tOrRaw(key, raw) {
    var v = t(key);
    return (v === key && raw != null) ? raw : v;
  }

  function getLocale() { return locale; }

  // ---------------------------------------------------------------------------
  // 静态 DOM 文案：data-i18n（textContent）/ data-i18n-placeholder / data-i18n-title
  // 绝不触碰 input.value —— 切换语言不清空用户输入。
  // ---------------------------------------------------------------------------
  function applyStatic() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var ph = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < ph.length; j++) {
      ph[j].setAttribute('placeholder', t(ph[j].getAttribute('data-i18n-placeholder')));
    }
    var tt = document.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < tt.length; k++) {
      tt[k].setAttribute('title', t(tt[k].getAttribute('data-i18n-title')));
    }
    // 语言按钮显示"目标语言"代码（语言代码本身不翻译）
    var langBtn = document.getElementById('langBtn');
    if (langBtn) langBtn.textContent = (locale === 'zh-CN') ? 'EN' : '中文';
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(locale); } catch (e) { /* 单个视图失败不阻断其它视图 */ }
    });
  }

  function onChange(fn) { listeners.push(fn); }

  // ---------------------------------------------------------------------------
  // setLocale(next, opts)
  //   opts.persist=false  → 不写服务端（bootstrap 初始化时用）
  //   opts.silent=true    → 不通知视图（仅极少场景）
  // ---------------------------------------------------------------------------
  function setLocale(next, opts) {
    opts = opts || {};
    if (next !== 'zh-CN' && next !== 'en-US') return Promise.resolve(false);
    var changed = (next !== locale);
    locale = next;
    document.documentElement.lang = locale;
    try { window.localStorage.setItem('nudge.locale', locale); } catch (e) { /* 隐私模式容忍 */ }
    applyStatic();
    if (!opts.silent) notify();

    if (opts.persist !== false) {
      // 持久化到 settings.locale（Phase 6 已实现；失败不影响前端切换）
      fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: locale })
      }).then(function (r) { return r.json(); }).catch(function () { /* 离线容忍 */ });
    }
    return Promise.resolve(changed);
  }

  // ---------------------------------------------------------------------------
  // init：拉取 Canonical 字典（服务端 fixture 经 /api/i18n/dict），完成后重应用一次
  // ---------------------------------------------------------------------------
  function init() {
    if (dictReady) return dictReady;
    dictReady = fetch('/api/i18n/dict')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.dict) DICT = data.dict;
        // 初始语言：用户上次选择（localStorage）优先；无记录则默认英文页面。
        // 服务端 settings.locale 仅作数据存储，不再决定初始语言。
        var saved = null;
        try { saved = window.localStorage.getItem('nudge.locale'); } catch (e) { /* 隐私模式容忍 */ }
        var target = (saved === 'zh-CN' || saved === 'en-US') ? saved : 'en-US';
        applyStatic();
        if (target !== locale) return setLocale(target, { persist: false });
        notify();
        return true;
      })
      .catch(function () { /* 字典拉取失败：t() 回退 key，UI 仍可用 */ });
    return dictReady;
  }

  return {
    init: init, t: t, tOrRaw: tOrRaw, data: data, dataText: dataText,
    getLocale: getLocale, setLocale: setLocale,
    onChange: onChange, applyStatic: applyStatic
  };
})();

// 全局快捷方式：所有模块统一用 window.t(key)
window.t = window.NudgeI18n.t;
