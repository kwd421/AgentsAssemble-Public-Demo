# AgentsAssemble Public Demo

원티드 AI Championship 2026 제출용으로 분리한 **웹 체험판**입니다.

> 여러 AI 에이전트가 같은 Room 기록을 공유하면서 앞선 의견을 읽고 순서대로 협업하는 경험만 남겼습니다.

이 저장소는 데스크톱 AgentsAssemble 전체 제품의 대체 구현이 아닙니다. 공개 심사자가 설치·로그인·로컬 CLI 설정 없이 핵심 아이디어를 바로 체험하도록 만든 제한된 public demo입니다.

## 체험 범위

- 로그인 없이 임시 Room 생성
- 전략가 → 엔지니어 → 비평가 3개 Agent
- 같은 Room transcript를 다음 Agent가 그대로 이어서 읽음
- 특정 Agent만 선택해 후속 질문 가능
- Agent별 응답을 SSE로 순차 표시
- 한 Room 최대 8 user turns
- IP 단위 간단한 요청 제한
- Room은 서버 메모리에만 저장되고 45분 뒤 lazy-expire
- 브라우저에 AI API key를 전달하지 않음

### 데모에서 의도적으로 제외

- 로컬 Codex / Claude / Grok / Cursor CLI 실행
- MCP / Room Connector 설정
- OAuth 및 provider update
- 데스크톱 Keychain/로컬 파일 권한
- 관리자·diagnostics·rolling restart
- 장기 persistence와 계정 기능

## 실행

Node.js 22 이상이 필요합니다.

```bash
cp .env.example .env
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`.

## 실제 AI 연결

OpenAI-compatible Chat Completions API를 사용합니다. OpenRouter를 쓸 경우:

```env
AI_API_KEY=...
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=YOUR_MODEL_ID
```

또는 역할마다 다른 모델을 지정할 수 있습니다.

```env
AI_MODEL_STRATEGIST=YOUR_MODEL_ID
AI_MODEL_ENGINEER=YOUR_MODEL_ID
AI_MODEL_CRITIC=YOUR_MODEL_ID
```

`AI_MODEL` 하나만 지정하면 세 Agent가 같은 모델을 사용하되 역할 prompt가 달라집니다.

### 로컬 UI만 확인

```env
DEMO_FAKE_MODE=1
```

이 모드는 **명시적 로컬 preview 전용**입니다. AI 호출 실패 시 자동 fake fallback을 하지 않습니다. 대회 제출 배포에서는 사용하지 마세요.

## Railway 배포

Dockerfile과 `railway.json`이 포함되어 있습니다.

1. GitHub에 이 저장소를 만든 뒤 Railway에서 **New Project → Deploy from GitHub repo**
2. Variables에 최소한 아래를 등록
   - `AI_API_KEY`
   - `AI_MODEL` 또는 역할별 model 변수
   - `APP_PUBLIC_URL=https://...`
   - `APP_NAME=AgentsAssemble Public Demo`
3. Railway 공개 domain의 `/api/health` 확인
4. 시크릿 창과 모바일에서 실제 첫 체험 확인

서버는 Railway의 `PORT`를 자동 사용합니다.

## 공개 데모 비용 방어

기본값:

- Room 수: 메모리 내 최대 200
- Room 수명: 45분
- 사용자 발화: Room당 최대 8회
- 메시지: 최대 2,500자
- 모델 응답: `AI_MAX_TOKENS=500`
- Agent 호출: 한 사용자 발화에 최대 3회
- IP 요청 제한: 분당 24 API requests

## 심사자에게 보여줄 30초 흐름

1. 첫 화면에서 예시 질문 선택
2. **AI 팀 소집하기**
3. 전략가 → 엔지니어 → 비평가가 순서대로 답변
4. 왼쪽에서 `엔지니어`를 선택
5. 구현 가능성에 대한 후속 질문
6. 다시 전체 Agent 선택 후 의견 비교

## Production demo checklist

- [ ] `DEMO_FAKE_MODE`가 꺼져 있다.
- [ ] 실제 AI 응답이 나온다.
- [ ] 새 시크릿 창에서도 로그인 없이 들어간다.
- [ ] API key가 JS bundle/network response에 노출되지 않는다.
- [ ] 모바일 390px에서 입력과 답변을 사용할 수 있다.
- [ ] 한 모델이 실패하면 오류가 보이고 fake 성공으로 바뀌지 않는다.
- [ ] 8턴 한도가 실제 적용된다.
- [ ] `/api/health`가 정상이다.
- [ ] 제출 URL이 심사 기간 동안 계속 유지된다.

## Security / privacy

공개 체험판은 민감한 정보를 받는 용도가 아닙니다. Room transcript는 서버 프로세스 메모리에만 존재하지만, 사용자가 입력한 내용은 설정된 AI API provider에 전달됩니다. 배포 화면과 개인정보 안내에서 이 점을 명확히 고지해야 합니다.
