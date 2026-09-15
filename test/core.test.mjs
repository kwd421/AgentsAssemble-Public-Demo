import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, buildMessages, selectAgents } from '../lib/agents.mjs';
import { AgentError, aiConfig, callAgent, integer, parseCompletion, publicError, retryAfter } from '../lib/ai.mjs';
import { RoomStore } from '../lib/rooms.mjs';
const answer = content => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 12 } }));
const env = { AI_API_KEY: 'test-secret-do-not-log', AI_MODEL: 'test/model', AI_MAX_TOKENS: '3000' };
const opts = extra => ({ env, log: () => {}, ...extra });
const req = (content = '질문', extra = {}) => ({ type: 'turn', content, requestId: crypto.randomUUID(), ...extra });
const runner = async agent => ({ content: `${agent.id} answer`, model: 'test/model', durationMs: 1 });

test('3000 token setting is honored and invalid/blank numeric settings use bounded defaults', () => {
  assert.equal(aiConfig(env).maxTokens, 3000);
  assert.equal(aiConfig({ AI_MAX_TOKENS: '200000' }).maxTokens, 8192);
  assert.equal(aiConfig({ AI_MAX_TOKENS: 'garbage' }).maxTokens, 1200);
  assert.equal(aiConfig({ AI_MAX_TOKENS: '' }).maxTokens, 1200);
  assert.equal(integer('3.8', 0, 8, 2), 3);
});
test('HTTP request uses the configured 3000 limit without exposing it as 1200', async () => {
  let body;
  await callAgent(AGENTS[1], [], opts({ fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return answer('ok'); } }));
  assert.equal(body.max_tokens, 3000); assert.equal(body.model, 'test/model'); assert.equal(body.reasoning, undefined);
});
test('same-model personas can have separate model overrides', async () => {
  let model;
  await callAgent(AGENTS[1], [], opts({ env: { ...env, AI_MODEL_ENGINEER: 'custom/engineer' }, fetchImpl: async (_, init) => { model = JSON.parse(init.body).model; return answer('ok'); } }));
  assert.equal(model, 'custom/engineer');
});
test('HTTP 200 error envelopes are errors, not empty answers', () => {
  assert.throws(() => parseCompletion({ error: { code: 429, message: 'private metadata' } }), e => e.code === 'ai_rate_limit');
});
test('content-part arrays work and reasoning is never used as answer', () => {
  assert.equal(parseCompletion({ choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'B' }] } }] }).content, 'AB');
  assert.throws(() => parseCompletion({ choices: [{ message: { reasoning: 'hidden chain', content: '' }, finish_reason: 'length' }] }), e => e.code === 'ai_token_limit');
});
test('partial answer gets a truncation flag rather than a generic error', () => {
  assert.equal(parseCompletion({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }).truncated, true);
});
test('filtered responses are not retried', () => {
  assert.throws(() => parseCompletion({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }), e => e.code === 'ai_filtered' && !e.retryable);
});
test('tool-only output is not looped without a tool executor', () => {
  assert.throws(() => parseCompletion({ choices: [{ message: { content: '' }, finish_reason: 'tool_calls' }] }), e => !e.retryable);
});
test('503 receives exactly one retry then succeeds', async () => {
  let calls = 0, retries = 0;
  const result = await callAgent(AGENTS[1], [], opts({ onRetry: () => retries++, fetchImpl: async () => ++calls === 1 ? new Response('error', { status: 503 }) : answer('recovered') }));
  assert.equal(calls, 2); assert.equal(retries, 1); assert.equal(result.content, 'recovered');
});
test('401 and credit failures do not retry or leak raw provider text', async () => {
  for (const [status, code] of [[401, 'ai_auth'], [402, 'ai_credit']]) {
    let calls = 0; const logs = [];
    await assert.rejects(callAgent(AGENTS[0], [], opts({ log: e => logs.push(e), fetchImpl: async () => { calls++; return new Response('test-secret-do-not-log', { status }); } })), e => e.code === code);
    assert.equal(calls, 1); assert.ok(!JSON.stringify(logs).includes('test-secret'));
  }
});
test('Retry-After supports seconds and dates', () => {
  assert.equal(retryAfter('2'), 2000);
  assert.equal(retryAfter('Tue, 15 Sep 2026 00:00:10 GMT', Date.parse('2026-09-15T00:00:00Z')), 10000);
  assert.equal(retryAfter('bogus'), 0);
});
test('Retry-After longer than the total deadline fails without early retry', async () => {
  let calls = 0;
  await assert.rejects(callAgent(AGENTS[0], [], opts({ fetchImpl: async () => { calls++; return new Response('limited', { status: 429, headers: { 'retry-after': '60' } }); } })), e => e.code === 'ai_rate_limit' && e.retryAfterMs === 60000);
  assert.equal(calls, 1);
});
test('repeated empty answers are bounded to two total attempts', async () => {
  let calls = 0;
  await assert.rejects(callAgent(AGENTS[0], [], opts({ fetchImpl: async () => { calls++; return answer(''); } })), e => e.code === 'ai_empty');
  assert.equal(calls, 2);
});
test('token-only retry lowers reasoning only on OpenRouter and never increases token budget', async () => {
  const bodies = [];
  await callAgent(AGENTS[1], [], opts({ fetchImpl: async (_, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning: 'secret' }, finish_reason: 'length' }] })) : answer('ok'); } }));
  assert.equal(bodies[1].reasoning.effort, 'low'); assert.equal(bodies[1].max_tokens, 3000);
});
test('pre-cancelled calls never contact the provider', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(callAgent(AGENTS[1], [], opts({ signal: controller.signal, fetchImpl: async () => { calls++; return answer('no'); } })), e => e.code === 'cancelled');
  assert.equal(calls, 0);
});
test('one deadline bounds the whole call and clears its timer', async () => {
  let calls = 0;
  await assert.rejects(callAgent(AGENTS[0], [], opts({ config: { ...aiConfig(env), timeoutMs: 25 }, fetchImpl: (_, init) => { calls++; return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private')), { once: true })); } })), e => e.code === 'ai_timeout');
  assert.equal(calls, 1);
});
test('log allowlist contains no raw errors, prompts, keys, or reasoning', async () => {
  const logs = [];
  await callAgent(AGENTS[0], [{ kind: 'user', content: 'private-prompt' }], opts({ log: e => logs.push(e), fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'private-answer', reasoning: 'private-reasoning' }, finish_reason: 'stop' }], usage: { completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 2 } } })) }));
  const serialized = JSON.stringify(logs);
  for (const secret of ['private-prompt', 'private-answer', 'private-reasoning', env.AI_API_KEY]) assert.ok(!serialized.includes(secret));
  assert.equal(logs[0].usage.reasoning_tokens, 2);
});
test('generic provider errors do not escape through public error messages', () => {
  assert.ok(!JSON.stringify(publicError(new Error('sk-private'))).includes('sk-private'));
});
test('own prior messages stay assistant, peers are untrusted user context', () => {
  const records = [{ kind: 'user', content: 'question' }, { kind: 'agent', agentId: 'engineer', agentName: '엔지니어', content: 'own' }, { kind: 'agent', agentId: 'critic', agentName: '비평가', content: 'peer' }];
  const msgs = buildMessages(AGENTS[1], records);
  assert.ok(msgs.some(m => m.role === 'assistant' && m.content === 'own'));
  assert.ok(msgs.some(m => m.role === 'user' && m.content.includes('peer')));
  assert.ok(msgs[0].content.includes('웹 검색·파일·실행 도구가 없습니다'));
});
test('mention routing respects boundaries, multiple mentions, Korean, and @all', () => {
  assert.deepEqual(selectAgents('@엔지니어 확인해줘').map(a => a.id), ['engineer']);
  assert.equal(selectAgents('@engineer @critic 확인').length, 2);
  assert.equal(selectAgents('@all @engineer 확인').length, 3);
  assert.equal(selectAgents('contact@engineer.com').length, 3);
  assert.equal(selectAgents('abc@critic').length, 3);
  assert.equal(selectAgents('x', 'no-agent').length, 0);
});
test('sequential agents read preceding messages and failure does not stop critic', async () => {
  const seen = [];
  const s = new RoomStore({ env, runner: async (a, context) => { seen.push([a.id, context.length]); if (a.id === 'engineer') throw new AgentError('ai_timeout', { retryable: true }); return runner(a); } });
  const r = s.create(); await s.start(r, req()).completion;
  assert.deepEqual(seen, [['strategist', 1], ['engineer', 2], ['critic', 2]]);
  assert.equal(r.messages.length, 3); assert.equal(r.busy, false); assert.equal(s.jobs, 0);
  const snapshot = s.snapshot(r); assert.equal(snapshot.failures[0].canRetry, true);
  assert.equal(snapshot.failures[0].context, undefined);
  assert.equal(snapshot.runtime.rustConnected, false); s.close();
});
test('retry only failed agent uses original context without adding another user turn', async () => {
  let fail = true; const seen = [];
  const s = new RoomStore({ env, runner: async (a, context) => { if (a.id === 'engineer') { seen.push(context.map(m => m.agentId || m.kind)); if (fail) throw new AgentError('ai_empty', { retryable: true }); } return runner(a); } });
  const r = s.create(); await s.start(r, req()).completion;
  const failure = s.snapshot(r).failures[0]; fail = false;
  await s.start(r, { type: 'retry', requestId: crypto.randomUUID(), failureId: failure.id }).completion;
  assert.deepEqual(seen[0], seen[1]); assert.equal(r.userTurns, 1); assert.equal(r.messages.filter(m => m.kind === 'user').length, 1);
  assert.equal(r.messages.at(-1).retryOf, failure.id); assert.equal(s.snapshot(r).failures.length, 0); s.close();
});
test('only one manual retry is allowed', async () => {
  const s = new RoomStore({ env, runner: async () => { throw new AgentError('ai_empty', { retryable: true }); } });
  const r = s.create(); await s.start(r, req('@engineer hi')).completion;
  const id = s.snapshot(r).failures[0].id;
  await s.start(r, { type: 'retry', requestId: crypto.randomUUID(), failureId: id }).completion;
  assert.throws(() => s.start(r, { type: 'retry', requestId: crypto.randomUUID(), failureId: id }), e => e.code === 'retry_not_available'); s.close();
});
test('a new question invalidates old retries', async () => {
  const s = new RoomStore({ env, runner: async () => { throw new AgentError('ai_empty', { retryable: true }); } });
  const r = s.create(); await s.start(r, req('@engineer hi')).completion;
  const id = s.snapshot(r).failures[0].id;
  await s.start(r, req('@critic hi')).completion;
  assert.throws(() => s.start(r, { type: 'retry', requestId: crypto.randomUUID(), failureId: id }), e => e.code === 'retry_not_available'); s.close();
});
test('deduplication, validation, and room limit do not create phantom user turns', async () => {
  const s = new RoomStore({ env, runner }), r = s.create(), command = req('test');
  await s.start(r, command).completion; assert.equal(s.start(r, command).duplicate, true);
  assert.throws(() => s.start(r, req(' '.repeat(10))), e => e.code === 'invalid_message');
  assert.throws(() => s.start(r, req('x'.repeat(2501))), e => e.code === 'invalid_message');
  assert.equal(r.userTurns, 1); assert.equal(r.messages[0].requestId, command.requestId);
  for (let i = 0; i < 7; i++) await s.start(r, req('@engineer test')).completion;
  assert.throws(() => s.start(r, req('ninth')), e => e.code === 'turn_limit_reached'); s.close();
});
test('cancellation stops later agents and clears busy/job accounting', async () => {
  const visited = [];
  const s = new RoomStore({ env, runner: async (a, _context, { signal }) => { visited.push(a.id); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw new AgentError('cancelled'); } });
  const r = s.create(); const { completion } = s.start(r, req());
  assert.throws(() => s.start(r, req()), e => e.code === 'room_busy');
  s.stop(r); await completion;
  assert.deepEqual(visited, ['strategist']); assert.equal(r.busy, false); assert.equal(s.jobs, 0); s.close();
});
test('global concurrency ceiling rejects without consuming a turn', async () => {
  const s = new RoomStore({ env, maxJobs: 1, runner: async (_, _c, { signal }) => { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw new AgentError('cancelled'); } });
  const a = s.create(), b = s.create(); const { completion } = s.start(a, req());
  assert.throws(() => s.start(b, req()), e => e.code === 'server_busy'); assert.equal(b.userTurns, 0);
  s.stop(a); await completion; s.close();
});
test('pruning respects active work and does not evict a fresh room at capacity', () => {
  let now = 10;
  const s = new RoomStore({ maxRooms: 1, ttlMs: 5, clock: () => now }), r = s.create();
  assert.throws(() => s.create(), e => e.code === 'room_capacity');
  now = 20; r.busy = true; s.prune(); assert.equal(s.rooms.size, 1);
  r.busy = false; s.prune(); assert.equal(s.rooms.size, 0); s.close();
});
test('disabled fake mode is never silently substituted after provider failure', async () => {
  const result = await callAgent(AGENTS[0], [], { env: { DEMO_FAKE_MODE: '1' } });
  assert.equal(result.model, 'fixture'); assert.match(result.content, /실제 AI 아님/);
  await assert.rejects(callAgent(AGENTS[0], [], { env: {} }), e => e.code === 'demo_not_configured');
});
