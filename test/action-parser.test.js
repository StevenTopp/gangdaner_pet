const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CatDispositionSampler,
  buildChatSystemPrompt,
  buildConversationContext,
  checkFoodMention,
  detectActionRequest,
  determineCatDisposition,
  parseActionChange,
  resolveActionTarget
} = require("../app/action-parser");

const mockStates = {
  blinking: { label: "眨眼", file: "眨眼.webm" },
  playing_yarn: { label: "玩毛线球", file: "玩毛线球.webm" },
  sleeping: { label: "睡觉", file: "睡觉.webm" },
  running: { label: "跑步", file: "跑步.webm" }
};

test("resolveActionTarget resolves labels and keys", () => {
  assert.equal(resolveActionTarget("睡觉", mockStates), "sleeping");
  assert.equal(resolveActionTarget("RUNNING", mockStates), "running");
  assert.equal(resolveActionTarget("玩毛线球。", mockStates), "playing_yarn");
  assert.equal(resolveActionTarget("未知动作", mockStates), null);
});

test("parseActionChange supports text and JSON protocols", () => {
  const textResult = parseActionChange("好呀姑姑，我们睡觉吧。\naction change: sleeping", mockStates);
  assert.equal(textResult.cleanReply, "好呀姑姑，我们睡觉吧。");
  assert.equal(textResult.targetState, "sleeping");

  const jsonResult = parseActionChange('{"reply":"毛线球来啦！","action_change":"playing_yarn"}', mockStates);
  assert.equal(jsonResult.cleanReply, "毛线球来啦！");
  assert.equal(jsonResult.targetState, "playing_yarn");

  const normalResult = parseActionChange("现在是下午三点喵。", mockStates);
  assert.equal(normalResult.targetState, null);

  const malformedResult = parseActionChange(
    "先想一下</think>\n\n好哒姑姑，我不跑了。\naction change: blinking\n好的姑姑！\naction change: sleeping",
    mockStates
  );
  assert.equal(malformedResult.cleanReply, "好哒姑姑，我不跑了。");
  assert.equal(malformedResult.targetState, "blinking");
});

test("detectActionRequest distinguishes commands from normal questions", () => {
  assert.deepEqual(
    detectActionRequest({
      userText: "钢蛋儿别睡了，快起来陪我玩",
      currentStateKey: "sleeping",
      states: mockStates
    }).targetState,
    "playing_yarn"
  );
  assert.equal(detectActionRequest({
    userText: "钢蛋儿，太晚啦，要睡觉了",
    currentStateKey: "playing_yarn",
    states: mockStates
  }).targetState, "sleeping");
  assert.equal(detectActionRequest({
    userText: "别跑啦，停下来陪姑姑",
    currentStateKey: "running",
    states: mockStates
  }).targetState, "blinking");
  assert.equal(detectActionRequest({
    userText: "现在几点了？",
    currentStateKey: "sleeping",
    states: mockStates
  }).isActionRequest, false);
  assert.equal(detectActionRequest({
    userText: "你喜欢跑步吗？",
    currentStateKey: "blinking",
    states: mockStates
  }).isActionRequest, false);
  for (const text of ["陪我工作", "钢蛋儿陪着我", "坐一会吧", "钢蛋儿坐着"]) {
    const result = detectActionRequest({ userText: text, currentStateKey: "sleeping", states: mockStates });
    assert.equal(result.targetState, "blinking", text);
    assert.equal(result.isActionRequest, true, text);
  }
  assert.equal(detectActionRequest({
    userText: "钢蛋儿为什么坐着呢？",
    currentStateKey: "sleeping",
    states: mockStates
  }).isActionRequest, false);
});

