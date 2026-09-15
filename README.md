# AgentsAssemble Public Demo

원티드 AI Championship 2026 제출용 웹 체험판입니다.

이 공개 데모의 **시각 UI는 원본 `kwd421/agentsassemble-rust`의 고정 커밋 `2135d5112d00f80996a5f6ce98762515049cfcb8`에서 직접 가져온 AgentsAssemble room UI 스타일 시스템**을 사용합니다. Docker build 중 원본 `frontend/src/styles/original`을 해당 고정 커밋에서 vendor하며, Public Demo는 원본 데스크톱 controller 대신 제한된 서버측 AI demo adapter만 연결합니다.

핵심 경험:
- 로그인 없이 임시 Room
- 전략가 / 엔지니어 / 비평가 3 Agent
- 같은 Room transcript 공유
- 특정 Agent에게 후속 질문
- SSE 순차 응답
- 서버측 AI API key
- Room당 8 user turns
- 메모리-only 세션

## 실행

```bash
cp .env.example .env
npm install
npm run dev
```

브라우저: `http://localhost:5173`

## 실제 AI 연결

OpenAI-compatible Chat Completions API를 사용합니다.

```env
AI_API_KEY=...
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=YOUR_MODEL_ID
```

역할별 모델을 쓰고 싶으면:

```env
AI_MODEL_STRATEGIST=...
AI_MODEL_ENGINEER=...
AI_MODEL_CRITIC=...
```

## UI-only preview

```env
DEMO_FAKE_MODE=1
```

대회 제출에서는 끄는 것을 권장합니다. AI API 실패 시 자동 fake fallback은 없습니다.

## Railway

Dockerfile과 railway.json 포함.

Railway build가 원본 UI 스타일을 고정 SHA에서 직접 fetch하므로 `agentsassemble-rust`의 최신 main 변경에 의해 데모 UI가 임의로 바뀌지 않습니다.

## 공개 데모 제한

- Room 45분 lazy-expire
- 최대 200 rooms
- Room당 8 user turns
- 입력 2500자
- 기본 AI_MAX_TOKENS=500
- 분당 IP 24 API requests

실제 데스크톱 제품의 로컬 CLI, MCP, OAuth, provider 업데이트, Keychain/파일 권한, 관리자 기능은 공개 심사 URL에서 의도적으로 제외합니다.
