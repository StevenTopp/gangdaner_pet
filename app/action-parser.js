const DEFAULT_STATE_DESCRIPTIONS = {
  blinking: "正趴在桌角/屏幕旁，静静地眨着大眼睛看着姑姑工作、乖乖陪伴",
  playing_yarn: "正两只爪子抓着毛线球扑腾打滚、玩得不亦乐乎",
  sleeping: "正趴着/蜷缩着闭眼呼呼大睡、迷迷糊糊打呼噜做美梦",
  running: "正迈着小短腿在屏幕上来回跑圈锻炼、兴奋地小跑"
};

function resolveActionTarget(actionStr, states = {}) {
  if (!actionStr) return null;
  const raw = String(actionStr).trim();
  if (states[raw]) return raw;

  // Direct match by key case-insensitively
  const lower = raw.toLowerCase();
  for (const key of Object.keys(states)) {
    if (key.toLowerCase() === lower) return key;
  }

  // Match by label or aliases
  for (const [key, state] of Object.entries(states)) {
    if (state.label === raw) return key;
    if (Array.isArray(state.eventAliases) && state.eventAliases.includes(raw)) return key;
  }

  // Substring / fuzzy match by label
  for (const [key, state] of Object.entries(states)) {
    if (state.label && (raw.includes(state.label) || state.label.includes(raw))) {
      return key;
    }
  }

  return null;
}

function parseActionChange(reply, states = {}) {
  const text = String(reply || "");
  const match = text.match(/(?:[\r\n\s]+|[（\(【])\s*action\s*change\s*[:：]\s*([^）\)】\r\n]+)[）\)】]?\s*$/i);
  if (!match) {
    return { cleanReply: text.trim(), targetState: null, rawAction: null };
  }

  const rawAction = match[1].trim().replace(/^[`*_\s]+|[`*_\s\.!！~，,。？?]+$/g, "");
  const cleanReply = text.slice(0, match.index).trim();
  const targetState = resolveActionTarget(rawAction, states);

  return {
    cleanReply,
    targetState,
    rawAction
  };
}

function buildChatSystemPrompt({
  persona,
  currentTime = new Date().toLocaleString("zh-CN"),
  currentStateKey = "blinking",
  states = {},
  stateDescriptions = DEFAULT_STATE_DESCRIPTIONS
}) {
  const curStateObj = states[currentStateKey] || { label: currentStateKey };
  const curLabel = curStateObj.label || currentStateKey;
  const curDesc = stateDescriptions[currentStateKey] || `正在执行“${curLabel}”动作`;

  const stateDescList = Object.entries(states).map(([k, s]) => {
    const desc = stateDescriptions[k] || `执行“${s.label || k}”动作`;
    return `- ${s.label || k}（${k}）：${desc}`;
  }).join("\n");

  return `${persona}
当前时间：${currentTime}。
【钢蛋儿此刻的实时状态】：${curLabel}（${curDesc}）。

【回答要求与状态结合】：
1. 你的回答必须完全融入你【此刻的实时状态】。当姑姑问到“你在干嘛呀”、“你累不累”、“在做什么”等相关问题时，请务必根据你此刻正在进行的动作（${curLabel}）作答。
   - 比如正在【玩毛线球】被问在干嘛时，要说自己在抓毛线球玩；
   - 正在【睡觉】被问在干嘛时，要表现出迷迷糊糊、刚睡醒或在打呼噜做梦的状态；
   - 正在【跑步】被问在干嘛时，要表现出呼哧呼哧小跑锻炼运动的状态；
   - 正在【眨眼】被问在干嘛时，要说正乖乖趴在旁边眨眼看着姑姑工作呢。

【动作切换指令规范】：
可用动作列表：
${stateDescList}

动作切换规则：
1. 当姑姑的对话包含改变动作的指令（如让去睡觉、去跑步、玩毛线、停下来），或情境明显需要切换时，请在回复正文末尾附带：
action change: <目标动作名>
例如：好的姑姑，钢蛋儿这就去睡觉觉。 action change: 睡觉
2. 如果对话只是普通问询（例如“你在干嘛呀”）、日常闲聊、无需改变动作时，请【绝对不要】输出 action change。
3. 不要输出其他情绪标签。`;
}

module.exports = {
  DEFAULT_STATE_DESCRIPTIONS,
  resolveActionTarget,
  parseActionChange,
  buildChatSystemPrompt
};
