import { useEffect, useRef, useState } from 'react';

const KEY = 'aa-demo-room-v3';
const EMPTY = { messages: [], failures: [], agents: [], userTurns: 0, maxUserTurns: 8, busy: false };
const ERRORS = {
  room_not_found: '서버 재배포 또는 만료로 이전 방이 사라졌습니다. 새 체험방을 열었습니다.',
  room_busy: '다른 응답이 진행 중입니다.', server_busy: '서버가 사용 중입니다. 잠시 뒤 다시 시도하세요.',
  rate_limited: '요청이 많습니다. 잠시 뒤 다시 시도하세요.',
  turn_limit_reached: '최대 대화 횟수에 도달했습니다. 새 방에서 다시 시작하세요.',
  retry_not_available: '이 응답은 더 이상 재시도할 수 없습니다. 마지막 질문의 실패한 응답만 한 번 재시도할 수 있습니다.',
  invalid_message: '메시지는 1~2,500자로 입력하세요.', room_capacity: '체험방이 가득 찼습니다. 잠시 뒤 다시 시도하세요.',
  invalid_agent_profile: '프로필 이름은 1~40자, 지시문은 1~1,200자로 입력하세요.',
  unknown_agent: '해당 에이전트를 찾지 못했습니다.',
};
function stored() { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }
function save(value) { try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch { /* private browser */ } }
export function useRoom() {
  const [room, setRoom] = useState(EMPTY);
  const [draft, setDraft] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const socket = useRef(null), pendingCommand = useRef(null), seq = useRef(-1), profileQueue = useRef(null);
  useEffect(() => {
    let stopped = false, timer, ws, id, backoff = 500;
    const controller = new AbortController();
    function finishProfileQueue(ok) {
      const queue = profileQueue.current;
      profileQueue.current = null;
      try { queue?.onDone?.(ok); } catch { /* UI callback */ }
    }
    function acceptSnapshot(data, number) {
      seq.current = number ?? data.seq;
      setRoom(data); setConnection('connected'); setPending(false);
      const command = pendingCommand.current;
      if (command?.type === 'turn' && data.messages.some(m => m.requestId === command.requestId)) {
        setDraft(current => current.trim() === command.content ? '' : current);
      }
      pendingCommand.current = null;
    }
    function updateAgent(agentId, patch) { setRoom(r => ({ ...r, agents: r.agents.map(a => a.id === agentId ? { ...a, ...patch } : a) })); }
    function sendNextQueuedProfile() {
      const queue = profileQueue.current;
      const next = queue?.items.shift();
      if (!next) {
        pendingCommand.current = null; setPending(false); setError(''); finishProfileQueue(true); return;
      }
      const request = { type: 'agent_profile_update', ...next, requestId: crypto.randomUUID() };
      pendingCommand.current = request;
      try { ws.send(JSON.stringify(request)); }
      catch { pendingCommand.current = null; setPending(false); setError('프로필을 저장하지 못했습니다.'); finishProfileQueue(false); }
    }
    function handle(packet) {
      const { event, data, seq: number } = packet;
      if (event === 'snapshot') { acceptSnapshot(data, number); return; }
      if (event === 'command_error') {
        setError(ERRORS[data.code] || `요청을 처리하지 못했습니다. (${data.code})`);
        setPending(false); pendingCommand.current = null; finishProfileQueue(false);
        if (data.code === 'room_not_found') { save(''); setEpoch(n => n + 1); }
        return;
      }
      if (event === 'expired') { finishProfileQueue(false); save(''); setError(ERRORS.room_not_found); setEpoch(n => n + 1); return; }
      if (typeof number === 'number' && number <= seq.current) return;
      if (typeof number === 'number') seq.current = number;
      if (event === 'agent_profile_updated') {
        const command = pendingCommand.current;
        if (command?.requestId === data.requestId) {
          updateAgent(data.agent.id, data.agent);
          if (profileQueue.current) sendNextQueuedProfile();
          else { pendingCommand.current = null; setPending(false); setError(''); }
        } else updateAgent(data.agent.id, data.agent);
        return;
      }
      if (event === 'accepted') {
        const command = pendingCommand.current;
        if (command?.requestId === data.requestId && command.type === 'turn') setDraft(current => current.trim() === command.content ? '' : current);
        pendingCommand.current = null; setPending(false); setError('');
        setRoom(r => ({ ...r, busy: true, userTurns: data.userTurns, lastTurnId: data.turnId,
          failures: data.retry ? r.failures : [],
          messages: data.userMessage && !r.messages.some(m => m.id === data.userMessage.id) ? [...r.messages, data.userMessage] : r.messages,
          agents: r.agents.map(a => ({ ...a, state: data.agentIds.includes(a.id) ? 'queued' : data.retry ? a.state : 'idle' })) }));
      }
      if (event === 'agent_start') updateAgent(data.agentId, { state: 'running', startedAt: data.startedAt, retryMessage: '' });
      if (event === 'agent_retry') updateAgent(data.agentId, { state: 'retrying', retryMessage: `${data.message} 자동 재시도 ${data.attempt}회차 준비 중` });
      if (event === 'agent') {
        setRoom(r => ({ ...r, messages: r.messages.some(m => m.id === data.id) ? r.messages : [...r.messages, data], failures: r.failures.filter(f => f.id !== data.retryOf), agents: r.agents.map(a => a.id === data.agentId ? { ...a, state: 'done' } : a) }));
      }
      if (event === 'agent_error') {
        updateAgent(data.agentId, { state: 'failed' });
        setRoom(r => ({ ...r, failures: [...r.failures.filter(f => f.id !== data.id), data] }));
      }
      if (event === 'done') { acceptSnapshot(data.room, number); if (data.cancelled) setError('응답 생성을 중지했습니다. 이미 받은 답변은 유지됩니다.'); }
    }
    function connect() {
      if (stopped) return;
      setConnection('connecting');
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`);
      socket.current = ws;
      ws.onopen = () => { if (!stopped) { backoff = 500; ws.send(JSON.stringify({ type: 'join', roomId: id })); } };
      ws.onmessage = e => { if (stopped) return; try { handle(JSON.parse(e.data)); } catch { setError('서버 이벤트를 해석하지 못했습니다. 연결을 다시 시도합니다.'); ws.close(); } };
      ws.onerror = () => { if (!stopped) setConnection('disconnected'); };
      ws.onclose = () => {
        if (stopped) return;
        finishProfileQueue(false); setConnection('disconnected'); setPending(false); pendingCommand.current = null;
        timer = setTimeout(connect, backoff); backoff = Math.min(10000, backoff * 2);
      };
    }
    async function init() {
      setConnection('connecting'); seq.current = -1;
      try {
        id = stored();
        if (id) {
          const response = await fetch(`/api/rooms/${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store' });
          if (response.status === 404) { id = ''; save(''); setError(ERRORS.room_not_found); }
          else if (!response.ok) throw new Error(ERRORS[(await response.json()).error] || '체험방을 불러오지 못했습니다.');
          else setRoom(await response.json());
        }
        if (!id) {
          const response = await fetch('/api/rooms', { method: 'POST', signal: controller.signal });
          const data = await response.json();
          if (!response.ok) throw new Error(ERRORS[data.error] || '체험방을 만들지 못했습니다.');
          id = data.id; save(id); setRoom(data);
        }
        connect();
      } catch (e) { if (!stopped) { setConnection('disconnected'); setError(e.message || '연결 실패'); } }
    }
    init();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); finishProfileQueue(false); ws?.close(); if (socket.current === ws) socket.current = null; };
  }, [epoch]);
  function send(command) {
    if (socket.current?.readyState !== WebSocket.OPEN || connection !== 'connected') { setError('서버에 연결된 뒤 다시 시도하세요.'); return false; }
    if (pendingCommand.current || pending || room.busy) return false;
    const request = { ...command, requestId: crypto.randomUUID() };
    pendingCommand.current = request; setPending(true); setError('');
    try { socket.current.send(JSON.stringify(request)); return true; }
    catch { pendingCommand.current = null; setPending(false); setError('전송하지 못했습니다. 입력은 유지됩니다.'); return false; }
  }
  function submit() { const content = draft.trim(); if (content && content.length <= 2500) send({ type: 'turn', content }); }
  function retry(failureId) { send({ type: 'retry', failureId }); }
  function updateAgentProfile(agentId, name, instruction) { return send({ type: 'agent_profile_update', agentId, name, instruction }); }
  function updateAgentProfiles(items, onDone) {
    if (socket.current?.readyState !== WebSocket.OPEN || connection !== 'connected') { setError('서버에 연결된 뒤 다시 시도하세요.'); return false; }
    if (pendingCommand.current || pending || room.busy || profileQueue.current) return false;
    const queue = (Array.isArray(items) ? items : []).filter(x => x?.agentId && x?.name && x?.instruction);
    if (!queue.length) { onDone?.(true); return true; }
    profileQueue.current = { items: queue.slice(1), onDone };
    const request = { type: 'agent_profile_update', ...queue[0], requestId: crypto.randomUUID() };
    pendingCommand.current = request; setPending(true); setError('');
    try { socket.current.send(JSON.stringify(request)); return true; }
    catch { profileQueue.current = null; pendingCommand.current = null; setPending(false); setError('프로필을 저장하지 못했습니다.'); onDone?.(false); return false; }
  }
  function cancel() { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'cancel' })); }
  function reset() { if (room.busy || pending) return; profileQueue.current = null; pendingCommand.current = null; save(''); setRoom(EMPTY); setError(''); setEpoch(n => n + 1); }
  return { room, draft, setDraft, connection, error, setError, pending, submit, retry, updateAgentProfile, updateAgentProfiles, cancel, reset };
}