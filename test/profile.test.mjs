import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { RoomStore } from '../lib/rooms.mjs';
import { buildMessages } from '../lib/agents.mjs';
import { createDemoServer } from '../server.mjs';

const env = { AI_API_KEY: 'test', AI_MODEL: 'test/model' };

test('room agent profile update changes public snapshot and next runner identity/instruction', async () => {
  const seen = [];
  const store = new RoomStore({ env, runner: async agent => { seen.push({ name: agent.name, prompt: agent.prompt }); return { content: 'ok', model: 'test/model', durationMs: 1, truncated: false }; } });
  const room = store.create();
  const result = store.updateAgentProfile(room, { type: 'agent_profile_update', requestId: crypto.randomUUID(), agentId: 'engineer', name: '테크리드', instruction: '항상 두 가지 구현 대안을 비교한 뒤 하나를 선택하세요.' });
  assert.equal(result.duplicate, false);
  const engineer = store.snapshot(room).agents.find(a => a.id === 'engineer');
  assert.equal(engineer.name, '테크리드');
  assert.equal(engineer.instruction, '항상 두 가지 구현 대안을 비교한 뒤 하나를 선택하세요.');
  await store.start(room, { type: 'turn', requestId: crypto.randomUUID(), targetAgentId: 'engineer', content: '테스트' }).completion;
  assert.deepEqual(seen, [{ name: '테크리드', prompt: '항상 두 가지 구현 대안을 비교한 뒤 하나를 선택하세요.' }]);
  assert.equal(room.messages.at(-1).agentName, '테크리드');
  const system = buildMessages(room.agents.find(a => a.id === 'engineer'), []).at(0).content;
  assert.match(system, /테크리드/); assert.match(system, /두 가지 구현 대안/);
  store.close();
});

test('agent profile validation is bounded and cannot mutate while a turn is active', async () => {
  let release;
  const store = new RoomStore({ env, runner: async (_agent, _context, { signal }) => { await new Promise(resolve => { release = resolve; signal.addEventListener('abort', resolve, { once: true }); }); return { content: 'ok', model: 'test/model', durationMs: 1 }; } });
  const room = store.create();
  assert.throws(() => store.updateAgentProfile(room, { requestId: crypto.randomUUID(), agentId: 'engineer', name: '', instruction: 'x' }), e => e.code === 'invalid_agent_profile');
  assert.throws(() => store.updateAgentProfile(room, { requestId: crypto.randomUUID(), agentId: 'engineer', name: 'x', instruction: 'y'.repeat(1201) }), e => e.code === 'invalid_agent_profile');
  const active = store.start(room, { type: 'turn', requestId: crypto.randomUUID(), targetAgentId: 'engineer', content: 'hold' });
  assert.throws(() => store.updateAgentProfile(room, { requestId: crypto.randomUUID(), agentId: 'engineer', name: '변경', instruction: '변경' }), e => e.code === 'room_busy');
  release?.(); store.stop(room); await active.completion; store.close();
});

async function openRuntime(t) {
  const observed = [];
  const app = createDemoServer({ env: { DEMO_FAKE_MODE: '1' }, runner: async agent => { observed.push({ id: agent.id, name: agent.name, prompt: agent.prompt }); return { content: `hello from ${agent.name}`, model: 'fixture', durationMs: 1, truncated: false }; } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const room = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
  return { app, base, room, observed };
}
function socketClient(base, roomId) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/live');
  const packets = [], waiters = [];
  ws.on('message', bytes => {
    const packet = JSON.parse(bytes.toString()); packets.push(packet);
    for (const waiter of [...waiters]) if (waiter.predicate(packet)) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(packet); }
  });
  const wait = predicate => {
    const hit = packets.find(predicate); if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => { const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('WS wait timeout')); }, 3000) }; waiters.push(waiter); });
  };
  ws.on('open', () => ws.send(JSON.stringify({ type: 'join', roomId })));
  return { ws, wait };
}

test('WebSocket profile edit event is visible and the edited profile drives the next turn', async t => {
  const { base, room, observed } = await openRuntime(t);
  const client = socketClient(base, room.id); t.after(() => client.ws.terminate());
  await client.wait(p => p.event === 'snapshot');
  const requestId = crypto.randomUUID();
  client.ws.send(JSON.stringify({ type: 'agent_profile_update', requestId, agentId: 'critic', name: '리뷰어', instruction: '답변의 실패 조건을 한 줄로 요약하세요.' }));
  const updated = await client.wait(p => p.event === 'agent_profile_updated');
  assert.equal(updated.data.requestId, requestId); assert.equal(updated.data.agent.name, '리뷰어'); assert.match(updated.data.agent.instruction, /실패 조건/);
  client.ws.send(JSON.stringify({ type: 'turn', requestId: crypto.randomUUID(), targetAgentId: 'critic', content: '검토해줘' }));
  const done = await client.wait(p => p.event === 'done');
  assert.equal(done.data.room.messages.at(-1).agentName, '리뷰어');
  assert.deepEqual(observed.at(-1), { id: 'critic', name: '리뷰어', prompt: '답변의 실패 조건을 한 줄로 요약하세요.' });
});
