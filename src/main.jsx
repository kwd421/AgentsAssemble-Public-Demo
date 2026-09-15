import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const AGENTS = [
  { id: "strategist", name: "전략가", short: "S", label: "Strategy", detail: "목표 · 우선순위 · 구조" },
  { id: "engineer", name: "엔지니어", short: "E", label: "Engineering", detail: "구현 · 비용 · 기술 리스크" },
  { id: "critic", name: "비평가", short: "C", label: "Critical review", detail: "허점 · 실패 조건 · 검증" }
];

const SUGGESTIONS = [
  { title: "게임 기획 검토", text: "1인 개발자가 3개월 안에 만들 게임 아이디어를 평가해줘." },
  { title: "창업 아이디어 검증", text: "AI 모션캡처 SaaS를 창업한다면 MVP와 가장 큰 리스크를 정리해줘." },
  { title: "서비스 필요성 토론", text: "이 서비스가 실제 사용자에게 왜 필요한지 서로 반박하면서 검토해줘." }
];

function agentFor(id) {
  return AGENTS.find((agent) => agent.id === id);
}

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
    try {
      onEvent(event, JSON.parse(data));
    } catch {
      onEvent("fatal", { message: "스트림 응답을 해석하지 못했습니다." });
    }
  }
  return tail;
}

function AgentAvatar({ id, size = "md" }) {
  const agent = agentFor(id);
  return <div className={`agent-avatar avatar-${id} avatar-${size}`}>{agent?.short || "A"}</div>;
}

