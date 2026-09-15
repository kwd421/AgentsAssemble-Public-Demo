import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AGENTS, modelFor } from './lib/agents.mjs';
import { aiConfig } from './lib/ai.mjs';
import { RoomStore } from './lib/rooms.mjs';

export function createDemoServer({ env = process.env, runner } = {}) {
  const config = aiConfig(env);
  const store = new RoomStore({ env, runner });
  const app = express();
  const server = createServer(app);
  const rates = new Map();
  const connections = new Map();
  const configuredOrigin = env.APP_PUBLIC_URL ? new URL(env.APP_PUBLIC_URL).origin : null;
  app.disable('x-powered-by'); app.set('trust proxy', 1);
  function ip(req) { return req.ip || String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',').at(-1).trim(); }
  function limited(req) {
    const key = ip(req), now = Date.now();
    let entry = rates.get(key);
    if (!entry || now - entry.started >= 60000) {
      if (!entry && rates.size >= 5000) return true;
      rates.set(key, entry = { started: now, count: 0 });
    }
    return ++entry.count > 24;
  }
  function sameOrigin(req) {
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      return origin.origin === (configuredOrigin || `${env.NODE_ENV === 'production' ? 'https' : 'http'}://${req.headers.host}`);
    } catch { return false; }
  }
  app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      if (!sameOrigin(req)) return res.status(403).json({ error: 'origin_not_allowed' });
      if (req.path !== '/api/health' && limited(req)) return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.3.0', configured: config.fake || AGENTS.every(a => Boolean(config.apiKey && modelFor(a, env))), fakeMode: config.fake, runtime: config.fake ? 'fixture' : 'cloud-api', rustConnected: false, searchEnabled: false, transport: 'websocket', maxTokens: config.maxTokens, timeoutMs: config.timeoutMs, retries: config.retries }));
  app.post('/api/rooms', (_req, res) => res.status(201).json(store.snapshot(store.create())));
  app.get('/api/rooms/:roomId', (req, res) => res.json(store.snapshot(store.get(req.params.roomId))));
  app.post('/api/rooms/:roomId/cancel', (req, res) => { store.stop(store.get(req.params.roomId)); res.json({ ok: true }); });
  // Compatibility for tabs that were open during the deployment. New UI only uses WebSocket.
  app.post('/api/rooms/:roomId/turns/stream', async (req, res, next) => {
    let release;
    const send = ({ event, data }) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    try {
      const room = store.get(req.params.roomId);
      const pending = [];
      release = store.subscribe(room, p => pending.push(p));
      const { completion } = store.start(room, { ...req.body, type: 'turn', requestId: req.body?.requestId || randomUUID() });
      release();
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.flushHeaders();
      for (const p of pending) send(p);
      release = store.subscribe(room, send);
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
      res.once('close', () => { clearInterval(heartbeat); release?.(); });
      await completion;
      clearInterval(heartbeat); release(); res.end();
    } catch (e) { release?.(); if (!res.headersSent) next(e); else res.end(); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.code || (error.type === 'entity.too.large' ? 'invalid_message' : 'server_error') }));
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  function send(ws, event, data, seq) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'slow client'); return; }
    ws.send(JSON.stringify({ event, data, seq }));
  }
  server.on('upgrade', (req, socket, head) => {
    const key = ip(req);
    if (req.url !== '/api/live' || !sameOrigin(req) || limited(req) || (connections.get(key) || 0) >= 6 || wss.clients.size >= 600) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    connections.set(key, (connections.get(key) || 0) + 1);
    let counted = true;
    const uncount = () => { if (!counted) return; counted = false; const n = (connections.get(key) || 1) - 1; if (n) connections.set(key, n); else connections.delete(key); };
    socket.once('close', uncount);
    socket.on('error', () => socket.destroy());
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    let room, release;
    ws.alive = true;
    const joinTimer = setTimeout(() => ws.close(1008, 'join required'), 8000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => { clearTimeout(joinTimer); release?.(); });
    ws.on('message', (bytes, binary) => {
      let command;
      try {
        if (binary) throw new Error('binary');
        command = JSON.parse(bytes.toString());
        if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('shape');
      } catch { send(ws, 'command_error', { code: 'invalid_command' }); return; }
      try {
        if (limited(req)) { send(ws, 'command_error', { requestId: command.requestId, code: 'rate_limited' }); return; }
        if (!room) {
          if (command.type !== 'join' || typeof command.roomId !== 'string') { ws.close(1008, 'join required'); return; }
          room = store.get(command.roomId);
          if (room.listeners.size >= 3) { room = null; ws.close(1013, 'room connection limit'); return; }
          clearTimeout(joinTimer);
          release = store.subscribe(room, p => send(ws, p.event, p.data, p.seq));
          return;
        }
        if (store.get(room.id) !== room) throw new Error('room expired');
        if (command.type === 'cancel') { store.stop(room); send(ws, 'cancel_requested', {}); return; }
        if (command.type === 'sync') { send(ws, 'snapshot', store.snapshot(room), room.seq); return; }
        const { duplicate, completion } = store.start(room, command);
        if (duplicate) send(ws, 'snapshot', store.snapshot(room), room.seq);
        completion.catch(() => send(ws, 'command_error', { code: 'server_error' }));
      } catch (e) {
        send(ws, 'command_error', { requestId: command.requestId, code: e.code || 'server_error' });
        if (e.code === 'room_not_found') ws.close(1008, 'room expired');
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    store.prune();
    for (const [key, entry] of rates) if (Date.now() - entry.started > 60000) rates.delete(key);
  }, 20000);
  heartbeat.unref();
  async function close() {
    clearInterval(heartbeat); store.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); });
  }
  return { app, server, store, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = createDemoServer();
  const port = Number(process.env.PORT || 3000);
  runtime.server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'demo_started', version: '0.3.0', port, maxTokens: aiConfig().maxTokens, timeoutMs: aiConfig().timeoutMs, mode: aiConfig().fake ? 'fixture' : 'cloud-api', rustConnected: false })));
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; const timer = setTimeout(() => process.exit(1), 10000); timer.unref(); runtime.close().then(() => { clearTimeout(timer); process.exit(0); }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
