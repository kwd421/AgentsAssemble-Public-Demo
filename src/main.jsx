import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import { BookOpen, ChevronDown, Hash, Home, Pencil, RefreshCw, Search, Send, Square, Users, X } from 'lucide-react';
import { useRoom } from './useRoom.js';
import { AgentAvatar, AgentProfileEditor, IntroModal, RoomGuide } from './interface.jsx';
import './index.css';
import './demo.css';
import './onboarding.css';
import './composer-fix.css';

const LABELS = { idle: '대기', queued: '차례 대기', running: '응답 생성 중', retrying: '재시도 중', failed: '응답 실패', done: '응답 완료', cancelled: '중지됨' };
const INTRO_KEY = 'aa-demo-intro-v3';

function MessageRow({ message, agents }) {
  const isAgent = message.kind === 'agent';
  const agent = agents.find(a => a.id === message.agentId);
  const when = new Date(message.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return <article className="dc-message aa-message grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-1.5" data-agent={agent?.id} tabIndex={0}>
    <AgentAvatar agent={agent} human={!isAgent} />
    <div className="min-w-0">
      <div className="aa-message-heading"><span className="dc-message-author">{isAgent ? message.agentName : '나'}</span>{isAgent && <span className="aa-ai-label" title={message.agentLabel}>AI</span>}<time>{when}</time>{isAgent && <span className="demo-message-meta" title={message.model}>{message.model} · {(Math.max(0, message.durationMs || 0) / 1000).toFixed(1)}초{message.retryOf ? ' · 재시도' : ''}</span>}</div>
      {isAgent ? <div className="demo-markdown aa-message-body"><Markdown skipHtml disallowedElements={['img']} components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" /> }}>{message.content}</Markdown></div> : <div className="aa-message-body whitespace-pre-wrap preserve-words">{message.content}</div>}
      {message.truncated && <p className="demo-warning">출력 한도에 도달했습니다. 후속 질문으로 이어서 요청할 수 있습니다.</p>}
    </div>
  </article>;
}
function Thinking({ agent }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - (agent.startedAt || Date.now())) / 1000))); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, [agent.startedAt]);
  return <div className="dc-message aa-message grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-2" data-agent={agent.id}><AgentAvatar agent={agent} /><div><strong className="aa-thinking-name">{agent.name}</strong><div className="aa-thinking-status" role="status"><span className="dc-typing-dots"><span /><span /><span /></span>{LABELS[agent.state]} · {elapsed}초</div>{agent.retryMessage && <p className="text-[12px] text-text-muted">{agent.retryMessage}</p>}</div></div>;
}
function RetryButton({ failure, disabled, retry }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!failure.retryAt || failure.retryAt <= Date.now()) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [failure.retryAt]);
  const seconds = Math.max(0, Math.ceil(((failure.retryAt || 0) - now) / 1000));
  return <button className="demo-target-chip" disabled={disabled || seconds > 0} onClick={() => retry(failure.id)}>{seconds ? `${seconds}초 뒤 재시도 가능` : '이 에이전트만 다시 시도'}</button>;
}
function App() {
  const { room, draft, setDraft, connection, error, setError, pending, submit, retry, updateAgentProfile, updateAgentProfiles, cancel, reset } = useRoom();
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState(() => window.innerWidth >= 1100);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [showIntro, setShowIntro] = useState(() => { try { return sessionStorage.getItem(INTRO_KEY) !== 'seen'; } catch { return true; } });
  const feedRef = useRef(null), composerRef = useRef(null), bottom = useRef(true);
  const busy = room.busy || pending;
  const connected = connection === 'connected';
  const selectedAgent = room.agents.find(a => a.id === selectedAgentId) || null;
  useEffect(() => { if (bottom.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [room.messages.length, room.failures.length, room.busy]);
  useEffect(() => { if (selectedAgentId && !room.agents.some(a => a.id === selectedAgentId)) setSelectedAgentId(null); }, [room.agents, selectedAgentId]);
  useEffect(() => { if (!members) return; const onKey = e => { if (e.key === 'Escape' && !showIntro && window.innerWidth < 1100) setMembers(false); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [members, showIntro]);
  const messages = room.messages.filter(m => !query || m.content.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function onKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }
  function appendMention(agent) { setDraft(v => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@${agent.mention || agent.id} `); if (window.innerWidth < 1100) setMembers(false); requestAnimationFrame(() => composerRef.current?.focus()); }
  function closeIntro() { try { sessionStorage.setItem(INTRO_KEY, 'seen'); } catch { /* Storage may be disabled. */ } setShowIntro(false); requestAnimationFrame(() => composerRef.current?.focus()); }
  function newRoom() { if (busy) return; setSelectedAgentId(null); reset(); }
  return <>
    <div className="dc-shell aa-ui flex h-screen max-h-screen overflow-hidden text-text-primary">
      <nav className="dc-rail flex shrink-0 flex-col items-center gap-2 py-3" aria-label="방 목록">
        <button className="dc-rail-home" data-active="true" onClick={newRoom} disabled={busy} title="새 체험방" aria-label="새 체험방"><Home size={22} /></button>
        <div className="dc-server-divider" /><div className="dc-room-stack"><button className="dc-server-btn" data-active="true" aria-label="현재 체험방"><span className="text-[12px] font-black">AA</span></button></div>
      </nav>
      <aside className="dc-sidebar flex shrink-0 flex-col" aria-label="채널 목록">
        <header className="dc-sidebar-head shrink-0" data-tone="violet"><button className="dc-server-header-button" onClick={newRoom} disabled={busy} title="새 체험방"><span className="truncate">AgentsAssemble</span><ChevronDown size={16} /></button><div className="aa-server-banner"><span className="aa-server-monogram">AA<span className="aa-monogram-dot" /></span><div><strong>Public Demo</strong><p>Wanted AI Championship 2026</p></div></div></header>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 chat-scroll" aria-label="채널"><section className="dc-channel-section"><div className="dc-channel-category"><ChevronDown size={12} />텍스트 채널</div><button data-active="true" className="dc-channel"><Hash size={18} /><span>general</span></button></section><RoomGuide onOpen={() => setShowIntro(true)} /></nav>
        <footer className="dc-user-area shrink-0"><div className="aa-user-row"><AgentAvatar human /><div><strong>방문자</strong><p>{room.userTurns} / {room.maxUserTurns}회 · 임시 대화방</p></div><button className="dc-head-icon" onClick={newRoom} disabled={busy} title="새 체험방" aria-label="새 체험방"><RefreshCw size={17} /></button></div></footer>
      </aside>
      <main className="dc-chat flex min-w-0 flex-1 flex-col" aria-label="채널 내용">
        <header className="dc-chat-head flex h-12 shrink-0 items-center gap-2 px-3 lg:px-4" data-members-available="true" data-members-open={members}>
          <Hash size={20} className="shrink-0 text-text-muted" /><h1 className="text-[16px] font-semibold">general</h1><span className="demo-connection" data-state={connection}>{connected ? '연결됨' : connection === 'connecting' ? '연결 중' : '재연결 중'}</span>
          <div className="dc-head-actions ml-auto flex shrink-0 items-center gap-1.5"><button className="dc-head-icon aa-help-button" onClick={() => setShowIntro(true)} aria-label="사용 안내 및 설정" title="사용 안내 및 설정"><BookOpen size={19} /></button><button className="dc-head-icon" onClick={() => setMembers(v => !v)} aria-label="멤버 목록" aria-pressed={members}><Users size={19} /></button><label className="dc-head-search hidden md:flex"><span className="sr-only">general 검색</span><input type="search" placeholder="검색" value={query} onChange={e => setQuery(e.target.value)} /><Search size={14} /></label></div>
        </header>
        {error && <div className="demo-alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="안내 닫기">×</button></div>}
        {room.runtime?.mode === 'fixture' && <div className="demo-alert" role="status">UI 테스트 모드입니다. 실제 AI 응답이 아닙니다.</div>}
        <div ref={feedRef} className="relative min-h-0 flex-1 overflow-y-auto py-4 chat-scroll" style={{ overflowAnchor: 'none' }} onScroll={e => { const n = e.currentTarget; bottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 100; }}>
          <section className="dc-channel-intro aa-channel-intro"><span className="dc-channel-intro-icon"><Hash size={29} /></span><h2>대화 시작</h2><p>질문을 보내면 세 에이전트가 차례로 답합니다.</p><div className="aa-room-cast">{room.agents.map(a => <button type="button" key={a.id} data-agent={a.id} onClick={() => { setSelectedAgentId(a.id); setMembers(true); }} title={`${a.name} 프로필 편집`}><AgentAvatar agent={a} /><span>{a.name}</span><Pencil size={12} /></button>)}</div><p className="aa-channel-note">웹 검색은 지원하지 않습니다. 답변의 사실 여부는 별도로 확인이 필요합니다.</p></section>
          {query && !messages.length && <p className="px-4 text-[14px] text-text-muted">검색 결과가 없습니다.</p>}
          {messages.map(m => <MessageRow key={m.id} message={m} agents={room.agents} />)}
          {room.agents.filter(a => ['running', 'retrying'].includes(a.state)).map(a => <Thinking key={a.id} agent={a} />)}
          {room.failures.map(f => <div className="demo-failure" role="status" key={f.id}><strong>{room.agents.find(a => a.id === f.agentId)?.name} 응답 실패</strong><p>{f.message}</p><small>{f.code}{f.traceId ? ` · 진단 ID ${f.traceId.slice(0, 8)}` : ''}</small>{f.canRetry && <RetryButton failure={f} disabled={busy || !connected} retry={retry} />}{f.manualRetries > 0 && <p>수동 재시도 1회를 사용했습니다.</p>}</div>)}
        </div>
        <div className="aa-composer-wrap shrink-0 px-4 pb-5"><div className="demo-composer-info"><span>{room.agents.some(a => a.state === 'queued') ? `${room.agents.filter(a => a.state === 'queued').map(a => a.name).join(' → ')} 차례 대기` : 'Enter 전송 · Shift+Enter 줄바꿈'}</span><span>{draft.length} / 2500</span></div>
          <section className="dc-composer-shell"><div className="dc-composer-bar"><textarea ref={composerRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} className="dc-composer-input" placeholder={room.userTurns >= room.maxUserTurns ? '대화 횟수 제한에 도달했습니다.' : '#general에 메시지 보내기'} aria-label="채팅 입력" maxLength={2500} rows={1} disabled={room.userTurns >= room.maxUserTurns} />{busy ? <button className="dc-composer-button" onClick={cancel} disabled={!connected || pending} title="응답 중지" aria-label="응답 중지"><Square size={18} /></button> : <button className="dc-composer-button send" disabled={!connected || !draft.trim() || room.userTurns >= room.maxUserTurns} onClick={submit} aria-label="채팅 메시지 보내기"><Send size={18} /></button>}</div></section>
          {room.userTurns >= room.maxUserTurns && <button className="demo-target-chip mt-2" disabled={busy} onClick={newRoom}>새 체험방 시작</button>}
        </div>
      </main>
      {members && <><button className="aa-members-backdrop" aria-label="멤버 패널 닫기" onClick={() => setMembers(false)} /><aside className="dc-members demo-right-panel aa-members-panel" aria-label="방 연결 정보"><header className="aa-members-header"><span>{selectedAgent ? '프로필' : '멤버'}</span><button type="button" className="dc-head-icon" onClick={() => setMembers(false)} aria-label="멤버 패널 닫기"><X size={18} /></button></header><div className="aa-members-scroll chat-scroll">
        {selectedAgent ? <AgentProfileEditor agent={selectedAgent} disabled={!connected || busy} pending={pending} onBack={() => setSelectedAgentId(null)} onMention={() => appendMention(selectedAgent)} onSave={updateAgentProfile} /> : <><p className="aa-member-section-title">참여자 — {room.agents.length + 1}</p><div className="aa-human-member"><AgentAvatar human /><div><strong>방문자</strong><p>{connected ? '이 방에 참여 중' : '연결 확인 중'}</p></div></div><p className="aa-member-section-title aa-agent-list-title">에이전트 — {room.agents.length}</p><div className="dc-owner-agent-list">{room.agents.map(a => <button key={a.id} className="demo-member-button aa-member" data-agent={a.id} onClick={() => setSelectedAgentId(a.id)} title={`${a.name} 프로필 보기/편집`}><AgentAvatar agent={a} /><span className="aa-member-copy"><strong>{a.name}</strong><small title={a.model}>{a.model || '모델 미설정'}</small><small className="aa-member-state"><span className="demo-agent-dot" data-state={!a.configured ? 'failed' : a.state} />{a.configured ? LABELS[a.state] : '설정 필요'}</small></span><Pencil size={14} className="aa-member-edit" /></button>)}</div><div className="aa-member-tip"><Pencil size={15} /><p>멤버를 누르면 이름과 지시문을 수정할 수 있습니다.</p></div><p className="aa-room-retention">대화와 설정은 비활성 45분 후 또는 서버 재시작 시 삭제됩니다.</p></>}
      </div></aside></>}
    </div>
    {showIntro && <IntroModal agents={room.agents} connected={connected} pending={pending} onApply={updateAgentProfiles} onClose={closeIntro} />}
  </>;
}
createRoot(document.getElementById('root')).render(<App />);
