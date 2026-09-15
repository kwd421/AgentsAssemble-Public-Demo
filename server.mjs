import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));

const PORT = Number(process.env.PORT || 3000);
const ROOM_TTL_MS = 45 * 60 * 1000;
const MAX_ROOMS = 200;
const MAX_USER_TURNS = 8;
const MAX_INPUT_CHARS = 2500;
const MAX_TRANSCRIPT_CHARS = 24_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 24;
const AI_TIMEOUT_MS = clampNumber(process.env.AI_TIMEOUT_MS, 5_000, 60_000, 30_000);
const AI_MAX_TOKENS = clampNumber(process.env.AI_MAX_TOKENS, 128, 1200, 500);

const rooms = new Map();
const rate = new Map();

const AGENTS = [
  {
    id: "strategist",
    name: "전략가",
    label: "Strategy",
    modelEnv: "AI_MODEL_STRATEGIST",
    prompt:
      "당신은 전략가입니다. 목표를 구조화하고 우선순위를 정하며, 모호한 전제를 짚습니다. " +
      "한국어로 3~6문장 정도로 간결하게 답하세요. 다른 에이전트의 발언이 있다면 필요한 부분을 직접 이어받거나 반박하세요."
  },
  {
    id: "engineer",
    name: "엔지니어",
    label: "Engineering",
    modelEnv: "AI_MODEL_ENGINEER",
    prompt:
      "당신은 시니어 소프트웨어 엔지니어입니다. 구현 가능성, 기술 선택, 비용과 리스크를 구체적으로 평가합니다. " +
      "한국어로 3~6문장 정도로 간결하게 답하세요. 전략가나 다른 에이전트의 발언을 같은 공유 문맥으로 보고 필요한 부분을 이어받으세요."
  },
  {
    id: "critic",
    name: "비평가",
    label: "Critical Review",
    modelEnv: "AI_MODEL_CRITIC",
    prompt:
      "당신은 비평가입니다. 앞선 의견의 허점, 과도한 범위, 실패 조건과 검증 방법을 찾습니다. " +
      "무조건 부정하지 말고 가장 큰 위험과 개선안을 한국어 3~6문장으로 제시하세요. 다른 에이전트의 발언을 명시적으로 검토할 수 있습니다."
  }
];

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
function now() { return Date.now(); }
function requestIp(req) { return String(req.ip || req.socket.remoteAddress || "unknown"); }
function prune() {
  const cutoff = now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) if (room.updatedAt < cutoff) rooms.delete(id);
  if (rooms.size <= MAX_ROOMS) return;
  const ordered = [...rooms.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const room of ordered.slice(0, rooms.size - MAX_ROOMS)) rooms.delete(room.id);
}
function rateLimited(req) {
  const key = requestIp(req);
  const stamp = now();
  const current = rate.get(key);
  if (!current || stamp - current.startedAt >= RATE_WINDOW_MS) {
    rate.set(key, { startedAt: stamp, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX;
}
function createRoom() {
  prune();
  const id = crypto.randomBytes(12).toString("base64url");
  const room = { id, createdAt: now(), updatedAt: now(), userTurns: 0, busy: false, messages: [] };
  rooms.set(id, room);
  return room;
}
function publicRoom(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    userTurns: room.userTurns,
    maxUserTurns: MAX_USER_TURNS,
    agents: AGENTS.map(({ id, name, label }) => ({ id, name, label })),
    messages: room.messages
  };
}
function cleanInput(value) {
  if (typeof value !== "string") return "";
  const clean = value.trim();
  if (!clean || clean.length > MAX_INPUT_CHARS) return "";
  return clean;
}
function transcript(room) {
  const rows = room.messages.map((message) => {
    if (message.kind === "user") return `사용자: ${message.content}`;
    if (message.kind === "agent") return `${message.agentName}: ${message.content}`;
    return "";
  });
  let joined = rows.filter(Boolean).join("\n\n");
  if (joined.length > MAX_TRANSCRIPT_CHARS) joined = joined.slice(joined.length - MAX_TRANSCRIPT_CHARS);
  return joined;
}
function selectedAgents(targetAgentId) {
  if (!targetAgentId) return AGENTS;
  const one = AGENTS.find((agent) => agent.id === targetAgentId);
  return one ? [one] : [];
}
function modelFor(agent) {
  return (process.env[agent.modelEnv] || process.env.AI_MODEL || "").trim();
}
function fakeResponse(agent, userText) {
  const topic = userText.length > 120 ? `${userText.slice(0, 117)}...` : userText;
  return {
    strategist: `“${topic}”를 목표·사용자·제약으로 나눠 먼저 정의하는 게 좋습니다. 첫 데모에서는 핵심 가치가 바로 보이는 한 가지 흐름만 남기고, 부가 기능은 과감히 제외하세요. 성공 기준을 ‘처음 접속한 사용자가 짧은 시간 안에 결과를 이해하는가’로 두겠습니다.`,
    engineer: "구현 관점에서는 기존 기능을 모두 옮기기보다 입력→공유 문맥→여러 에이전트 응답의 최소 경로를 독립 서비스로 만드는 편이 안전합니다. API 키는 서버에만 두고, 세션은 메모리에 제한하며, 턴 수와 입력 길이를 제한하면 공개 데모 비용도 통제할 수 있습니다.",
    critic: "가장 큰 위험은 기능을 많이 보여주려다 첫 체험이 느려지는 것입니다. 모델 세 개를 매 턴 호출하면 지연과 비용이 커질 수 있으므로 짧은 응답 제한과 명확한 실패 표시가 필요합니다. 심사 환경에서는 로그인·설치·로컬 CLI 의존성이 없어야 합니다."
  }[agent.id];
}
async function callAgent(agent, room, signal) {
  if (process.env.DEMO_FAKE_MODE === "1") {
    const lastUser = [...room.messages].reverse().find((m) => m.kind === "user")?.content || "";
    return fakeResponse(agent, lastUser);
  }
  const apiKey = (process.env.AI_API_KEY || "").trim();
  const model = modelFor(agent);
  if (!apiKey || !model) {
    const error = new Error("AI demo is not configured.");
    error.code = "demo_not_configured";
    throw error;
  }
  const base = (process.env.AI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const headers = { "content-type": "application/json", "authorization": `Bearer ${apiKey}` };
  if (process.env.APP_PUBLIC_URL) headers["HTTP-Referer"] = process.env.APP_PUBLIC_URL;
  if (process.env.APP_NAME) headers["X-Title"] = process.env.APP_NAME;
  const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(AI_TIMEOUT_MS)]);
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal: combinedSignal,
    body: JSON.stringify({
      model,
      temperature: 0.55,
      max_tokens: AI_MAX_TOKENS,
      messages: [
        {
          role: "system",
          content: `${agent.prompt}\n\n이 대화는 AgentsAssemble 공개 데모의 하나의 Room입니다. 모든 참가자는 아래 동일한 Room 기록을 공유합니다. 존재하지 않는 실행 결과나 도구 사용을 꾸며내지 마세요.`
        },
        { role: "user", content: `현재 Room 기록:\n\n${transcript(room)}\n\n당신 차례입니다.` }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`AI upstream returned ${response.status}`);
    error.code = "ai_upstream_error";
    error.detail = text.slice(0, 300);
    throw error;
  }
  let data;
  try { data = JSON.parse(text); } catch {
    const error = new Error("AI upstream returned invalid JSON");
    error.code = "ai_upstream_invalid";
    throw error;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const error = new Error("AI upstream returned an empty answer");
    error.code = "ai_upstream_empty";
    throw error;
  }
  return content.trim().slice(0, 5000);
}
function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") && rateLimited(req)) return res.status(429).json({ error: "rate_limited" });
  next();
});
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    fakeMode: process.env.DEMO_FAKE_MODE === "1",
    configured: process.env.DEMO_FAKE_MODE === "1" || Boolean(process.env.AI_API_KEY && (process.env.AI_MODEL || (process.env.AI_MODEL_STRATEGIST && process.env.AI_MODEL_ENGINEER && process.env.AI_MODEL_CRITIC)))
  });
});
app.post("/api/rooms", (_req, res) => res.status(201).json(publicRoom(createRoom())));
app.get("/api/rooms/:roomId", (req, res) => {
  prune();
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: "room_not_found" });
  res.json(publicRoom(room));
});
app.post("/api/rooms/:roomId/turns/stream", async (req, res) => {
  prune();
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: "room_not_found" });
  if (room.busy) return res.status(409).json({ error: "room_busy" });
  if (room.userTurns >= MAX_USER_TURNS) return res.status(429).json({ error: "turn_limit_reached" });
  const content = cleanInput(req.body?.content);
  if (!content) return res.status(400).json({ error: "invalid_message" });
  const agents = selectedAgents(req.body?.targetAgentId || "");
  if (!agents.length) return res.status(400).json({ error: "unknown_agent" });

  room.busy = true;
  room.updatedAt = now();
  room.userTurns += 1;
  const userMessage = { id: crypto.randomUUID(), kind: "user", content, createdAt: new Date().toISOString() };
  room.messages.push(userMessage);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const cancellation = new AbortController();
  let finished = false;
  res.on("close", () => { if (!finished) cancellation.abort(); });
  try {
    sse(res, "accepted", { userMessage, userTurns: room.userTurns, maxUserTurns: MAX_USER_TURNS });
    for (const agent of agents) {
      sse(res, "agent_start", { agentId: agent.id });
      try {
        const answer = await callAgent(agent, room, cancellation.signal);
        const message = {
          id: crypto.randomUUID(), kind: "agent", agentId: agent.id, agentName: agent.name,
          agentLabel: agent.label, content: answer, createdAt: new Date().toISOString()
        };
        room.messages.push(message);
        room.updatedAt = now();
        sse(res, "agent", message);
      } catch (error) {
        if (cancellation.signal.aborted) throw error;
        sse(res, "agent_error", { agentId: agent.id, code: error?.code || "agent_failed", message: "이 에이전트의 응답을 가져오지 못했습니다." });
      }
    }
    sse(res, "done", { userTurns: room.userTurns, maxUserTurns: MAX_USER_TURNS });
    finished = true;
    res.end();
  } catch (error) {
    if (!cancellation.signal.aborted && !res.writableEnded) {
      sse(res, "fatal", { code: error?.code || "turn_failed", message: "응답 도중 연결이 종료되었습니다." });
      finished = true;
      res.end();
    }
  } finally {
    room.busy = false;
    room.updatedAt = now();
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
app.use(express.static(dist, { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`AgentsAssemble Public Demo listening on :${PORT}`));
