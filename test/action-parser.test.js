const assert = require("node:assert/strict");
const test = require("node:test");
const {
  resolveActionTarget,
  parseActionChange,
  buildChatSystemPrompt
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

test("buildChatSystemPrompt contains current state and state descriptions", () => {
  const prompt = buildChatSystemPrompt({
    persona: "你是布偶猫钢蛋儿",
    currentTime: "2026/8/14 13:00:00",
    currentStateKey: "sleeping",
    states: mockStates
  });

  assert.ok(prompt.includes("【钢蛋儿此刻的实时状态】：睡觉"));
  assert.ok(prompt.includes("打呼噜做美梦"));
  assert.ok(prompt.includes("action change: <目标动作名>"));
  assert.ok(prompt.includes("- 玩毛线球（playing_yarn）"));
});
