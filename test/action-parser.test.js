const assert = require("node:assert/strict");
const test = require("node:test");
const {
  resolveActionTarget,
  parseActionChange,
  buildChatSystemPrompt,
  checkFoodMention,
  determineCatDisposition
} = require("../app/action-parser");

const mockStates = {
  blinking: { label: "眨眼", file: "眨眼.webm" },
  playing_yarn: { label: "玩毛线球", file: "玩毛线球.webm" },
  sleeping: { label: "睡觉", file: "睡觉.webm" },
  running: { label: "跑步", file: "跑步.webm" }
};

test("resolveActionTarget correctly resolves Chinese labels and keys", () => {
  assert.equal(resolveActionTarget("睡觉", mockStates), "sleeping");
  assert.equal(resolveActionTarget("跑步", mockStates), "running");
  assert.equal(resolveActionTarget("玩毛线球", mockStates), "playing_yarn");
  assert.equal(resolveActionTarget("眨眼", mockStates), "blinking");
  assert.equal(resolveActionTarget("sleeping", mockStates), "sleeping");
  assert.equal(resolveActionTarget("RUNNING", mockStates), "running");
  assert.equal(resolveActionTarget("未知动作", mockStates), null);
});

test("parseActionChange cleanly separates reply and action change directive", () => {
  const sample1 = "喵呜，钢蛋儿这就去睡觉啦，姑姑也早点休息哦～ action change: 睡觉";
  const res1 = parseActionChange(sample1, mockStates);
  assert.equal(res1.cleanReply, "喵呜，钢蛋儿这就去睡觉啦，姑姑也早点休息哦～");
  assert.equal(res1.targetState, "sleeping");
  assert.equal(res1.rawAction, "睡觉");

  const sample2 = "好呀好呀！毛线球出来喽～\n\naction change: 玩毛线球。";
  const res2 = parseActionChange(sample2, mockStates);
  assert.equal(res2.cleanReply, "好呀好呀！毛线球出来喽～");
  assert.equal(res2.targetState, "playing_yarn");

  const sample3 = "钢蛋儿这就停下来陪姑姑！ (action change: 眨眼)";
  const res3 = parseActionChange(sample3, mockStates);
  assert.equal(res3.cleanReply, "钢蛋儿这就停下来陪姑姑！");
  assert.equal(res3.targetState, "blinking");

  const sample4 = "普通闲聊，没有任何动作切换指令。";
  const res4 = parseActionChange(sample4, mockStates);
  assert.equal(res4.cleanReply, "普通闲聊，没有任何动作切换指令。");
  assert.equal(res4.targetState, null);
  assert.equal(res4.rawAction, null);
});

test("checkFoodMention identifies treats and snacks", () => {
  assert.equal(checkFoodMention("快去跑两圈，跑完奖励一根猫条！"), true);
  assert.equal(checkFoodMention("想不想吃冻干呀？"), true);
  assert.equal(checkFoodMention("姑姑给你准备了罐头"), true);
  assert.equal(checkFoodMention("有好多好吃的零食哦"), true);
  assert.equal(checkFoodMention("快去睡觉吧"), false);
  assert.equal(checkFoodMention("现在几点啦"), false);
});

test("determineCatDisposition respects food exception, rebellion toggle and rates", () => {
  // Food always triggers food_enthusiastic regardless of rate
  const foodResult = determineCatDisposition({
    userText: "给你吃猫条，快去睡觉",
    rebellionEnabled: true,
    rebellionRate: 100
  });
  assert.equal(foodResult, "food_enthusiastic");

  // Disabled rebellion always returns obedient
  const disabledResult = determineCatDisposition({
    userText: "快去睡觉",
    rebellionEnabled: false,
    rebellionRate: 100
  });
  assert.equal(disabledResult, "obedient");

  // 0% rebellion rate returns obedient
  const zeroRateResult = determineCatDisposition({
    userText: "快去睡觉",
    rebellionEnabled: true,
    rebellionRate: 0
  });
  assert.equal(zeroRateResult, "obedient");

  // 100% rebellion rate returns rebellious
  const fullRebelResult = determineCatDisposition({
    userText: "快去睡觉",
    rebellionEnabled: true,
    rebellionRate: 100
  });
  assert.equal(fullRebelResult, "rebellious");
});

test("buildChatSystemPrompt contains current state and disposition sections", () => {
  const obedientPrompt = buildChatSystemPrompt({
    persona: "你是布偶猫钢蛋儿",
    currentTime: "2026/8/14 13:00:00",
    currentStateKey: "sleeping",
    states: mockStates,
    catDisposition: "obedient"
  });
  assert.ok(obedientPrompt.includes("【钢蛋儿此刻的实时状态】：睡觉"));
  assert.ok(obedientPrompt.includes("🐱 听话乖巧模式"));

  const rebelPrompt = buildChatSystemPrompt({
    persona: "你是布偶猫钢蛋儿",
    currentTime: "2026/8/14 13:00:00",
    currentStateKey: "playing_yarn",
    states: mockStates,
    catDisposition: "rebellious"
  });
  assert.ok(rebelPrompt.includes("😼 唱反调/傲娇任性模式"));
  assert.ok(rebelPrompt.includes("坚决唱反调 / 傲娇拒绝 / 赖皮"));

  const foodPrompt = buildChatSystemPrompt({
    persona: "你是布偶猫钢蛋儿",
    currentTime: "2026/8/14 13:00:00",
    currentStateKey: "running",
    states: mockStates,
    catDisposition: "food_enthusiastic"
  });
  assert.ok(foodPrompt.includes("✨ 极度兴奋听话模式"));
  assert.ok(foodPrompt.includes("听到猫条/零食/好吃的啦"));
});