function App() {
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState("");
  const [thinking, setThinking] = useState([]);
  const [status, setStatus] = useState("");
  const [turns, setTurns] = useState({ used: 0, max: 8 });
  const [busy, setBusy] = useState(false);
  const feedRef = useRef(null);

  const targetName = useMemo(() => agentFor(target)?.name || "모든 Agent", [target]);
  const sessionProgress = Math.min(100, (turns.used / turns.max) * 100);

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
    if (!content || busy || turns.used >= turns.max) return;

    setBusy(true);
    setStatus("");
    setInput("");

    try {
      const id = await ensureRoom();
      const optimistic = {
        id: `local-${Date.now()}`,
        kind: "user",
        content,
        createdAt: new Date().toISOString()
      };
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
        if (failure.error === "rate_limited") throw new Error("요청이 잠시 많습니다. 잠시 뒤 다시 시도해 주세요.");
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
        if (event === "agent_start") {
          setThinking((current) => current.includes(data.agentId) ? current : [...current, data.agentId]);
        }
        if (event === "agent") {
          setThinking((current) => current.filter((id) => id !== data.agentId));
          setMessages((current) => [...current, data]);
          scrollFeed();
        }
        if (event === "agent_error") {
          setThinking((current) => current.filter((id) => id !== data.agentId));
          setStatus(`${agentFor(data.agentId)?.name || "에이전트"} 응답을 가져오지 못했습니다.`);
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
      setBusy(false);
      setThinking([]);
    }
  }

  function newRoom() {
    if (busy) return;
    setRoomId("");
    setMessages([]);
    setTurns({ used: 0, max: 8 });
    setStatus("");
    setTarget("");
    setInput("");
  }

  return (
    <div className="workspace">
      <header className="appbar">
        <div className="appbar-left">
          <div className="logo">A</div>
          <div className="brand-block">
            <strong>AgentsAssemble</strong>
            <span>Public demo</span>
          </div>
          <div className="breadcrumb"><span>/</span><strong># council</strong></div>
        </div>
        <div className="appbar-right">
          <span className="live-pill"><i /> LIVE DEMO</span>
          <span className="turn-badge">{turns.used}/{turns.max} turns</span>
          <button className="new-room-button" onClick={newRoom} disabled={busy}>새 체험방</button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="left-rail">
          <div className="rail-section">
            <div className="rail-label">ROOM</div>
            <button className="channel active"><span>#</span><strong>council</strong><i /></button>
          </div>

          <div className="rail-section rail-agents">
            <div className="rail-label-row"><span>AGENTS</span><small>3 online</small></div>
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                className={`agent-row ${target === agent.id ? "selected" : ""}`}
                onClick={() => setTarget(target === agent.id ? "" : agent.id)}
                title={`${agent.name}에게만 후속 질문`}
              >
                <AgentAvatar id={agent.id} size="sm" />
                <span className="agent-copy"><strong>{agent.name}</strong><small>{agent.label}</small></span>
                <i className="presence-dot" />
              </button>
            ))}
          </div>

          <div className="rail-footer">
            <div className="ephemeral-card">
              <div className="ephemeral-icon">◎</div>
              <div><strong>Ephemeral room</strong><p>기록은 서버 메모리에만 유지됩니다.</p></div>
            </div>
          </div>
        </aside>

        <main className="chat-column">
          <header className="chat-header">
            <div>
              <div className="channel-title"><span>#</span><strong>council</strong><span className="channel-status">3 agents online</span></div>
              <p>하나의 대화 문맥을 세 Agent가 순서대로 공유합니다.</p>
            </div>
            <div className="shared-context-pill"><span className="stack-icon">≡</span> Shared context</div>
          </header>

          <div className="feed" ref={feedRef}>
            {messages.length === 0 ? (
              <section className="empty-state">
                <div className="empty-kicker"><i /> READY</div>
                <h1>한 번 묻고,<br />세 관점으로 검토하세요.</h1>
                <p>전략가가 구조를 잡고, 엔지니어가 구현 가능성을 검토하고, 비평가가 앞선 의견의 허점을 찾습니다.</p>
                <div className="flow-row">
                  {AGENTS.map((agent, index) => (
                    <React.Fragment key={agent.id}>
                      <div className="flow-agent"><AgentAvatar id={agent.id} /><div><strong>{agent.name}</strong><span>{agent.detail}</span></div></div>
                      {index < AGENTS.length - 1 && <div className="flow-arrow">→</div>}
                    </React.Fragment>
                  ))}
                </div>
                <div className="prompt-grid">
                  {SUGGESTIONS.map((item) => (
                    <button key={item.title} onClick={() => runTurn(item.text)} disabled={busy}>
                      <span>{item.title}</span>
                      <p>{item.text}</p>
                      <i>↗</i>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="message-list">
                <div className="conversation-start"><span>오늘</span></div>
                {messages.map((message) => (
                  <article className={`message-row ${message.kind}`} key={message.id}>
                    {message.kind === "agent" ? <AgentAvatar id={message.agentId} /> : <div className="user-avatar">YOU</div>}
                    <div className="message-content">
                      <div className="message-head">
                        <strong>{message.kind === "agent" ? message.agentName : "나"}</strong>
                        {message.kind === "agent" && <span className="role-chip">{message.agentLabel}</span>}
                      </div>
                      <p>{message.content}</p>
                    </div>
                  </article>
                ))}
                {thinking.map((id) => (
                  <article className="message-row thinking-row" key={`thinking-${id}`}>
                    <AgentAvatar id={id} />
                    <div className="message-content">
                      <div className="message-head"><strong>{agentFor(id)?.name}</strong><span className="role-chip">thinking</span></div>
                      <div className="typing"><i /><i /><i /></div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="composer-zone">
            {status && <div className="status-banner"><span>!</span>{status}</div>}
            <div className="target-row">
              <span>Reply with</span>
              <button className={!target ? "target-button active" : "target-button"} onClick={() => setTarget("")}>모든 Agent</button>
              {AGENTS.map((agent) => <button key={agent.id} className={target === agent.id ? `target-button active target-${agent.id}` : `target-button target-${agent.id}`} onClick={() => setTarget(agent.id)}>{agent.name}</button>)}
            </div>
            <div className="composer-card">
              <textarea
                value={input}
                maxLength={2500}
                placeholder={`${targetName}에게 메시지를 보내세요…`}
                disabled={busy || turns.used >= turns.max}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") runTurn();
                }}
              />
              <div className="composer-footer">
                <div className="composer-meta"><span>공유 문맥</span><i /> <span>{target ? `${targetName} 단독 응답` : "3 agents sequential"}</span></div>
                <button className="send-button" onClick={() => runTurn()} disabled={busy || !input.trim() || turns.used >= turns.max}>
                  {busy ? <span className="send-loading"><i /><i /><i /></span> : <>보내기 <kbd>⌘↵</kbd></>}
                </button>
              </div>
            </div>
            <p className="privacy-line">공개 데모 · 세션은 일정 시간이 지나면 사라집니다 · 민감한 정보를 입력하지 마세요.</p>
          </div>
        </main>

        <aside className="inspector">
          <section className="inspector-section">
            <div className="inspector-label">HOW IT WORKS</div>
            <h3>하나의 Room,<br />하나의 공유 문맥.</h3>
            <p className="inspector-copy">세 Agent가 독립 역할을 유지하면서 같은 대화 기록을 읽습니다.</p>
            <div className="context-chain">
              {AGENTS.map((agent, index) => (
                <div className="context-step" key={agent.id}>
                  <span className="step-number">0{index + 1}</span>
                  <AgentAvatar id={agent.id} size="xs" />
                  <div><strong>{agent.name}</strong><p>{agent.detail}</p></div>
                </div>
              ))}
            </div>
          </section>

          <section className="inspector-section session-card">
            <div className="inspector-label-row"><span>SESSION</span><strong>{turns.used}/{turns.max}</strong></div>
            <div className="session-progress"><i style={{ width: `${sessionProgress}%` }} /></div>
            <div className="session-stats"><span><i className="green-dot" />3 agents</span><span>45 min expiry</span></div>
          </section>

          <section className="inspector-section compact-section">
            <div className="inspector-label">PUBLIC DEMO</div>
            <ul>
              <li><span>✓</span> 로그인 없음</li>
              <li><span>✓</span> 서버측 API key</li>
              <li><span>✓</span> shared transcript</li>
              <li><span>✓</span> Agent 개별 후속 질문</li>
            </ul>
          </section>

          <div className="competition-note">
            <span>WANTED AI Championship 2026</span>
            <p>실제품의 로컬 CLI·MCP·OAuth 기능은 공개 심사 환경에서 의도적으로 제외했습니다.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
