import { randomBytes, randomUUID } from 'node:crypto';
import { AGENTS, modelFor, selectAgents } from './agents.mjs';
import { aiConfig, callAgent, publicError } from './ai.mjs';

export class RoomError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export class RoomStore {
  constructor({ env = process.env, runner = callAgent, maxRooms = 200, maxJobs = 6, ttlMs = 45 * 60 * 1000, clock = Date.now } = {}) {
    Object.assign(this, { env, runner, maxRooms, maxJobs, ttlMs, clock });
    this.rooms = new Map(); this.jobs = 0;
  }
  prune() {
    for (const [id, r] of this.rooms) if (!r.busy && this.clock() - r.updatedAt > this.ttlMs) {
      this.emit(r, 'expired', {});
      clearTimeout(r.disconnectTimer); this.rooms.delete(id);
    }
  }
  create() {
    this.prune();
    if (this.rooms.size >= this.maxRooms) throw new RoomError('room_capacity', 503);
    const room = { id: randomBytes(24).toString('base64url'), createdAt: this.clock(), updatedAt: this.clock(), userTurns: 0, busy: false, messages: [], failures: {}, states: {}, listeners: new Set(), commands: new Set(), seq: 0, lastTurn: null, controller: null };
    this.rooms.set(room.id, room); return room;
  }
  get(id) { this.prune(); const r = this.rooms.get(id); if (!r) throw new RoomError('room_not_found', 404); return r; }
  snapshot(r) {
    const config = aiConfig(this.env);
    return { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, expiresAt: r.updatedAt + this.ttlMs, userTurns: r.userTurns, maxUserTurns: 8, busy: r.busy, seq: r.seq, lastTurnId: r.lastTurn?.id, messages: r.messages,
      runtime: { mode: config.fake ? 'fixture' : 'cloud-api', rustConnected: false, tools: false, transport: 'websocket', maxTokens: config.maxTokens, timeoutMs: config.timeoutMs },
      agents: AGENTS.map(a => ({ id: a.id, name: a.name, label: a.label, initial: a.initial, role: a.role, model: config.fake ? 'fixture' : modelFor(a, this.env), configured: config.fake || Boolean(config.apiKey && modelFor(a, this.env)), state: r.states[a.id] || 'idle' })),
      failures: Object.values(r.failures).map(({ context, ...f }) => ({ ...f, canRetry: !r.busy && f.turnId === r.lastTurn?.id && f.manualRetries < 1 && f.retryable })),
    };
  }
  emit(r, event, data) {
    const packet = { event, data, seq: ++r.seq };
    for (const listener of r.listeners) { try { listener(packet); } catch { /* Transport cleanup owns broken sockets. */ } }
  }
  subscribe(r, listener) {
    clearTimeout(r.disconnectTimer); r.listeners.add(listener);
    listener({ event: 'snapshot', data: this.snapshot(r), seq: r.seq });
    return () => {
      r.listeners.delete(listener);
      if (!r.listeners.size && r.busy) {
        r.disconnectTimer = setTimeout(() => { if (!r.listeners.size) r.controller?.abort(); }, 5000);
        r.disconnectTimer.unref?.();
      }
    };
  }
  stop(r) { r.controller?.abort(); }
  start(r, request) {
    if (!request || typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(request.requestId)) throw new RoomError('invalid_request_id');
    if (r.commands.has(request.requestId)) return { duplicate: true, completion: Promise.resolve() };
    if (r.busy) throw new RoomError('room_busy', 409);
    if (this.jobs >= this.maxJobs) throw new RoomError('server_busy', 503);
    let agents, turnId, retry, content;
    if (request.type === 'retry') {
      retry = r.failures[request.failureId];
      if (!retry || retry.turnId !== r.lastTurn?.id || retry.manualRetries >= 1 || !retry.retryable || this.clock() < (retry.retryAt || 0)) throw new RoomError('retry_not_available', 409);
      agents = AGENTS.filter(a => a.id === retry.agentId); turnId = retry.turnId;
      retry.manualRetries++;
    } else if (request.type === 'turn' || !request.type) {
      if (r.userTurns >= 8) throw new RoomError('turn_limit_reached', 429);
      content = typeof request.content === 'string' ? request.content.trim() : '';
      if (!content || content.length > 2500) throw new RoomError('invalid_message');
      agents = selectAgents(content, request.targetAgentId);
      if (!agents.length) throw new RoomError('unknown_agent');
      turnId = randomUUID(); r.lastTurn = { id: turnId }; r.failures = {};
      for (const a of AGENTS) r.states[a.id] = 'idle';
      r.userTurns++;
    } else throw new RoomError('unknown_command');
    r.commands.add(request.requestId);
    r.busy = true; this.jobs++; r.updatedAt = this.clock();
    r.controller = new AbortController();
    for (const a of agents) r.states[a.id] = 'queued';
    let userMessage;
    if (content) {
      userMessage = { id: randomUUID(), kind: 'user', content, turnId, requestId: request.requestId, createdAt: new Date(this.clock()).toISOString() };
      r.messages.push(userMessage);
    }
    this.emit(r, 'accepted', { requestId: request.requestId, userMessage, userTurns: r.userTurns, maxUserTurns: 8, turnId, retry: Boolean(retry), agentIds: agents.map(a => a.id) });
    const completion = this.execute(r, agents, turnId, retry);
    return { duplicate: false, completion };
  }
  async execute(r, agents, turnId, retry) {
    const signal = r.controller.signal;
    try {
      for (const agent of agents) {
        if (signal.aborted) break;
        r.states[agent.id] = 'running';
        this.emit(r, 'agent_start', { agentId: agent.id, startedAt: this.clock() });
        // A manual retry sees the exact pre-failure context, not a later critic answer/new question.
        const context = retry?.context || r.messages.slice();
        try {
          const answer = await this.runner(agent, context, { env: this.env, signal, onRetry: data => {
            r.states[agent.id] = 'retrying'; this.emit(r, 'agent_retry', { agentId: agent.id, ...data });
          } });
          if (signal.aborted) break;
          const message = { id: randomUUID(), kind: 'agent', agentId: agent.id, agentName: agent.name, agentLabel: agent.label, content: answer.content, model: answer.model, durationMs: answer.durationMs, truncated: answer.truncated, turnId, retryOf: retry?.id, createdAt: new Date(this.clock()).toISOString() };
          r.messages.push(message); r.updatedAt = this.clock(); r.states[agent.id] = 'done';
          if (retry) delete r.failures[retry.id];
          this.emit(r, 'agent', message);
        } catch (e) {
          if (signal.aborted) break;
          const info = publicError(e);
          const failure = { id: retry?.id || randomUUID(), agentId: agent.id, turnId, ...info, manualRetries: retry?.manualRetries || 0, retryAt: this.clock() + (info.retryAfterMs || 0), context };
          r.failures[failure.id] = failure; r.states[agent.id] = 'failed';
          const { context: _, ...safe } = failure;
          this.emit(r, 'agent_error', safe);
        }
      }
    } finally {
      if (signal.aborted) for (const a of agents) if (['queued', 'running', 'retrying'].includes(r.states[a.id])) r.states[a.id] = 'cancelled';
      r.busy = false; this.jobs--; r.controller = null; r.updatedAt = this.clock(); clearTimeout(r.disconnectTimer);
      this.emit(r, 'done', { cancelled: signal.aborted, room: this.snapshot(r) });
    }
  }
  close() { for (const r of this.rooms.values()) { clearTimeout(r.disconnectTimer); this.stop(r); } }
}
