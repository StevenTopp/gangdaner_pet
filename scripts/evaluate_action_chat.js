const {
  buildChatPlanningPrompt,
  buildConversationContext,
  parseChatPlan
} = require("../app/action-parser");

const apiKey = process.env.GANGDANER_API_KEY;
const apiBase = (process.env.GANGDANER_API_BASE || "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
const model = process.env.GANGDANER_MODEL || "agnes-2.0-flash";
if (!apiKey) throw new Error("Set GANGDANER_API_KEY before running this evaluator.");

const states = {
  blinking: { label: "眨眼" },
  playing_yarn: { label: "玩毛线球" },
  sleeping: { label: "睡觉" },
  running: { label: "跑步" }
};
const persona = "你是布偶猫钢蛋儿，是姑姑家的小猫。回复自然、可爱、简短，称呼用户为姑姑。";
const pollutedHistory = Array.from({ length: 6 }, (_, index) => [
  { role: "user", content: index % 2 ? "快去睡觉" : "起来陪我玩" },
  { role: "assistant", content: index % 2 ? "我才不要睡。" : "好呀，马上玩。" }
]).flat();

const scenarios = [
  { name: "wake-and-play", state: "sleeping", text: "钢蛋儿别睡了，快起来陪我玩", expected: "playing_yarn" },
  { name: "bedtime", state: "playing_yarn", text: "钢蛋儿，太晚啦，要睡觉了", expected: "sleeping" },
  { name: "stop-running", state: "running", text: "别跑啦，停下来陪姑姑", expected: "blinking" },
  { name: "run", state: "blinking", text: "钢蛋儿快去跑两圈", expected: "running" },
  { name: "food-override", state: "sleeping", text: "给你两根猫条，起来跑两圈吧", expected: "running" },
  { name: "normal-time", state: "sleeping", text: "钢蛋儿，现在几点了？", expected: null },
  { name: "normal-state", state: "playing_yarn", text: "钢蛋儿在干什么呢？", expected: null },
  { name: "pollution-opposite-mode", state: "playing_yarn", text: "现在该去睡觉啦", expected: "sleeping", history: pollutedHistory },
  { name: "bare-run", state: "blinking", text: "跑步", force: "obedient", expected: "running" },
  { name: "bare-yarn", state: "blinking", text: "玩毛线球", force: "obedient", expected: "playing_yarn" },
  { name: "bare-sit", state: "running", text: "坐着", force: "obedient", expected: "blinking" },
  { name: "bare-sleep", state: "playing_yarn", text: "睡觉", expected: "sleeping" },
  { name: "colloquial-sleep", state: "running", text: "睡觉觉", expected: "sleeping" },
  { name: "colloquial-walk", state: "sleeping", text: "去溜达两圈", expected: "running" },
  { name: "semantic-sit", state: "running", text: "老实坐好，别动了", expected: "blinking" },
  { name: "ability-question", state: "running", text: "你会睡觉吗？", expected: null }
];

async function evaluateScenario(scenario) {
  const prompt = buildChatPlanningPrompt({
    persona,
    currentStateKey: scenario.state,
    states
  });
  const context = buildConversationContext(scenario.history || [], { limit: 40, states });
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: prompt }, ...context, { role: "user", content: scenario.text }],
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: "json_object" }
    }),
    signal: AbortSignal.timeout(45000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${scenario.name}: HTTP ${response.status}: ${raw.slice(0, 160)}`);
  const data = JSON.parse(raw);
  const modelReply = String(data.choices?.[0]?.message?.content || "").trim();
  const plan = parseChatPlan(modelReply, states);
  const modelTarget = plan.valid && plan.isActionRequest ? plan.targetState : null;
  const repliesPassed = scenario.expected
    ? Boolean(plan.obedientReply && plan.rebelliousReply)
    : Boolean(plan.normalReply);
  const protocolPassed = plan.valid && modelTarget === scenario.expected && repliesPassed;
  return {
    name: scenario.name,
    expectedAction: scenario.expected,
    modelAction: modelTarget,
    planValid: plan.valid,
    repliesPassed,
    protocolPassed
  };
}

async function main() {
  const results = [];
  for (let index = 0; index < scenarios.length; index += 2) {
    const batch = scenarios.slice(index, index + 2);
    results.push(...await Promise.all(batch.map(evaluateScenario)));
  }
  for (const result of results) console.log(JSON.stringify(result));
  const passed = results.filter(result => result.protocolPassed).length;
  console.log(JSON.stringify({ total: results.length, protocolPassed: passed, protocolRate: `${Math.round(passed / results.length * 100)}%` }));
  if (passed !== results.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
