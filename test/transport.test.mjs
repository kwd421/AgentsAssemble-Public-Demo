import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createDemoServer } from '../server.mjs';
import { AgentError } from '../lib/ai.mjs';

async function runtime(t, extra = {}) {
  const app = createDemoServer({ env: { AI_MAX_TOKENS: '3000', DEMO_FAKE_MODE: '1' }, ...extra });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  const response = await fetch(`${base}/api/rooms`, { method: 'POST' });
  const room = await response.json();
  return { ...app, base, room };
}
function connect(base, roomId, origin) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/live', origin ? { origin } : {});
  const packets = [], waiters = [];
  ws.on('message', bytes => {
    const p = JSON.parse(bytes.toString()); packets.push(p);
    for (const waiter of [...waiters]) if (waiter.predicate(p)) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(p); }
  });
  const wait = predicate => {
    const previous = packets.find(predicate); if (previous) return Promise.resolve(previous);
    return new Promise((resolve, reject) => { const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('WS wait timeout')); }, 3000) }; waiters.push(waiter); });
  };
  ws.on('open', () => ws.send(JSON.stringify({ type: 'join', roomId })));
  return { ws, packets, wait };
}
test('health exposes effective limits but never credentials or false Rust status', async t => {
  const { base } = await runtime(t);
  const response = await fetch(`${base}/api/health`);
  const data = await response.json();
  assert.equal(data.maxTokens, 3000); assert.equal(data.rustConnected, false); assert.equal(data.transport, 'websocket');
  assert.equal(data.apiKey, undefined); assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('WebSocket joins, accepts one targeted turn, and survives duplicate submit without extra output', async t => {
  const { base, room, store } = await runtime(t);
  const c = connect(base, room.id); t.after(() => c.ws.terminate());
  await c.wait(p => p.event === 'snapshot');
  const command = { type: 'turn', requestId: crypto.randomUUID(), content: '@engineer 테스트' };
  c.ws.send(JSON.stringify(command));
  const done = await c.wait(p => p.event === 'done');
  assert.equal(done.data.room.messages.length, 2); assert.equal(done.data.room.messages[1].agentId, 'engineer');
  const n = c.packets.length; c.ws.send(JSON.stringify(command));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(c.packets.slice(n).some(p => p.event === 'snapshot')); assert.equal(store.get(room.id).userTurns, 1);
});
test('expired room returns explicit error, not silent missing responses', async t => {
  const { base } = await runtime(t);
  const c = connect(base, 'missing-room-id'); t.after(() => c.ws.terminate());
  const packet = await c.wait(p => p.event === 'command_error'); assert.equal(packet.data.code, 'room_not_found');
});
test('cross-origin writes are rejected', async t => {
  const { base } = await runtime(t);
  const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
  assert.equal(response.status, 403);
});
test('a fresh connection sees the current room snapshot without polling', async t => {
  const { base, room, store } = await runtime(t);
  const r = store.get(room.id);
  await store.start(r, { type: 'turn', requestId: crypto.randomUUID(), content: '@critic context' }).completion;
  const c = connect(base, room.id); t.after(() => c.ws.terminate());
  const packet = await c.wait(p => p.event === 'snapshot'); assert.equal(packet.data.userTurns, 1); assert.equal(packet.data.messages.length, 2);
});
test('legacy SSE tabs receive agent failures and a done event', async t => {
  const { base, room } = await runtime(t, { runner: async a => { if (a.id === 'engineer') throw new AgentError('ai_timeout', { retryable: true }); return { content: 'ok', model: 'test' }; } });
  const response = await fetch(`${base}/api/rooms/${room.id}/turns/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'test' }) });
  const text = await response.text();
  assert.equal(response.status, 200); assert.match(text, /event: agent_error/); assert.match(text, /ai_timeout/); assert.match(text, /event: done/);
});
test('unknown API routes do not return the SPA HTML', async t => {
  const { base } = await runtime(t); const response = await fetch(`${base}/api/not-a-route`);
  assert.equal(response.status, 404); assert.equal((await response.json()).error, 'not_found');
});
