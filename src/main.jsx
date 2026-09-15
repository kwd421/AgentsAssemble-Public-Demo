import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const AGENTS = [
  { id: "strategist", name: "전략가", short: "S", label: "목표·우선순위·구조" },
  { id: "engineer", name: "엔지니어", short: "E", label: "구현·비용·기술 리스크" },
  { id: "critic", name: "비평가", short: "C", label: "허점·검증·실패 조건" }
];

const SUGGESTIONS = [
  "1인 개발자가 3개월 안에 만들 게임 아이디어를 평가해줘.",
  "AI 모션캡처 SaaS를 창업한다면 MVP와 가장 큰 리스크를 정리해줘.",
  "이 서비스가 실제 사용자에게 왜 필요한지 서로 반박하면서 검토해줘."
];

function agentFor(id) { return AGENTS.find((agent) => agent.id === id); }
function parseSseChunk(buffer, onEvent) {
  const blocks = buffer.split("\n\n");
  const tail = blocks.pop() || "";
  for (const block of blocks) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) continue;
    try { onEvent(event, JSON.parse(data)); }
    catch { onEvent("fatal", { message: "스트림 응답을 해석하지 못했습니다." }); }
  }
  return tail;
}

function App() {
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(SUGGESTIONS[0]);
  const [target, setTarget] = useState("");
  const [thinking, setThinking] = useState([]);
  const [status, setStatus] = useState("");
  const [turns, setTurns] = useState({ used: 0, max: 8 });
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const feedRef = useRef(null);
  const targetName = useMemo(() => agentFor(target)?.name || "AI 팀 전체", [target]);

  function scrollFeed() {
    requestAnimationFrame(() => {
      const node = feedRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }
  async function ensureRoom() {
    if (roomId) return roomId;
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) throw new Error("체험방을 만들지 못했습니다.");
    const room = await response.json();
    setRoomId(room.id);
    setTurns({ used: room.userTurns, max: room.maxUserTurns });
    return room.id;
  }
  async function runTurn(textOverride) {
    const content = (textOverride ?? input).trim();
    if (!content || busy) return;
    setBusy(true); setStatus(""); setStarted(true); setInput("");
    try {
      const id = await ensureRoom();
      const optimistic = { id: `local-${Date.now()}`, kind: "user", content, createdAt: new Date().toISOString() };
      setMessages((current) => [...current, optimistic]);
      scrollFeed();
      const response = await fetch(`/api/rooms/${encodeURIComponent(id)}/turns/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, targetAgentId: target || undefined })
      });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => ({}));
        if (failure.error === "turn_limit_reached") throw new Error("공개 데모의 최대 대화 횟수에 도달했습니다.");
        if (failure.error === "rate_limited") throw new Error("잠시 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.");
        throw new Error("AI 팀을 호출하지 못했습니다.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (event, data) => {
        if (event === "accepted") {
          setTurns({ used: data.userTurns, max: data.maxUserTurns });
          if (data.userMessage?.id) {
            setMessages((current) => current.map((message) => message.id === optimistic.id ? { ...data.userMessage } : message));
          }
        }
        if (event === "agent_start") setThinking((current) => current.includes(data.agentId) ? current : [...current, data.agentId]);
        if (event === "agent") {
          setThinking((current) => current.filter((id) => id !== data.agentId));
          setMessages((current) => [...current, data]);
          scrollFeed();
        }
        if (event === "agent_error") {
          setThinking((current) => current.filter((id) => id !== data.agentId));
          setStatus(`${agentFor(data.agentId)?.name || "에이전트"} 응답 일부를 가져오지 못했습니다.`);
        }
        if (event === "fatal") setStatus(data.message || "응답 연결이 종료되었습니다.");
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, handle);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "데모 실행에 실패했습니다.");
    } finally {
      setBusy(false); setThinking([]);
    }
  }
  function newRoom() {
    if (busy) return;
    setRoomId(""); setMessages([]); setStarted(false); setTurns({ used: 0, max: 8 }); setStatus(""); setTarget(""); setInput(SUGGESTIONS[0]);
  }

  return (
    <main className={started ? "app room-mode" : "app"}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><span>AgentsAssemble</span></div>
        <div className="topbar-actions">
          <span className="public-pill"><i /> Public Demo</span>
          {started && <button className="ghost-button" onClick={newRoom}>새 체험방</button>}
        </div>
      </header>

      {!started ? (
        <section className="landing">
          <div className="hero">
            <div className="eyebrow">WANTED AI CHAMPIONSHIP 2026 · PUBLIC EXPERIENCE</div>
            <h1>혼자 답하는 AI가 아니라,<br /><span>같은 방에서 토론하는 AI 팀.</span></h1>
            <p className="hero-copy">하나의 Room을 공유하는 여러 AI 에이전트가 서로의 답변을 읽고 이어서 판단합니다. 로그인이나 설치 없이 바로 체험해 보세요.</p>
            <div className="composer landing-composer">
              <textarea value={input} maxLength={2500} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runTurn(); }} aria-label="AI 팀에게 맡길 주제" />
              <div className="composer-bottom"><span>⌘/Ctrl + Enter로 시작</span><button className="primary-button" onClick={() => runTurn()}>AI 팀 소집하기</button></div>
            </div>
            <div className="suggestions">{SUGGESTIONS.slice(1).map((suggestion) => <button key={suggestion} onClick={() => setInput(suggestion)}>{suggestion}</button>)}</div>
          </div>
          <aside className="agent-showcase">
            <div className="showcase-head"><span>ROOM MEMBERS</span><strong>3 AI agents</strong></div>
            {AGENTS.map((agent, index) => <div className="agent-card" key={agent.id}><div className={`avatar avatar-${agent.id}`}>{agent.short}</div><div><strong>{agent.name}</strong><p>{agent.label}</p></div><span className="online">ready</span>{index < AGENTS.length - 1 && <div className="connector-line" />}</div>)}
            <div className="showcase-note"><strong>Shared context</strong><p>앞선 에이전트의 답변이 다음 에이전트의 문맥에 즉시 포함됩니다.</p></div>
          </aside>
        </section>
      ) : (
        <section className="room-layout">
          <aside className="room-sidebar">
            <div><div className="sidebar-kicker">DEMO ROOM</div><h2>AI Council</h2><p>임시 세션 · 저장 안 됨</p></div>
            <div className="members"><span>참여 Agent</span>{AGENTS.map((agent) => <button key={agent.id} className={target === agent.id ? "member active" : "member"} onClick={() => setTarget(target === agent.id ? "" : agent.id)}><div className={`avatar avatar-${agent.id}`}>{agent.short}</div><div><strong>{agent.name}</strong><small>{agent.label}</small></div><i /></button>)}</div>
            <div className="sidebar-limit"><span>공개 데모 사용량</span><div className="limit-row"><strong>{turns.used}</strong><span>/ {turns.max} turns</span></div><div className="progress"><i style={{ width: `${Math.min(100, (turns.used / turns.max) * 100)}%` }} /></div></div>
          </aside>
          <section className="conversation">
            <header className="conversation-head"><div><span className="room-dot" /><div><strong># council</strong><p>모든 에이전트가 같은 Room 기록을 공유합니다.</p></div></div><span className="target-chip">응답 대상 · {targetName}</span></header>
            <div className="feed" ref={feedRef}>
              <div className="room-intro"><div className="intro-icon">A</div><h3>AgentsAssemble 공개 체험방</h3><p>질문 하나를 세 가지 관점으로 검토합니다. 특정 Agent만 선택해서 후속 질문할 수도 있습니다.</p></div>
              {messages.map((message) => <article className={`message ${message.kind}`} key={message.id}>{message.kind === "agent" ? <div className={`avatar avatar-${message.agentId}`}>{agentFor(message.agentId)?.short || "A"}</div> : <div className="avatar user-avatar">You</div>}<div className="message-body"><div className="message-meta"><strong>{message.kind === "agent" ? message.agentName : "나"}</strong>{message.kind === "agent" && <span>{message.agentLabel}</span>}</div><p>{message.content}</p></div></article>)}
              {thinking.map((id) => { const agent = agentFor(id); return <article className="message thinking" key={`thinking-${id}`}><div className={`avatar avatar-${id}`}>{agent?.short}</div><div className="message-body"><div className="message-meta"><strong>{agent?.name}</strong></div><div className="typing"><i /><i /><i /></div></div></article>; })}
            </div>
            <div className="room-composer-wrap">
              {status && <div className="status-banner">{status}</div>}
              <div className="composer room-composer"><textarea value={input} placeholder={`${targetName}에게 메시지 보내기…`} maxLength={2500} disabled={busy || turns.used >= turns.max} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runTurn(); }} /><div className="composer-bottom"><span>{target ? `${targetName}만 답변` : "AI 팀 전체가 순서대로 답변"}</span><button className="primary-button" disabled={busy || !input.trim() || turns.used >= turns.max} onClick={() => runTurn()}>{busy ? "응답 중…" : "보내기"}</button></div></div>
              <p className="privacy-note">공개 데모는 메모리에서만 동작하며 일정 시간이 지나면 사라집니다. 민감한 정보를 입력하지 마세요.</p>
            </div>
          </section>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
