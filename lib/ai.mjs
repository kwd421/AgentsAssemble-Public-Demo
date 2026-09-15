import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { modelFor, buildMessages } from './agents.mjs';

export function integer(value, min, max, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}
export function aiConfig(env = process.env) {
  return {
    maxTokens: integer(env.AI_MAX_TOKENS, 128, 8192, 1200),
    timeoutMs: integer(env.AI_TIMEOUT_MS, 5000, 120000, 45000),
    retries: integer(env.AI_RETRIES, 0, 1, 1),
    base: String(env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    apiKey: String(env.AI_API_KEY || '').trim(), fake: env.DEMO_FAKE_MODE === '1',
    reasoningEffort: ['low', 'medium', 'high', 'none'].includes(env.AI_REASONING_EFFORT) ? env.AI_REASONING_EFFORT : undefined,
  };
}
const EXPLANATIONS = {
  demo_not_configured: '이 에이전트의 모델 또는 서버 API 키가 설정되지 않았습니다.',
  ai_auth: 'AI 서비스 인증에 실패했습니다. 서버의 API 키 설정을 확인해야 합니다.',
  ai_credit: 'AI 서비스 크레딧 또는 사용 한도에 도달했습니다.',
  ai_forbidden: 'AI 서비스가 요청을 허용하지 않았습니다.',
  ai_rate_limit: 'AI 제공자가 요청을 제한했습니다. 잠시 뒤 다시 시도하세요.',
  ai_timeout: '응답 제한 시간을 초과했습니다. 이 에이전트만 다시 시도할 수 있습니다.',
  ai_network: 'AI 제공자와 연결하지 못했습니다.',
  ai_upstream: 'AI 제공자에서 일시적인 오류가 발생했습니다.',
  ai_invalid: 'AI 제공자가 올바른 응답 형식을 반환하지 않았습니다.',
  ai_empty: 'AI 제공자가 답변 본문 없이 응답했습니다.',
  ai_token_limit: '토큰 한도에 도달했지만 답변 본문이 생성되지 않았습니다.',
  ai_filtered: 'AI 제공자의 콘텐츠 필터로 응답이 중단되었습니다.',
  ai_request: 'AI 제공자가 요청을 거부했습니다. 모델 또는 요청 설정을 확인해야 합니다.',
  cancelled: '응답 생성을 중지했습니다.',
};
export class AgentError extends Error {
  constructor(code, meta = {}) { super(EXPLANATIONS[code] || EXPLANATIONS.ai_upstream); this.code = code; Object.assign(this, meta); }
}
function statusError(status, retryAfterMs = 0) {
  const code = ({ 401: 'ai_auth', 402: 'ai_credit', 403: 'ai_forbidden', 408: 'ai_timeout', 429: 'ai_rate_limit' })[status] || (status >= 500 ? 'ai_upstream' : 'ai_request');
  return new AgentError(code, { status, retryable: status === 408 || status === 429 || status >= 500, retryAfterMs });
}
export function retryAfter(value, now = Date.now()) {
  if (value == null || value === '') return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
export function parseCompletion(data) {
  if (data?.error) {
    const status = Number(data.error.code);
    throw statusError(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502);
  }
  const choice = data?.choices?.[0];
  const finishReason = choice?.finish_reason;
  if (finishReason === 'content_filter') throw new AgentError('ai_filtered');
  if (finishReason === 'error') throw new AgentError('ai_upstream', { retryable: true });
  const value = choice?.message?.content;
  const content = (typeof value === 'string' ? value : Array.isArray(value) ? value.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('') : '').trim();
  // Never substitute reasoning/reasoning_content for an answer or log its contents.
  const rawUsage = data?.usage;
  const usage = {};
  for (const k of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(rawUsage?.[k]) && rawUsage[k] >= 0) usage[k] = rawUsage[k];
  }
  const r = rawUsage?.completion_tokens_details?.reasoning_tokens;
  if (Number.isSafeInteger(r) && r >= 0) usage.reasoning_tokens = r;
  const meta = { finishReason: ['stop', 'length', 'tool_calls', 'error', 'content_filter'].includes(finishReason) ? finishReason : null, usage };
  if (!content) throw new AgentError(finishReason === 'length' ? 'ai_token_limit' : 'ai_empty', { ...meta, retryable: finishReason !== 'tool_calls' });
  return { content: content.slice(0, 12000), truncated: finishReason === 'length' || content.length > 12000, ...meta };
}
async function readBounded(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentError('ai_invalid', { retryable: true });
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new AgentError('ai_invalid'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AgentError('ai_invalid', { retryable: true }); }
}
export function publicError(error) {
  return { code: error.code || 'ai_upstream', message: EXPLANATIONS[error.code] || EXPLANATIONS.ai_upstream,
    retryable: Boolean(error.retryable) || ['ai_timeout', 'ai_network', 'ai_empty', 'ai_token_limit'].includes(error.code),
    traceId: error.traceId, retryAfterMs: Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0 };
}
export async function callAgent(agent, records, { signal, env = process.env, config = aiConfig(env), fetchImpl = fetch, onRetry = () => {}, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  const model = modelFor(agent, env);
  if (config.fake) return { content: `[UI 테스트 응답 · 실제 AI 아님] ${agent.name}: 마지막 질문을 공유 Room 기록에서 읽었습니다.`, model: 'fixture', durationMs: 0, usage: {}, truncated: false };
  if (!config.apiKey || !model) throw new AgentError('demo_not_configured');
  const started = Date.now();
  const traceId = randomUUID();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), config.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` };
  if (env.APP_PUBLIC_URL) headers['HTTP-Referer'] = env.APP_PUBLIC_URL;
  if (env.APP_NAME) headers['X-Title'] = env.APP_NAME;
  let useLowReasoning = false;
  try {
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      let failure;
      try {
        if (combined.aborted) throw new AgentError('cancelled');
        const body = { model, temperature: 0.55, max_tokens: config.maxTokens, messages: buildMessages(agent, records) };
        if (new URL(config.base).hostname === 'openrouter.ai' && (config.reasoningEffort || useLowReasoning)) {
          body.reasoning = { effort: config.reasoningEffort || 'low', exclude: true };
        }
        const response = await fetchImpl(`${config.base}/chat/completions`, { method: 'POST', headers, signal: combined, body: JSON.stringify(body) });
        const wait = retryAfter(response.headers.get('retry-after'));
        if (!response.ok) {
          await response.body?.cancel();
          throw statusError(response.status, wait);
        }
        let result;
        try { result = parseCompletion(await readBounded(response)); }
        catch (e) { if (e instanceof AgentError && wait) e.retryAfterMs = wait; throw e; }
        if (combined.aborted) throw new AgentError('cancelled');
        const durationMs = Date.now() - started;
        log({ event: 'agent_success', traceId, agentId: agent.id, model, attempt: attempt + 1, durationMs, maxTokens: config.maxTokens, finishReason: result.finishReason, usage: result.usage });
        return { ...result, model, durationMs, traceId };
      } catch (e) {
        failure = signal?.aborted ? new AgentError('cancelled') : deadline.signal.aborted ? new AgentError('ai_timeout', { retryable: true }) : e instanceof AgentError ? e : new AgentError('ai_network', { retryable: true });
        failure.traceId = traceId;
        // Deliberately allowlist metadata: never log raw provider errors, API keys, prompts, room IDs, or reasoning.
        log({ event: 'agent_failure', traceId, agentId: agent.id, model, attempt: attempt + 1, durationMs: Date.now() - started, code: failure.code, status: failure.status, finishReason: failure.finishReason, usage: failure.usage, maxTokens: config.maxTokens });
      }
      const wait = Math.max(500 * (attempt + 1), failure.retryAfterMs || 0);
      if (!failure.retryable || attempt >= config.retries || combined.aborted || Date.now() - started + wait + 100 >= config.timeoutMs) throw failure;
      if (failure.code === 'ai_token_limit') useLowReasoning = true;
      onRetry({ ...publicError(failure), attempt: attempt + 2, waitMs: wait });
      try { await sleep(wait, undefined, { signal: combined }); }
      catch { const error = new AgentError(signal?.aborted ? 'cancelled' : 'ai_timeout', { retryable: !signal?.aborted, traceId }); throw error; }
    }
  } finally { clearTimeout(timer); }
}
