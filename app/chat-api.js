const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [350, 900];

class ChatApiHttpError extends Error {
  constructor(status, body = "") {
    super(`HTTP ${status}: ${String(body).slice(0, 200)}`);
    this.name = "ChatApiHttpError";
    this.status = status;
  }
}

function isRetryableChatError(error) {
  if (RETRYABLE_HTTP_STATUSES.has(Number(error?.status))) return true;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return true;
  return error?.name === "TypeError" && /fetch failed|network|socket/i.test(String(error.message || ""));
}

function underlyingErrorCode(error) {
  return error?.cause?.code || error?.cause?.errno || null;
}

function formatChatApiError(error) {
  const retries = Math.max(0, Number(error?.attemptsUsed || 1) - 1);
  const retryText = retries ? `，已自动重试 ${retries} 次` : "";
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return `请求超时${retryText}`;
  }
  const code = underlyingErrorCode(error);
  if (code) return `网络请求失败（${code}${retryText}）`;
  return `${error?.message || "未知错误"}${retryText}`;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchChatCompletion({
  url,
  apiKey,
  payload,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  waitImpl = wait
} = {}) {
  const totalAttempts = retryDelaysMs.length + 1;
  let lastError = null;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const raw = await response.text();
      if (!response.ok) throw new ChatApiHttpError(response.status, raw);
      return { data: JSON.parse(raw), attemptsUsed: attempt + 1 };
    } catch (error) {
      lastError = error;
      const canRetry = attempt < totalAttempts - 1 && isRetryableChatError(error);
      if (!canRetry) {
        error.attemptsUsed = attempt + 1;
        throw error;
      }
      await waitImpl(retryDelaysMs[attempt]);
    }
  }

  lastError.attemptsUsed = totalAttempts;
  throw lastError;
}

module.exports = {
  ChatApiHttpError,
  DEFAULT_RETRY_DELAYS_MS,
  RETRYABLE_HTTP_STATUSES,
  fetchChatCompletion,
  formatChatApiError,
  isRetryableChatError,
  underlyingErrorCode
};
