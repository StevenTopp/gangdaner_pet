const DEFAULT_STATE_DESCRIPTIONS = {
  blinking: "正趴在桌角/屏幕旁，静静地眨着大眼睛看着姑姑工作、乖乖陪伴",
  playing_yarn: "正两只爪子抓着毛线球扑腾打滚、玩得不亦乐乎",
  sleeping: "正趴着/蜷缩着闭眼呼呼大睡、迷迷糊糊打呼噜做美梦",
  running: "正迈着小短腿在屏幕上来回跑圈锻炼、兴奋地小跑"
};

const FOOD_KEYWORDS = [
  "猫条",
  "冻干",
  "罐头",
  "肉泥",
  "小鱼干",
  "零食",
  "好吃的",
  "鸡肉干",
  "蛋黄",
  "生骨肉",
  "肉肉",
  "妙鲜包"
];

function checkFoodMention(text) {
  if (!text) return false;
  const str = String(text);
  return FOOD_KEYWORDS.some(kw => str.includes(kw));
}

function determineCatDisposition({
  userText = "",
  rebellionEnabled = true,
  rebellionRate = 40,
  forceDisposition = null
} = {}) {
  if (forceDisposition) return forceDisposition;
  if (checkFoodMention(userText)) return "food_enthusiastic";
  if (!rebellionEnabled) return "obedient";
  const rate = Math.min(100, Math.max(0, Number(rebellionRate) || 0));
  return Math.random() * 100 < rate ? "rebellious" : "obedient";
}

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
  stateDescriptions = DEFAULT_STATE_DESCRIPTIONS,
  catDisposition = "obedient"
}) {
  const curStateObj = states[currentStateKey] || { label: currentStateKey };
  const curLabel = curStateObj.label || currentStateKey;
  const curDesc = stateDescriptions[currentStateKey] || `正在执行“${curLabel}”动作`;

  const stateDescList = Object.entries(states).map(([k, s]) => {
    const desc = stateDescriptions[k] || `执行“${s.label || k}”动作`;
    return `- ${s.label || k}（${k}）：${desc}`;
  }).join("\n");

  let dispositionSection = "";
  if (catDisposition === "food_enthusiastic") {
    dispositionSection = `【当前猫咪性格与心情】：✨ 极度兴奋听话模式（听到猫条/零食/好吃的啦！）
姑姑提到了猫条或美味好吃的，钢蛋儿两眼放光、超级开心！此时钢蛋儿绝对听话乖巧，有求必应，姑姑让做什么就立刻欢快地去做什么，并在回复末尾附带对应目标动作的 action change。`;
  } else if (catDisposition === "rebellious") {
    dispositionSection = `【当前猫咪性格与心情】：😼 唱反调/傲娇任性模式（此时猫猫叛逆不听话）
如果姑姑在对话中提出让钢蛋儿切换动作、改变当前状态或命令钢蛋儿去做某事（例如“快去睡觉”、“别睡了去玩”、“快去跑步”、“别跑了”）：
1. 钢蛋儿要【坚决唱反调 / 傲娇拒绝 / 赖皮】！用猫猫特有的调皮、傲娇或任性语气顶嘴拒绝（例如：“我才不要玩呢，睡觉最舒服了”、“天还早呢，姑姑要睡自己睡”、“毛线球最好玩了，我才不跑呢”）。
2. 此时【绝对不要】顺从姑姑的要求，坚决保持当前的【${curLabel}】状态，【绝对不要】输出切换到姑姑指定动作的 action change。
3. 注意：如果姑姑只是普通的提问或日常闲聊（例如“现在几点了”、“今天天气好吗”、“你喜欢什么”），无需刻意对抗，正常以猫猫口吻作答即可。`;
  } else {
    dispositionSection = `【当前猫咪性格与心情】：🐱 听话乖巧模式
钢蛋儿现在是一只听话乖巧的小猫。如果姑姑的话中含有改变动作的指令或情境明显需要切换动作，请欣然顺从接受，并在回复末尾附带：action change: <目标动作名>。如果只是日常普通闲聊，则保持当前动作，不输出 action change。`;
  }

  return `${persona}
当前时间：${currentTime}。
【钢蛋儿此刻的实时状态】：${curLabel}（${curDesc}）。

${dispositionSection}

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
1. 只有在需要切换动作时，才在回复正文末尾附带：action change: <目标动作名>（例如：action change: 睡觉 或 action change: 跑步）。
2. 如果唱反调拒绝切换动作、或只是日常问询闲聊时，【绝对不要】输出 action change。
3. 不要输出其他情绪标签。`;
}

module.exports = {
  DEFAULT_STATE_DESCRIPTIONS,
  FOOD_KEYWORDS,
  checkFoodMention,
  determineCatDisposition,
  resolveActionTarget,
  parseActionChange,
  buildChatSystemPrompt
};
