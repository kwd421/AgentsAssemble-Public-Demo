# AgentsAssemble Public Demo · 0.3

원티드 AI Championship 2026 제출용 제한된 웹 체험판입니다.

## 실제 구현 범위

React 화면은 `kwd421/agentsassemble-rust`의 고정 커밋 `2135d5112d00f80996a5f6ce98762515049cfcb8`에 있는 16개 CSS 세그먼트와 자산을 사용합니다. 원본 AppView 전체를 빌드한 웹 버전은 아닙니다. 서버는 별도의 Node.js Cloud API runtime이며 **원본 Rust Room/CLI runtime은 아직 연결되지 않았습니다**. 화면과 health 응답 모두 이를 표시합니다.

브라우저는 `/api/live` WebSocket으로 Room에 참가합니다. 서버가 사용자 발언, 에이전트 차례, 재시도, 실패, 완료 이벤트를 push합니다. 토큰 단위 upstream streaming은 아니며 각 AI의 완성된 응답이 도착하면 표시합니다. 구 버전 탭을 위한 SSE 호환 endpoint는 남겨 두었습니다.

전략가 / 엔지니어 / 비평가는 공유 Room 기록을 차례로 읽는 API 역할입니다. 자신의 과거 발언은 assistant 역할, 다른 참가자의 발언은 user 역할로 전달합니다. 이는 원본의 독립적인 상주 CLI 세션과 다릅니다. `@엔지니어`, `@engineer`, 여러 멘션, `@all`을 서버에서 해석합니다. 역할별 모델 override가 없으면 모두 `AI_MODEL`을 사용합니다.

웹 검색, 로컬 파일, CLI, MCP, 관리자 권한은 공개 데모에 없습니다. 다른 AI의 발언은 검증된 출처가 아닙니다.

## 실패 처리

HTTP 오류와 HTTP 200 내부 오류, 인증/크레딧/요청 제한, 시간 초과, 빈 본문, 토큰 소진을 분리합니다. transient 오류는 설정된 전체 제한 시간 안에서 최대 1회 자동 재시도합니다. Retry-After를 앞당겨 무시하지 않습니다. 인증·크레딧·필터 오류는 자동 재시도하지 않습니다.

마지막 질문에서 실패한 에이전트는 별도 버튼으로 최대 1회 수동 재시도할 수 있습니다. 다른 에이전트는 다시 호출하지 않고 사용자 질문/턴도 중복 추가하지 않습니다. 실패 당시 문맥을 사용합니다. 새로운 질문 이후에는 이전 실패를 재시도할 수 없습니다. 재시도도 실제 API 요청이므로 추가 비용이 발생할 수 있습니다.

`AI_MAX_TOKENS=3000`을 실제 요청에 그대로 적용합니다. 허용 범위는 128–8192, 미설정 기본값은 1200입니다. 토큰 한도는 출력 답변뿐 아니라 제공자에 따라 reasoning에도 사용될 수 있습니다. 답변 없이 length 종료된 OpenRouter 요청을 재시도할 때만, 명시적인 reasoning 설정이 없다면 low effort를 사용합니다. reasoning 내용은 표시하거나 로그에 저장하지 않습니다. 출력이 일부 있다면 버리지 않고 잘림을 표시합니다.

서버 로그는 진단 ID, 에이전트, 모델, 오류 코드/HTTP 상태, 시도 횟수, 지연시간, 사용량 숫자만 남깁니다. API 키, 질문, 답변, upstream 원문 오류와 reasoning은 애플리케이션 로그에 기록하지 않습니다. 호스팅 플랫폼의 HTTP access log 정책은 별도입니다.

## 실행

Docker는 원본 CSS를 고정 SHA에서 자동으로 가져옵니다.

```bash
cp .env.example .env
# .env의 AI_API_KEY, AI_MODEL을 설정
# 로컬에서는 APP_PUBLIC_URL=http://localhost:3000 또는 빈 값

docker build -t agentsassemble-demo .
docker run --rm --env-file .env -p 3000:3000 agentsassemble-demo
```

개발 서버를 사용할 때는 먼저 같은 고정 SHA의 `frontend/src/styles/original`을 `src/styles/original`로 가져오고 필요한 자산을 복사해야 합니다. Node 22 이상에서 `npm install && npm run dev`를 실행합니다. 개발 시 `APP_PUBLIC_URL`은 비워 두거나 `http://localhost:5173`으로 설정합니다. `npm run dev`는 `.env`를 로드합니다.

```env
AI_API_KEY=...
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=YOUR_MODEL_ID
AI_MAX_TOKENS=3000
AI_TIMEOUT_MS=45000
AI_RETRIES=1
# 선택: AI_MODEL_STRATEGIST / AI_MODEL_ENGINEER / AI_MODEL_CRITIC
# 선택: AI_REASONING_EFFORT=low
```

`DEMO_FAKE_MODE=1`은 명시적인 UI 테스트에만 사용합니다. UI에 실제 AI가 아님을 표시하며, 실제 요청 실패를 fake 답변으로 자동 대체하지 않습니다.

## 테스트와 배포

`npm test`는 mock provider를 사용하는 core 회귀 테스트와 실제 localhost HTTP/WebSocket transport 테스트를 실행합니다. API 키나 유료 모델 호출은 필요하지 않습니다. Docker build가 `npm test && npm run build`를 통과해야 production 이미지를 만듭니다. production은 build에서 검사한 dependency tree를 그대로 복사합니다.

실제 제공자의 가용성, 답변 정확성, 브라우저 시각 품질은 이 테스트만으로 검증되지 않습니다. `/api/health`에서 적용된 token/timeout 설정과 runtime mode를 확인할 수 있습니다.

## 공개 데모 제한

방당 8회 사용자 질문, 질문 2500자, 비활성 45분 후 만료, 최대 200개 방, 동시 생성 작업 최대 6개, IP당 분당 24회 요청/명령을 제한합니다. 방은 메모리 전용이며 서버 재배포·재시작 시 사라집니다. 브라우저 새로고침 시 동일 서버에 남아 있는 방은 복구합니다. 다중 replica에는 공유 저장소가 필요하므로 현재 구성은 single replica를 전제로 합니다.

WebSocket은 재접속 후 snapshot으로 동기화합니다. 유료 생성 명령을 자동으로 재전송하지 않습니다. 연결이 5초 이상 모두 끊어지면 진행 중인 생성을 중지합니다. 명시적인 중지 버튼도 있습니다. 취소 이전에 제공자가 처리한 작업의 비용까지 취소하는 것은 아닙니다.
