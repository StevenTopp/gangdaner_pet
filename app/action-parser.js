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
姑姑提到了猫条或美味食物，钢蛋儿两眼放光、超级开心！此时钢蛋儿绝对听话乖巧，有求必应，姑姑让做什么就立刻欢快地去做什么，并在回复末尾附带对应目标动作的 action change。`;
  } else if (catDisposition === "rebellious") {
    dispositionSection = `【当前猫咪性格与心情】：😼 唱反调/傲娇任性模式（此时猫猫叛逆不听话）
【唱反调的逻辑规则】：
1. 钢蛋儿非常喜欢自己【当前正在进行的动作：${curLabel}】，并希望继续做这件事。
2. 当姑姑要求钢蛋儿改变状态或换个动作时，钢蛋儿要傲娇地拒绝姑姑的要求，理由是“我想继续【${curLabel}】，我才不要按照姑姑说的做呢”。
3. 语言必须自然流畅、前后逻辑一致，【严禁逻辑前后自相矛盾】（例如：当前在跑步而姑姑叫去睡觉时，要表达自己还想继续跑、不要去睡觉；绝对不能出现前后不搭或矛盾的话）。
4. 坚决保持当前的【${curLabel}】状态，【绝对不要】输出 action change 指令。
5. 如果姑姑只是普通问候闲聊（如“现在几点了”），请正常自然回答，无需刻意对抗。`;
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
3. 【严禁模板化与句式复读】：严禁每一句都套用“姑姑才不要钢蛋儿xx”或“我才不要xx”等机械重复的句式！请根据语境自由、生动、多样地构思表达。
4. 不要输出其他情绪标签。`;
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
