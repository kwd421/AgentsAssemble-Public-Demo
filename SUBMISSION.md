# Wanted AI Championship 2026 제출 설명 초안

## 서비스명

**AgentsAssemble — 여러 AI가 한 방에서 협업하는 실시간 AI Room**

## 한 줄 소개

서로 분리된 AI 채팅창을 사람이 복사·중계하는 대신, 여러 AI 에이전트를 하나의 Room에 모아 같은 대화 문맥을 공유하고 서로의 의견을 이어서 검토하게 합니다.

## 문제

여러 AI를 동시에 활용할수록 사용자가 직접 각 AI의 답변을 다른 창으로 옮기고, 역할과 작업 상태를 반복해서 설명해야 합니다. 모델이 늘어날수록 사람이 오케스트레이터가 되는 문제가 생깁니다.

## 해결

AgentsAssemble는 사람과 여러 AI 에이전트를 동일한 Room의 참가자로 다룹니다. 각 에이전트는 독립된 역할을 가지면서도 하나의 공통 대화 기록을 보고, 앞선 에이전트의 판단을 이어받거나 반박할 수 있습니다.

## 웹 데모에서 체험 가능한 것

- 별도 회원가입 없이 임시 Room 생성
- 전략/엔지니어링/비평 세 역할의 AI 협업
- 앞선 Agent 답변을 다음 Agent가 실제 shared context로 사용
- 특정 Agent에게만 후속 질문
- WebSocket 기반 실시간 Room 상태 및 순차 Agent 응답
- 실패한 Agent만 문맥을 유지한 채 제한적으로 재시도

## 웹 데모의 의도적 제한

실제품의 로컬 AI CLI 연결, OAuth, MCP, provider 관리, 로컬 파일 권한 기능은 공개 심사 URL에서 제외했습니다. 공개 웹 환경에서 제3자에게 로컬 컴퓨터 권한이나 개발자 계정 설정을 요구하지 않기 위한 제한입니다. 웹 데모는 별도의 Node.js Cloud API runtime이며 원본 Rust Room/CLI runtime을 그대로 호스팅한 버전은 아닙니다.

## 기술 구성

- React + Vite frontend
- Node/Express demo gateway
- `/api/live` WebSocket 기반 Room 이벤트 전달 및 재접속 snapshot 동기화
- 구버전 탭 호환용 SSE endpoint 유지
- OpenAI-compatible server-side AI API
- 메모리-only 임시 Room
- turn/input/rate/concurrency 제한
- API credential server-side only
- 명시적 fixture 모드 외에는 실제 API 실패를 가짜 답변으로 대체하지 않음

## 권장 데모 시나리오

> “1인 개발자가 3개월 안에 만들 게임 아이디어를 평가해줘.”

첫 턴에서 세 Agent가 서로 다른 관점으로 답한 뒤, 엔지니어만 선택해:

> “RTX 3060 기준으로 구현 범위를 다시 줄여줘.”

라고 질문하면 독립 역할과 shared room context를 짧게 보여줄 수 있습니다.
