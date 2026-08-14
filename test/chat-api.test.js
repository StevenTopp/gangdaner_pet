const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyThinkingPreference,
  fetchChatCompletion,
  formatChatApiError
} = require("../app/chat-api");

test("thinking preference defaults to no-think and restores provider defaults when enabled", () => {
  const payload = { model: "test", reasoning_effort: "high" };
  assert.deepEqual(applyThinkingPreference(payload, false), { model: "test", reasoning_effort: "none" });
  assert.deepEqual(applyThinkingPreference(payload, true), { model: "test" });
  assert.equal(payload.reasoning_effort, "high");
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

const request = {
  url: "https://example.test/chat/completions",
  apiKey: "test-key",
  payload: { model: "test", messages: [] },
  retryDelaysMs: [1, 2],
  waitImpl: async () => {}
};

test("chat request retries a transient fetch failure without changing the payload", async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) {
      const cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
      throw new TypeError("fetch failed", { cause });
    }
    return response(200, { choices: [{ message: { content: "喵" } }] });
  };
  const result = await fetchChatCompletion({ ...request, fetchImpl });
  assert.equal(result.attemptsUsed, 2);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test("chat request retries 503 but does not retry 401", async () => {
  let serviceCalls = 0;
  const recovered = await fetchChatCompletion({
    ...request,
    fetchImpl: async () => ++serviceCalls === 1
      ? response(503, { error: "busy" })
      : response(200, { choices: [] })
  });
  assert.equal(recovered.attemptsUsed, 2);

  let authCalls = 0;
  await assert.rejects(fetchChatCompletion({
    ...request,
    fetchImpl: async () => { authCalls++; return response(401, { error: "bad key" }); }
  }), /HTTP 401/);
  assert.equal(authCalls, 1);
});

test("final network error includes its cause code and retry count", async () => {
  const cause = Object.assign(new Error("connect timed out"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  let caught;
  try {
    await fetchChatCompletion({
      ...request,
      fetchImpl: async () => { throw new TypeError("fetch failed", { cause }); }
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught.attemptsUsed, 3);
  assert.equal(formatChatApiError(caught), "网络请求失败（UND_ERR_CONNECT_TIMEOUT，已自动重试 2 次）");
});