test("food exception and disposition probability only apply to action requests", () => {
  assert.equal(checkFoodMention("跑完奖励一根猫条"), true);
  assert.equal(determineCatDisposition({
    userText: "现在几点了？",
    isActionRequest: false,
    rebellionRate: 100
  }), "normal");
  assert.equal(determineCatDisposition({
    userText: "给你猫条，快去睡觉",
    isActionRequest: true,
    rebellionRate: 100
  }), "food_enthusiastic");
  assert.equal(determineCatDisposition({
    userText: "快去睡觉",
    isActionRequest: true,
    rebellionRate: 0
  }), "obedient");
  assert.equal(determineCatDisposition({
    userText: "快去睡觉",
    isActionRequest: true,
    rebellionRate: 100
  }), "rebellious");
});

test("disposition prevents a fourth identical result", () => {
  let seed = 123456789;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const sampler = new CatDispositionSampler(random);
  const results = Array.from({ length: 200 }, () => sampler.draw({
    userText: "快去睡觉",
    isActionRequest: true,
    rebellionRate: 40
  }));
  assert.equal(results.filter(value => value === "rebellious").length, 80);

  let longest = 0;
  let run = 0;
  let previous = null;
  for (const result of results) {
    run = result === previous ? run + 1 : 1;
    previous = result;
    longest = Math.max(longest, run);
  }
  assert.ok(longest <= 3, `unexpected disposition streak: ${longest}`);
});

test("changing the configured rate rebuilds an exact 100-item bag", () => {
  let seed = 987654321;
  const random = () => {
    seed = (1103515245 * seed + 12345) >>> 0;
    return seed / 0x100000000;
  };
  const sampler = new CatDispositionSampler(random);
  const firstBag = Array.from({ length: 100 }, () => sampler.draw({
    userText: "起来陪我玩",
    isActionRequest: true,
    rebellionRate: 40
  }));
  assert.equal(firstBag.filter(value => value === "rebellious").length, 40);

  const changedBag = Array.from({ length: 100 }, () => sampler.draw({
    userText: "快去睡觉",
    isActionRequest: true,
    rebellionRate: 25
  }));
  assert.equal(changedBag.filter(value => value === "rebellious").length, 25);

  const remainingBeforeExceptions = sampler.bag.length;
  assert.equal(sampler.draw({ userText: "现在几点？", isActionRequest: false, rebellionRate: 25 }), "normal");
  assert.equal(sampler.draw({ userText: "给你猫条，快去跑步", isActionRequest: true, rebellionRate: 25 }), "food_enthusiastic");
  assert.equal(sampler.bag.length, remainingBeforeExceptions);
});

test("action conversations are removed from model history", () => {
  const context = buildConversationContext([
    { role: "user", content: "钢蛋儿快去睡觉" },
    { role: "assistant", content: "我才不要睡呢。" },
    { role: "user", content: "姑姑今天有点累" },
    { role: "assistant", content: "那姑姑要休息一下喵。" },
    { role: "user", content: "给你猫条，起来跑两圈", actionContext: { isActionRequest: true } },
    { role: "assistant", content: "好呀好呀！" }
  ], { limit: 40, states: mockStates });

  assert.deepEqual(context, [
    { role: "user", content: "姑姑今天有点累" },
    { role: "assistant", content: "那姑姑要休息一下喵。" }
  ]);
});

test("prompt carries an authoritative per-turn decision and exact action key", () => {
  const prompt = buildChatSystemPrompt({
    persona: "你是布偶猫钢蛋儿",
    currentTime: "2026/8/14 13:00:00",
    currentStateKey: "playing_yarn",
    states: mockStates,
    catDisposition: "obedient",
    actionRequest: { isActionRequest: true, targetState: "sleeping" },
    requiredActionState: "sleeping"
  });
  assert.ok(prompt.includes("本轮性格决定：obedient"));
  assert.ok(prompt.includes("应当真正执行的动作：睡觉"));
  assert.ok(prompt.includes("action change: sleeping"));
  assert.ok(prompt.includes("历史中的同意、拒绝和动作决定一律不得延续到本轮"));
});
