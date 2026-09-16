import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import { ArrowLeft, AtSign, Bot, ChevronDown, Hash, Home, RefreshCw, Save, Search, Send, Square, Users, X } from 'lucide-react';
import { useRoom } from './useRoom.js';
import './index.css';
import './demo.css';
import './onboarding.css';

const LABELS = { idle: '대기', queued: '차례 대기', running: '응답 생성 중', retrying: '재시도 중', failed: '응답 실패', done: '응답 완료', cancelled: '중지됨' };
const INTRO_KEY = 'aa-demo-intro-v2';
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
function PromptTip() {
  return <div className="demo-prompt-tip"><b>지시문이 잘 먹히려면</b><p><strong>역할 → 우선순위 → 답변 형식 → 하지 말 것</strong> 순으로 구체적으로 적어주세요.</p><code>예: 구현 가능성을 최우선으로 검토하고, 결론 → 이유 → 리스크 순으로 짧게 답하세요. 확실하지 않은 수치는 만들어내지 마세요.</code></div>;
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
    <label className="demo-profile-field"><span>프로필 이름 <small>{name.length}/40</small></span><input value={name} onChange={e => setName(e.target.value)} maxLength={40} disabled={disabled} placeholder="예: 리드 개발자, 아이디어 검토자" /></label>
    <label className="demo-profile-field"><span>지시문 <small>{instruction.length}/1200</small></span><textarea value={instruction} onChange={e => setInstruction(e.target.value)} maxLength={1200} rows={10} disabled={disabled} placeholder="이 Agent가 어떤 역할로, 무엇을 우선해서, 어떤 형식으로 답해야 하는지 적어주세요." /></label>
    <PromptTip />
    <p className="demo-profile-help">이 설정은 현재 임시 Room에만 저장되며 다음 응답부터 실제 system prompt에 반영됩니다. 방이 만료되거나 재배포되면 사라집니다.</p>
    <div className="demo-profile-actions"><button className="demo-secondary-button" onClick={onMention} disabled={disabled}><AtSign size={14} /> @{agent.id}</button><button className="demo-primary-button" disabled={disabled || invalid || !dirty} onClick={() => onSave(agent.id, cleanName, cleanInstruction)}><Save size={14} /> {pending ? '저장 중' : '저장'}</button></div>
  </div>;
}
function IntroModal({ agents, connected, pending, onApply, onClose }) {
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !pending) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pending]);
  function setField(id, field, value) { setDrafts(d => ({ ...d, [id]: { ...(d[id] || {}), [field]: value } })); }
  function applyProfiles() {
    const updates = agents.map(agent => {
      const draft = drafts[agent.id] || {};
      const name = String(draft.name || '').trim();
      const instruction = String(draft.instruction || '').trim();
      if (!name && !instruction) return null;
      return { agentId: agent.id, name: name || agent.name, instruction: instruction || agent.instruction };
    }).filter(Boolean);
    if (!updates.length) { onClose(); return; }
    setSaveError('');
    const started = onApply(updates, ok => { if (ok) onClose(); else setSaveError('프로필을 저장하지 못했습니다. 다시 시도해 주세요.'); });
    if (!started) setSaveError('서버 연결이 완료된 뒤 다시 시도해 주세요.');
  }
  return <div className="demo-intro-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !pending) onClose(); }}>
    <section className={`demo-intro-modal ${page === 1 ? 'setup' : ''}`} role="dialog" aria-modal="true" aria-labelledby="demo-intro-title">
      <button className="demo-intro-close" onClick={onClose} disabled={pending} aria-label="안내 닫기"><X size={20} /></button>
      {page === 0 ? <>
        <div className="demo-intro-kicker">AGENTSASSEMBLE · PUBLIC DEMO</div>
        <h2 id="demo-intro-title">AI 3명에게 그냥 질문해 보세요</h2>
        <p className="demo-intro-lead">한 질문을 전략가 → 엔지니어 → 비평가가 같은 Room 대화를 공유하면서 이어서 검토합니다.</p>
        <div className="demo-intro-grid">
          <article><span>1</span><div><b>그냥 채팅</b><p>멘션 없이 질문하면 세 Agent가 차례대로 답합니다.</p></div></article>
          <article><span>2</span><div><b>한 명만 호출</b><p><code>@engineer</code>처럼 멘션하면 특정 Agent만 답합니다.</p></div></article>
          <article><span>3</span><div><b>Agent 성격 바꾸기</b><p>다음 화면 또는 오른쪽 Agent 카드에서 이름과 지시문을 직접 편집할 수 있습니다.</p></div></article>
        </div>
        <div className="demo-intro-tech"><b>간단한 기술 구조</b><p>WebSocket으로 Room 상태를 실시간 동기화하고, Agent마다 같은 대화 기록과 서로 다른 역할 지시를 Gemini 3.5 Flash-Lite에 전달합니다. 수정한 지시문도 다음 답변부터 즉시 반영됩니다.</p></div>
        <div className="demo-intro-footer"><button className="demo-intro-skip" onClick={onClose}>기본값으로 바로 시작</button><button className="demo-intro-start" onClick={() => setPage(1)}>다음 · Agent 설정</button></div>
      </> : <>
        <button className="demo-setup-back" onClick={() => setPage(0)} disabled={pending}><ArrowLeft size={16} /> 이전</button>
        <div className="demo-intro-kicker">OPTIONAL SETUP</div>
        <h2 id="demo-intro-title">세 Agent를 원하는 방식으로 바꿔보세요</h2>
        <p className="demo-intro-lead">모든 칸은 일부러 비워뒀습니다. <strong>비워두면 현재 기본값을 그대로 사용</strong>하고, 적은 항목만 이 Room에 덮어씁니다.</p>
        <div className="demo-setup-grid">
          {agents.map(agent => {
            const draft = drafts[agent.id] || {};
            return <article className="demo-setup-agent" key={agent.id}>
              <header><span className="demo-agent-initial">{agent.initial}</span><div><b>{agent.name}</b><small>@{agent.id} · {agent.role}</small></div></header>
              <label><span>프로필 이름 <small>{(draft.name || '').length}/40</small></span><input value={draft.name || ''} onChange={e => setField(agent.id, 'name', e.target.value)} maxLength={40} disabled={pending} placeholder={agent.name} /></label>
              <label><span>지시문 <small>{(draft.instruction || '').length}/1200</small></span><textarea value={draft.instruction || ''} onChange={e => setField(agent.id, 'instruction', e.target.value)} maxLength={1200} rows={6} disabled={pending} placeholder={agent.instruction} /></label>
            </article>;
          })}
        </div>
        <PromptTip />
        {saveError && <p className="demo-setup-error">{saveError}</p>}
        <div className="demo-intro-footer"><button className="demo-intro-skip" onClick={onClose} disabled={pending}>전부 기본값으로 시작</button><button className="demo-intro-start" onClick={applyProfiles} disabled={pending || !connected}>{pending ? '설정 적용 중…' : connected ? '설정 적용하고 시작' : '서버 연결 중…'}</button></div>
      </>}
    </section>
  </div>;
}
function App() {
  const { room, draft, setDraft, connection, error, setError, pending, submit, retry, updateAgentProfile, updateAgentProfiles, cancel, reset } = useRoom();
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [showIntro, setShowIntro] = useState(() => { try { return sessionStorage.getItem(INTRO_KEY) !== 'seen'; } catch { return true; } });
  const feedRef = useRef(null), bottom = useRef(true);
  const busy = room.busy || pending;
  const connected = connection === 'connected';
  const selectedAgent = room.agents.find(a => a.id === selectedAgentId) || null;
  useEffect(() => { if (bottom.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [room.messages.length, room.failures.length, room.busy]);
  useEffect(() => { if (selectedAgentId && !room.agents.some(a => a.id === selectedAgentId)) setSelectedAgentId(null); }, [room.agents, selectedAgentId]);
  const messages = room.messages.filter(m => !query || m.content.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function onKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }
  function appendMention(agent) { setDraft(v => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@${agent.id} `); }
  function closeIntro() { try { sessionStorage.setItem(INTRO_KEY, 'seen'); } catch { /* private browser */ } setShowIntro(false); }
  return <>
    <div className="dc-shell flex h-screen max-h-screen overflow-hidden text-text-primary">
      <nav className="dc-rail flex shrink-0 flex-col items-center gap-2 py-3" aria-label="방 목록">
        <button className="dc-rail-home" data-active="true" onClick={() => { setSelectedAgentId(null); reset(); }} disabled={busy} title="새 임시 체험방" aria-label="새 체험방"><Home size={22} /></button>
        <div className="dc-server-divider" /><div className="dc-room-stack"><button className="dc-server-btn" data-active="true" aria-label="현재 체험방"><span className="text-[12px] font-black">AA</span></button></div>
      </nav>
      <aside className="dc-sidebar flex shrink-0 flex-col" aria-label="채널 목록">
        <header className="dc-sidebar-head shrink-0" data-tone="violet"><button className="dc-server-header-button" onClick={() => { setSelectedAgentId(null); reset(); }} disabled={busy} title="새 임시 체험방 시작"><span className="truncate">AgentsAssemble Demo</span><ChevronDown size={16} /></button>
          <div className="dc-sidebar-banner"><span className="dc-sidebar-server-icon">AA</span><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-wide text-white/70">Room</p><p className="text-[12px] font-semibold text-text-muted">Wanted AI Championship 2026</p></div></div>
        </header>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 chat-scroll" aria-label="채널"><section className="dc-channel-section"><div className="dc-channel-category"><ChevronDown size={12} /> Text Channels</div><button data-active="true" className="dc-channel"><Hash size={18} /><span>general</span></button></section>
          <section className="demo-guide-card" aria-label="데모 사용 안내">
            <div className="demo-guide-kicker">HOW TO TRY</div>
            <h3>그냥 질문해 보세요</h3>
            <p className="demo-guide-lead">멘션 없이 말해도 세 AI가 같은 대화 기록을 읽고 각자의 역할로 차례대로 답합니다.</p>
            <div className="demo-guide-step"><span>1</span><div><b>일반 질문</b><p>평소 채팅하듯 입력하면 전략가 → 엔지니어 → 비평가가 이어서 답합니다.</p></div></div>
            <div className="demo-guide-step"><span>2</span><div><b>특정 AI만 호출</b><p><code>@engineer</code>처럼 멘션하면 원하는 Agent에게만 질문할 수 있습니다.</p></div></div>
            <div className="demo-guide-step"><span>3</span><div><b>Agent 직접 편집</b><p>오른쪽 Agent 카드를 눌러 이름과 지시문을 바꾸면 다음 답변부터 바로 반영됩니다.</p></div></div>
            <div className="demo-guide-tech"><b>어떻게 동작하나요?</b><p>WebSocket으로 Room의 메시지와 상태를 실시간 동기화하고, 각 Agent는 앞선 대화를 함께 읽습니다.</p></div>
            <button className="demo-guide-open" onClick={() => setShowIntro(true)}>처음 안내 크게 보기</button>
          </section>
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
          <section className="dc-channel-intro px-4 pb-5 pt-2"><span className="dc-channel-intro-icon"><Hash size={26} /></span><h2 className="mt-3 text-[28px] font-black leading-tight">AgentsAssemble Demo</h2><p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-text-muted">질문을 입력하면 세 AI가 같은 Room 대화를 읽고 서로의 답변을 이어받아 각자의 관점으로 답합니다. 특정 AI만 부르고 싶다면 <b>@engineer</b>처럼 멘션하세요.</p><p className="mt-1 text-[12px] text-text-muted">우측 Agent 카드를 누르면 이 Room에서 사용할 이름과 지시문을 직접 바꿀 수 있습니다. 웹 검색은 연결되어 있지 않습니다.</p></section>
          {!room.messages.length && <p className="px-4 text-[13px] text-text-muted">아직 메시지가 없습니다. 첫 질문을 남겨 보세요.</p>}
          {query && !messages.length && <p className="px-4 text-[13px] text-text-muted">검색 결과가 없습니다.</p>}
          {messages.map(m => <MessageRow key={m.id} message={m} agents={room.agents} />)}
          {room.agents.filter(a => ['running', 'retrying'].includes(a.state)).map(a => <Thinking key={a.id} agent={a} />)}
          {room.failures.map(f => <div className="demo-failure" role="status" key={f.id}><strong>{room.agents.find(a => a.id === f.agentId)?.name} 응답 실패</strong><p>{f.message}</p><small>{f.code}{f.traceId ? ` · 진단 ID ${f.traceId.slice(0, 8)}` : ''}</small>{f.canRetry && <RetryButton failure={f} disabled={busy || !connected} retry={retry} />}{f.manualRetries > 0 && <p>수동 재시도 1회를 사용했습니다.</p>}</div>)}
        </div>
        <div className="shrink-0 px-4 pb-5"><div className="demo-composer-info"><span>{room.agents.filter(a => a.state === 'queued').map(a => a.name).join(' → ')}{room.agents.some(a => a.state === 'queued') ? ' 차례 대기' : 'Enter 전송 · Shift+Enter 줄바꿈'}</span><span>{draft.length}/2500</span></div>
          <section className="dc-composer-shell"><div className="dc-composer-bar"><textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} className="dc-composer-input" placeholder={room.userTurns >= room.maxUserTurns ? '대화 횟수 제한에 도달했습니다. 새 방을 시작하세요.' : '메시지 입력'} aria-label="채팅 입력" maxLength={2500} rows={1} disabled={room.userTurns >= room.maxUserTurns} />
            <button className="dc-composer-button" data-role="mention" onClick={() => setDraft(v => v + (v && !v.endsWith(' ') ? ' ' : '') + '@all ')} title="전체 멘션" aria-label="전체 멘션"><AtSign size={17} /></button>
            {busy ? <button className="dc-composer-button" onClick={cancel} disabled={!connected || pending} title="응답 중지" aria-label="응답 중지"><Square size={17} /></button> : <button className="dc-composer-button send" disabled={!connected || !draft.trim() || room.userTurns >= room.maxUserTurns} onClick={submit} aria-label="채팅 메시지 보내기"><Send size={17} /></button>}
          </div></section>
          {room.userTurns >= room.maxUserTurns && <button className="demo-target-chip mt-2" disabled={busy} onClick={() => { setSelectedAgentId(null); reset(); }}>새 체험방 시작</button>}
        </div>
      </main>
      {members && <aside className="dc-members demo-right-panel hidden shrink-0 xl:flex xl:flex-col" aria-label="방 연결 정보"><div className="dc-right-panel-header-spacer" /><div className="dc-right-panel-tabs"><button data-active="true">{selectedAgent ? '에이전트 프로필' : '멤버'}</button></div><section className="min-h-0 flex-1"><div className="dc-room-connection-panel flex h-full min-h-0 flex-col"><div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 chat-scroll">
        {selectedAgent ? <AgentProfileEditor agent={selectedAgent} disabled={!connected || busy} pending={pending} onBack={() => setSelectedAgentId(null)} onMention={() => appendMention(selectedAgent)} onSave={updateAgentProfile} /> : <><p className="mb-2 px-2 text-[11px] font-black uppercase tracking-wide text-text-muted">참가자 — 사람 1 · AI 역할 {room.agents.length}</p><section className="dc-person-member-group"><div className="flex items-center gap-2 px-2 py-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[10px] font-black text-white">YOU</span><span><strong className="block text-[12px]">Public Visitor</strong><small className="text-[10px] text-text-muted">{connected ? '브라우저 연결됨' : '연결 확인 중'}</small></span></div></section><section className="dc-person-member-group mt-3"><p className="dc-person-owner-label">Cloud API Agents</p><div className="dc-owner-agent-list">{room.agents.map(a => <button key={a.id} className="demo-member-button" onClick={() => setSelectedAgentId(a.id)} title={`${a.name} 프로필 보기/편집`}><span className="demo-agent-initial">{a.initial}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[12px]">{a.name}</strong><small className="block truncate text-[10px] text-text-muted">{a.model || '모델 미설정'}</small><small className="block text-[10px] text-text-muted">{a.configured ? LABELS[a.state] : '설정 필요'}</small></span><span className="demo-agent-dot" data-state={!a.configured ? 'failed' : a.state} /></button>)}</div></section><p className="demo-runtime-note">Agent 카드를 누르면 현재 프로필 이름과 지시문을 확인하고 이 Room에서 편집할 수 있습니다.</p></>}
      </div></div></section></aside>}
    </div>
    {showIntro && <IntroModal agents={room.agents} connected={connected} pending={pending} onApply={updateAgentProfiles} onClose={closeIntro} />}
  </>;
}
createRoot(document.getElementById('root')).render(<App />);