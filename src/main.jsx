import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import { ArrowLeft, AtSign, Bot, ChevronDown, Hash, Home, RefreshCw, Save, Search, Send, Square, Users } from 'lucide-react';
import { useRoom } from './useRoom.js';
import './index.css';
import './demo.css';

const LABELS = { idle: '대기', queued: '차례 대기', running: '응답 생성 중', retrying: '재시도 중', failed: '응답 실패', done: '응답 완료', cancelled: '중지됨' };
function Avatar({ agent, human }) {
  return <span className={`dc-message-avatar mt-0.5 ${human ? 'demo-human-avatar' : 'agent'}`} aria-hidden="true"><span className="grid h-full w-full place-items-center text-[12px] font-black">{human ? '나' : agent?.initial || <Bot size={16} />}</span></span>;
}
function MessageRow({ message, agents }) {
  const isAgent = message.kind === 'agent';
  const agent = agents.find(a => a.id === message.agentId);
  const when = new Date(message.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return <article className="dc-message grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-1.5" tabIndex={0}>
    <Avatar agent={agent} human={!isAgent} />
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="dc-message-author text-[15px] font-semibold text-text-primary">{isAgent ? message.agentName : '나'}</span>
        {isAgent && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-accent">{message.agentLabel}</span>}
        <time className="text-[11px] text-text-muted">{when}</time>
        {isAgent && <span className="demo-message-meta" title={message.model}>{message.model} · {(Math.max(0, message.durationMs || 0) / 1000).toFixed(1)}초{message.retryOf ? ' · 재시도 응답' : ''}</span>}
      </div>
      {isAgent ? <div className="demo-markdown text-[14px] leading-relaxed text-text-secondary"><Markdown skipHtml disallowedElements={['img']} components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" /> }}>{message.content}</Markdown></div> : <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-secondary preserve-words">{message.content}</div>}
      {message.truncated && <p className="demo-warning">출력 한도에 도달해 답변이 잘렸습니다. 후속 질문으로 이어서 요청하세요.</p>}
    </div>
  </article>;
}
function Thinking({ agent }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - (agent.startedAt || Date.now())) / 1000))); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, [agent.startedAt]);
  return <div className="dc-message grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-2"><Avatar agent={agent} /><div><strong className="text-[14px]">{agent.name}</strong><div className="flex items-center gap-2 text-[12px] text-text-muted" role="status"><span className="dc-typing-dots"><span /><span /><span /></span>{LABELS[agent.state]} · {elapsed}초</div>{agent.retryMessage && <p className="text-[12px] text-text-muted">{agent.retryMessage}</p>}</div></div>;
}
function RetryButton({ failure, disabled, retry }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!failure.retryAt || failure.retryAt <= Date.now()) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [failure.retryAt]);
  const seconds = Math.max(0, Math.ceil(((failure.retryAt || 0) - now) / 1000));
  return <button className="demo-target-chip" disabled={disabled || seconds > 0} onClick={() => retry(failure.id)}>{seconds ? `${seconds}초 뒤 재시도 가능` : '이 에이전트만 다시 시도'}</button>;
}
function AgentProfileEditor({ agent, disabled, pending, onBack, onMention, onSave }) {
  const [name, setName] = useState(agent.name);
  const [instruction, setInstruction] = useState(agent.instruction || '');
  useEffect(() => { setName(agent.name); setInstruction(agent.instruction || ''); }, [agent.id, agent.name, agent.instruction]);
  const cleanName = name.trim(), cleanInstruction = instruction.trim();
  const invalid = !cleanName || cleanName.length > 40 || !cleanInstruction || cleanInstruction.length > 1200;
  const dirty = cleanName !== agent.name || cleanInstruction !== (agent.instruction || '');
  return <div className="demo-profile-editor">
    <button className="demo-profile-back" onClick={onBack}><ArrowLeft size={15} /> 멤버 목록</button>
    <div className="demo-profile-head"><span className="demo-agent-initial">{agent.initial}</span><div className="min-w-0"><strong>{agent.name}</strong><small>@{agent.id} · {agent.role}</small></div></div>
    <div className="demo-profile-meta"><span>모델</span><strong title={agent.model}>{agent.model || '모델 미설정'}</strong></div>
    <label className="demo-profile-field"><span>프로필 이름 <small>{name.length}/40</small></span><input value={name} onChange={e => setName(e.target.value)} maxLength={40} disabled={disabled} /></label>
    <label className="demo-profile-field"><span>지시문 <small>{instruction.length}/1200</small></span><textarea value={instruction} onChange={e => setInstruction(e.target.value)} maxLength={1200} rows={10} disabled={disabled} /></label>
    <p className="demo-profile-help">이 설정은 현재 임시 Room에만 저장되며 다음 응답부터 실제 system prompt에 반영됩니다. 방이 만료되거나 재배포되면 사라집니다.</p>
    <div className="demo-profile-actions"><button className="demo-secondary-button" onClick={onMention} disabled={disabled}><AtSign size={14} /> @{agent.id}</button><button className="demo-primary-button" disabled={disabled || invalid || !dirty} onClick={() => onSave(agent.id, cleanName, cleanInstruction)}><Save size={14} /> {pending ? '저장 중' : '저장'}</button></div>
  </div>;
}
function App() {
  const { room, draft, setDraft, connection, error, setError, pending, submit, retry, updateAgentProfile, cancel, reset } = useRoom();
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const feedRef = useRef(null), bottom = useRef(true);
  const busy = room.busy || pending;
  const connected = connection === 'connected';
  const selectedAgent = room.agents.find(a => a.id === selectedAgentId) || null;
  useEffect(() => { if (bottom.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [room.messages.length, room.failures.length, room.busy]);
  useEffect(() => { if (selectedAgentId && !room.agents.some(a => a.id === selectedAgentId)) setSelectedAgentId(null); }, [room.agents, selectedAgentId]);
  const messages = room.messages.filter(m => !query || m.content.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function onKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }
  function appendMention(agent) { setDraft(v => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@${agent.id} `); }
  return <div className="dc-shell flex h-screen max-h-screen overflow-hidden text-text-primary">
    <nav className="dc-rail flex shrink-0 flex-col items-center gap-2 py-3" aria-label="방 목록">
      <button className="dc-rail-home" data-active="true" onClick={() => { setSelectedAgentId(null); reset(); }} disabled={busy} title="새 임시 체험방" aria-label="새 체험방"><Home size={22} /></button>
      <div className="dc-server-divider" /><div className="dc-room-stack"><button className="dc-server-btn" data-active="true" aria-label="현재 체험방"><span className="text-[12px] font-black">AA</span></button></div>
    </nav>
    <aside className="dc-sidebar flex shrink-0 flex-col" aria-label="채널 목록">
      <header className="dc-sidebar-head shrink-0" data-tone="violet"><button className="dc-server-header-button" onClick={() => { setSelectedAgentId(null); reset(); }} disabled={busy} title="새 임시 체험방 시작"><span className="truncate">AgentsAssemble Demo</span><ChevronDown size={16} /></button>
        <div className="dc-sidebar-banner"><span className="dc-sidebar-server-icon">AA</span><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-wide text-white/70">Room</p><p className="text-[12px] font-semibold text-text-muted">Wanted AI Championship 2026</p></div></div>
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 chat-scroll" aria-label="채널"><section className="dc-channel-section"><div className="dc-channel-category"><ChevronDown size={12} /> Text Channels</div><button data-active="true" className="dc-channel"><Hash size={18} /><span>general</span></button></section>
        <div className="demo-runtime-card"><strong>{room.runtime?.mode === 'fixture' ? 'UI 테스트 모드' : 'Cloud API Runtime'}</strong><p>원본 Rust 미연결</p><p>웹 검색 · 로컬 실행 없음</p><p>{room.runtime?.maxTokens || '—'} tokens · {Math.round((room.runtime?.timeoutMs || 0) / 1000)}초 제한</p></div>
      </nav>
      <footer className="dc-user-area shrink-0"><div className="flex items-center gap-2 px-2 py-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-black text-white">YOU</span><div className="min-w-0 flex-1"><p className="text-[12px] font-bold">Public Visitor</p><p className="text-[10px] text-text-muted">{room.userTurns}/{room.maxUserTurns} turns · memory-only</p></div><button className="dc-head-icon" onClick={() => { setSelectedAgentId(null); reset(); }} disabled={busy} title="새 체험방" aria-label="새 체험방"><RefreshCw size={16} /></button></div></footer>
    </aside>
    <main className="dc-chat flex min-w-0 flex-1 flex-col" aria-label="채널 내용">
      <header className="dc-chat-head flex h-12 shrink-0 items-center gap-2 px-3 lg:px-4" data-members-available="true" data-members-open={members}>
        <Hash size={20} className="shrink-0 text-text-muted" /><h1 className="text-[15px] font-bold">general</h1><span className="demo-connection" data-state={connection}>{connected ? 'WebSocket 연결됨' : connection === 'connecting' ? '연결 중' : '재연결 대기'}</span>
        <div className="dc-head-actions ml-auto flex shrink-0 items-center gap-1.5"><button className="dc-head-icon" onClick={() => setMembers(v => !v)} aria-label="멤버 목록" aria-pressed={members}><Users size={18} /></button><label className="dc-head-search hidden md:flex"><span className="sr-only">general 검색</span><input type="search" placeholder="general 검색" value={query} onChange={e => setQuery(e.target.value)} /><Search size={14} /></label></div>
      </header>
      {error && <div className="demo-alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="안내 닫기">×</button></div>}
      {room.runtime?.mode === 'fixture' && <div className="demo-alert" role="status">실제 AI가 아닌 UI 테스트용 고정 응답입니다.</div>}
      <div ref={feedRef} className="relative min-h-0 flex-1 overflow-y-auto py-4 chat-scroll" style={{ overflowAnchor: 'none' }} onScroll={e => { const n = e.currentTarget; bottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 100; }}>
        <section className="dc-channel-intro px-4 pb-5 pt-2"><span className="dc-channel-intro-icon"><Hash size={26} /></span><h2 className="mt-3 text-[28px] font-black leading-tight">AgentsAssemble Demo</h2><p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-text-muted">같은 Room 기록을 여러 AI 역할이 읽고 차례로 답합니다. @engineer처럼 한 명을 부르거나 @all로 모두 부르세요.</p><p className="mt-1 text-[12px] text-text-muted">우측 Agent 카드를 누르면 이 Room에서 사용할 이름과 지시문을 직접 바꿀 수 있습니다. 웹 검색은 연결되어 있지 않습니다.</p></section>
        {!room.messages.length && <p className="px-4 text-[13px] text-text-muted">아직 메시지가 없습니다. 첫 질문을 남겨 보세요.</p>}
        {query && !messages.length && <p className="px-4 text-[13px] text-text-muted">검색 결과가 없습니다.</p>}
        {messages.map(m => <MessageRow key={m.id} message={m} agents={room.agents} />)}
        {room.agents.filter(a => ['running', 'retrying'].includes(a.state)).map(a => <Thinking key={a.id} agent={a} />)}
        {room.failures.map(f => <div className="demo-failure" role="status" key={f.id}><strong>{room.agents.find(a => a.id === f.agentId)?.name} 응답 실패</strong><p>{f.message}</p><small>{f.code}{f.traceId ? ` · 진단 ID ${f.traceId.slice(0, 8)}` : ''}</small>{f.canRetry && <RetryButton failure={f} disabled={busy || !connected} retry={retry} />}{f.manualRetries > 0 && <p>수동 재시도 1회를 사용했습니다.</p>}</div>)}
      </div>
      <div className="shrink-0 px-4 pb-5"><div className="demo-composer-info"><span>{room.agents.filter(a => a.state === 'queued').map(a => a.name).join(' → ')}{room.agents.some(a => a.state === 'queued') ? ' 차례 대기' : 'Enter 전송 · Shift+Enter 줄바꿈'}</span><span>{draft.length}/2500</span></div>
        <section className="dc-composer-shell"><div className="dc-composer-bar"><textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} className="dc-composer-input" placeholder={room.userTurns >= room.maxUserTurns ? '대화 횟수 제한에 도달했습니다. 새 방을 시작하세요.' : '메시지 입력'} aria-label="채팅 입력" maxLength={2500} rows={1} disabled={room.userTurns >= room.maxUserTurns} />
          <button className="dc-composer-button" data-role="mention" onClick={() => setDraft(v => v + (v && !v.endsWith(' ') ? ' ' : '') + '@all ')} title="전체 멘션" aria-label="전체 멘션"><AtSign size={17} /></button>
          {busy ? <button className="dc-composer-button" onClick={cancel} disabled={!connected || pending} title="응답 중지" aria-label="응답 중지"><Square size={17} /></button> : <button className="dc-composer-button send" data-role="send" disabled={!connected || !draft.trim() || room.userTurns >= room.maxUserTurns} onClick={submit} aria-label="채팅 메시지 보내기"><Send size={17} /></button>}
        </div></section>
        {room.userTurns >= room.maxUserTurns && <button className="demo-target-chip mt-2" disabled={busy} onClick={() => { setSelectedAgentId(null); reset(); }}>새 체험방 시작</button>}
      </div>
    </main>
    {members && <aside className="dc-members demo-right-panel hidden shrink-0 xl:flex xl:flex-col" aria-label="방 연결 정보"><div className="dc-right-panel-header-spacer" /><div className="dc-right-panel-tabs"><button data-active="true">{selectedAgent ? '에이전트 프로필' : '멤버'}</button></div><section className="min-h-0 flex-1"><div className="dc-room-connection-panel flex h-full min-h-0 flex-col"><div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 chat-scroll">
      {selectedAgent ? <AgentProfileEditor agent={selectedAgent} disabled={!connected || busy} pending={pending} onBack={() => setSelectedAgentId(null)} onMention={() => appendMention(selectedAgent)} onSave={updateAgentProfile} /> : <><p className="mb-2 px-2 text-[11px] font-black uppercase tracking-wide text-text-muted">참가자 — 사람 1 · AI 역할 {room.agents.length}</p><section className="dc-person-member-group"><div className="flex items-center gap-2 px-2 py-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[10px] font-black text-white">YOU</span><span><strong className="block text-[12px]">Public Visitor</strong><small className="text-[10px] text-text-muted">{connected ? '브라우저 연결됨' : '연결 확인 중'}</small></span></div></section><section className="dc-person-member-group mt-3"><p className="dc-person-owner-label">Cloud API Agents</p><div className="dc-owner-agent-list">{room.agents.map(a => <button key={a.id} className="demo-member-button" onClick={() => setSelectedAgentId(a.id)} title={`${a.name} 프로필 보기/편집`}><span className="demo-agent-initial">{a.initial}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[12px]">{a.name}</strong><small className="block truncate text-[10px] text-text-muted">{a.model || '모델 미설정'}</small><small className="block text-[10px] text-text-muted">{a.configured ? LABELS[a.state] : '설정 필요'}</small></span><span className="demo-agent-dot" data-state={!a.configured ? 'failed' : a.state} /></button>)}</div></section><p className="demo-runtime-note">Agent 카드를 누르면 현재 프로필 이름과 지시문을 확인하고 이 Room에서 편집할 수 있습니다.</p></>}
    </div></div></section></aside>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
