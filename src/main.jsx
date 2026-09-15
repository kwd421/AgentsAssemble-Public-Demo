import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AtSign,
  Bell,
  Bot,
  ChevronDown,
  Hash,
  Home,
  Paperclip,
  Pin,
  Search,
  Send,
  Settings,
  Smile,
  Sparkles,
  Users,
} from "lucide-react";
import "./index.css";

const AGENTS = [
  { id: "strategist", name: "전략가", provider: "Strategy", role: "목표 · 우선순위 · 구조", initial: "S" },
  { id: "engineer", name: "엔지니어", provider: "Engineering", role: "구현 · 비용 · 기술 리스크", initial: "E" },
  { id: "critic", name: "비평가", provider: "Critical Review", role: "허점 · 검증 · 실패 조건", initial: "C" },
];

function agentFor(id) {
  return AGENTS.find((agent) => agent.id === id);
}

function targetAgentFromMessage(message) {
  const text = String(message || "").toLocaleLowerCase();
  const aliases = [
    ["strategist", ["@전략가", "@strategist"]],
    ["engineer", ["@엔지니어", "@engineer"]],
    ["critic", ["@비평가", "@critic"]],
  ];
  for (const [id, tokens] of aliases) {
    if (tokens.some((token) => text.includes(token.toLocaleLowerCase()))) return id;
  }
  return "";
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

function Avatar({ label, agentId, human = false }) {
  return (
    <span
      className={`dc-message-avatar mt-0.5 ${human ? "" : "agent"}`}
      style={
        human
          ? {
              background: "#5865f2",
              color: "white",
              display: "grid",
              placeItems: "center",
              fontWeight: 900,
            }
          : undefined
      }
      aria-hidden="true"
    >
      {human ? (
        label
      ) : (
        <span className="grid h-full w-full place-items-center text-[12px] font-black">
          {agentFor(agentId)?.initial || <Bot size={16} />}
        </span>
      )}
    </span>
  );
}

function MessageRow({ message }) {
  const isAgent = message.kind === "agent";
  const agent = isAgent ? agentFor(message.agentId) : null;
  const when = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div
      className="dc-message grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-1.5"
      tabIndex={0}
    >
      <Avatar label="나" agentId={message.agentId} human={!isAgent} />
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="dc-message-author truncate text-[15px] font-semibold text-text-primary preserve-words">
            {isAgent ? message.agentName || agent?.name : "나"}
          </span>
          {isAgent && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-accent">
              {message.agentLabel || agent?.provider}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-text-muted">{when}</span>
        </p>
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-secondary preserve-words">
          {message.content}
        </div>
      </div>
    </div>
  );
}

function TypingRow({ agentId }) {
  const agent = agentFor(agentId);
  return (
    <div className="dc-message grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-1.5">
      <Avatar agentId={agentId} />
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="dc-message-author truncate text-[15px] font-semibold text-text-primary">
            {agent?.name}
          </span>
        </p>
        <div className="flex items-center gap-2 text-[13px] text-text-muted" aria-live="polite">
          <span className="dc-typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>입력중...</span>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [turns, setTurns] = useState({ used: 0, max: 8 });
  const feedRef = useRef(null);

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
    const content = String(textOverride ?? input).trim();
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
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);
      scrollFeed();

      const targetAgentId = targetAgentFromMessage(content);
      const response = await fetch(`/api/rooms/${encodeURIComponent(id)}/turns/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          targetAgentId: targetAgentId || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => ({}));
        if (failure.error === "turn_limit_reached") {
          throw new Error("공개 데모의 최대 대화 횟수에 도달했습니다.");
        }
        if (failure.error === "rate_limited") {
          throw new Error("잠시 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.");
        }
        throw new Error("AI 팀을 호출하지 못했습니다.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handle = (event, data) => {
        if (event === "accepted") {
          setTurns({ used: data.userTurns, max: data.maxUserTurns });
          if (data.userMessage?.id) {
            setMessages((current) =>
              current.map((message) =>
                message.id === optimistic.id ? data.userMessage : message
              )
            );
          }
        }
        if (event === "agent_start") {
          setThinking((current) =>
            current.includes(data.agentId) ? current : [...current, data.agentId]
          );
        }
        if (event === "agent") {
          setThinking((current) =>
            current.filter((idValue) => idValue !== data.agentId)
          );
          setMessages((current) => [...current, data]);
          scrollFeed();
        }
        if (event === "agent_error") {
          setThinking((current) =>
            current.filter((idValue) => idValue !== data.agentId)
          );
          setStatus(`${agentFor(data.agentId)?.name || "에이전트"} 응답을 가져오지 못했습니다.`);
        }
        if (event === "fatal") {
          setStatus(data.message || "응답 연결이 종료되었습니다.");
        }
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

  function resetRoom() {
    if (busy) return;
    setRoomId("");
    setMessages([]);
    setInput("");
    setThinking([]);
    setStatus("");
    setTurns({ used: 0, max: 8 });
  }

  function handleComposerKeyDown(event) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.shiftKey) return;
    event.preventDefault();
    void runTurn();
  }

  return (
    <div className="dc-shell flex h-screen max-h-screen overflow-hidden text-text-primary">
      <nav className="dc-rail flex shrink-0 flex-col items-center gap-2 py-3" aria-label="방 목록">
        <button type="button" className="dc-rail-home" data-active="true" aria-label="AgentsAssemble 홈">
          <Home size={22} />
        </button>
        <div className="dc-server-divider" />
        <div className="dc-room-stack">
          <button type="button" className="dc-server-btn" data-active="true" aria-label="Wanted Demo Room">
            <span className="text-[12px] font-black">AA</span>
          </button>
        </div>
      </nav>

      <aside className="dc-sidebar flex shrink-0 flex-col" aria-label="채널 목록">
        <header className="dc-sidebar-head shrink-0" data-tone="violet">
          <button
            type="button"
            className="dc-server-header-button"
            onClick={resetRoom}
            title="새 임시 체험방 시작"
          >
            <span className="truncate preserve-words">AgentsAssemble Demo</span>
            <ChevronDown size={16} />
          </button>
          <div className="dc-sidebar-banner">
            <span className="dc-sidebar-server-icon">AA</span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-wide text-white/70">Room</p>
              <p className="truncate text-[12px] font-semibold text-text-muted preserve-words">
                Wanted AI Championship 2026 공개 체험방
              </p>
            </div>
          </div>
        </header>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 chat-scroll" aria-label="채널">
          <section className="dc-channel-section">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="dc-channel-category dc-channel-category-button"
                aria-expanded="true"
              >
                <ChevronDown size={12} /> Text Channels
              </button>
            </div>
            <button type="button" data-active="true" className="dc-channel">
              <Hash size={18} className="shrink-0 opacity-70" />
              <span className="truncate">general</span>
            </button>
          </section>
        </nav>

        <footer className="dc-user-area shrink-0" style={{ zIndex: 30 }}>
          <div className="flex items-center gap-2 px-2 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-black text-white">
              YOU
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-bold text-text-primary">Public Visitor</p>
              <p className="truncate text-[10px] text-text-muted">
                {turns.used}/{turns.max} turns · memory-only
              </p>
            </div>
            <button
              type="button"
              className="dc-head-icon"
              aria-label="데모 설정 안내"
              title="공개 데모에서는 설정이 제한됩니다."
            >
              <Settings size={16} />
            </button>
          </div>
        </footer>
      </aside>

      <main className="dc-chat flex min-w-0 flex-1 flex-col" aria-label="채널 내용">
        <header
          className="dc-chat-head flex h-12 shrink-0 items-center gap-2 px-3 lg:px-4"
          data-members-available="true"
          data-members-open="true"
        >
          <span className="dc-desktop-head-channel-icon shrink-0 text-text-muted">
            <Hash size={20} />
          </span>
          <h1 className="dc-desktop-head-title shrink-0 text-[15px] font-bold text-text-primary preserve-words">
            general
          </h1>
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
          <p className="hidden min-w-0 truncate text-[13px] text-text-muted preserve-words sm:block">
            사람과 에이전트가 함께 보는 기본 채널
          </p>
          <div className="dc-head-actions ml-auto flex shrink-0 items-center gap-1.5">
            <button type="button" className="dc-head-icon" aria-label="알림">
              <Bell size={17} />
            </button>
            <button type="button" className="dc-head-icon" aria-label="고정 메시지">
              <Pin size={17} />
            </button>
            <button type="button" className="dc-head-icon text-text-primary" aria-label="멤버 목록">
              <Users size={18} />
            </button>
            <label className="dc-head-search hidden md:flex">
              <span className="sr-only">general 검색</span>
              <input type="search" placeholder="general 검색" readOnly />
              <Search size={14} aria-hidden />
            </label>
          </div>
        </header>

        {status && (
          <div
            className="mx-4 mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] font-semibold text-danger preserve-words"
            role="alert"
          >
            {status}
          </div>
        )}

        <div
          ref={feedRef}
          className="relative min-h-0 flex-1 overflow-y-auto py-4 chat-scroll"
          style={{ overflowAnchor: "none" }}
        >
          <section className="dc-channel-intro px-4 pb-5 pt-2">
            <span className="dc-channel-intro-icon">
              <Hash size={26} />
            </span>
            <h2 className="mt-3 text-[28px] font-black leading-tight text-text-primary preserve-words">
              AgentsAssemble Demo
            </h2>
            <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-text-muted preserve-words">
              하나의 Room 기록을 사람과 여러 AI가 함께 읽습니다. 특정 AI만 부르려면 @전략가, @엔지니어, @비평가처럼 멘션하세요.
            </p>
          </section>

          {messages.length === 0 && (
            <p className="px-4 text-[13px] text-text-muted preserve-words">
              아직 채팅 메시지가 없습니다. 첫 메시지를 남겨 보세요.
            </p>
          )}

          {messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
          {thinking.map((agentId) => (
            <TypingRow key={`typing-${agentId}`} agentId={agentId} />
          ))}
        </div>

        <div className="shrink-0 px-4 pb-5">
          <section className="dc-composer-shell">
            <div className="dc-composer-bar">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                className="dc-composer-input"
                placeholder={
                  turns.used >= turns.max
                    ? "공개 데모의 최대 대화 횟수에 도달했습니다."
                    : "메시지 입력"
                }
                disabled={busy || turns.used >= turns.max}
                aria-label="채팅 입력"
                rows={1}
              />
              <button
                type="button"
                className="dc-composer-button"
                data-role="attachment"
                aria-label="첨부 추가"
                title="공개 데모에서는 첨부를 제한합니다."
              >
                <Paperclip size={17} />
              </button>
              <button
                type="button"
                className="dc-composer-button"
                data-accessory="apps"
                aria-label="앱"
              >
                <Sparkles size={17} />
              </button>
              <button
                type="button"
                className="dc-composer-button"
                data-role="mention"
                aria-label="멘션"
                onClick={() => setInput((value) => `${value}@`)}
              >
                <AtSign size={17} />
              </button>
              <button
                type="button"
                className="dc-composer-button"
                data-role="emoji"
                aria-label="이모지"
                onClick={() => setInput((value) => `${value}🙂`)}
              >
                <Smile size={17} />
              </button>
              <button
                type="button"
                className="dc-composer-button send"
                data-role="send"
                aria-label="채팅 메시지 보내기"
                disabled={busy || !input.trim() || turns.used >= turns.max}
                onClick={() => void runTurn()}
              >
                <Send size={17} />
              </button>
            </div>
          </section>
        </div>
      </main>

      <aside
        className="dc-members demo-right-panel hidden shrink-0 xl:flex xl:flex-col"
        aria-label="방 연결 정보"
        data-testid="room-right-panel"
      >
        <div className="dc-right-panel-header-spacer" />
        <div className="dc-right-panel-tabs" role="tablist" aria-label="우측 패널">
          <button type="button" role="tab" data-active="true" aria-selected="true">
            멤버
          </button>
        </div>
        <section className="min-h-0 flex-1">
          <div className="dc-room-connection-panel flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 chat-scroll">
              <p className="mb-2 px-2 text-[11px] font-black uppercase tracking-wide text-text-muted">
                온라인 — 4
              </p>

              <section className="dc-person-member-group">
                <div className="flex w-full items-center gap-2 rounded px-2 py-2 text-left">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[10px] font-black text-white">
                    YOU
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-[12px] text-text-primary">Public Visitor</strong>
                    <small className="block truncate text-[10px] text-text-muted">human · online</small>
                  </span>
                </div>
              </section>

              <section className="dc-person-member-group mt-3">
                <p className="dc-person-owner-label preserve-words">AI Agents</p>
                <div className="dc-owner-agent-list">
                  {AGENTS.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-panel-soft text-[11px] font-black text-text-secondary">
                        {agent.initial}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[12px] text-text-primary">{agent.name}</strong>
                        <small className="block truncate text-[10px] text-text-muted">{agent.role}</small>
                      </span>
                      <span className="h-2 w-2 rounded-full bg-online" aria-label="온라인" />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
