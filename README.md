# IB 랜딩페이지 + 신청 폼 + 리드 저장

MT5 해외선물 입문자 대상 **1:1 세팅 지원** 신청 퍼널.
카피 기준은 IB-2 `타깃·오퍼 확정 브리프`, 표현 기준은 IB-6 `광고 표현 가이드라인`.

의존성 없음 — Node 20+ 만 있으면 `npm start` 로 뜬다.

```
public/    랜딩페이지 (정적). config.js 만 바꾸면 어디에 올려도 동작한다.
server/    리드 접수 API + 정적 서빙 (Node 표준 라이브러리만 사용)
deploy/    GitHub Pages 프리뷰용 설정
docs/      utm 링크 목록, 구글 시트 웹훅 스크립트
scripts/   스모크 테스트, 알림 대역 수신기
data/      리드 원장 (gitignore — 개인정보)
```

## 빠르게 띄우기

```bash
cp .env.example .env      # 값 채우기
npm start                 # http://127.0.0.1:8787
npm run smoke             # 리드 접수 API 스모크 테스트
```

알림 채널이 아직 없을 때 알림 경로까지 검증하려면:

```bash
node scripts/mock-webhook.mjs 9911     # 터미널 1
# .env → NOTIFY_KIND=slack, NOTIFY_WEBHOOK_URL=http://127.0.0.1:9911/hook
npm start                              # 터미널 2
npm run smoke                          # 터미널 3 → data/notifications.log 확인
```

## 리드가 흐르는 경로

```
폼 제출
  → POST /api/lead
  → 서버 검증 (클라이언트 검증을 신뢰하지 않고 다시 본다)
  → data/leads.jsonl 에 기록          ← 원장. 여기 실패하면 500 을 돌려준다.
  → 구글 시트 웹훅 전송 (설정된 경우)   ← best-effort. 실패해도 리드는 살아 있다.
  → 알림 전송 (설정된 경우)            ← best-effort. 실패해도 사용자에게는 성공 응답.
  → /admin?token=... 에서 확인
```

이 순서에는 이유가 있다. **리드 유실이 가장 비싼 실패**라서, 원장 기록을 먼저 끝내고
바깥으로 나가는 호출은 전부 실패를 허용한다. 원격 저장이나 알림이 죽었다고
사용자에게 에러를 보여 주면 이미 받은 리드를 잃는다.

## 설정

| 항목 | 어디서 | 비고 |
|---|---|---|
| 리드 API 주소 | `public/config.js` → `leadEndpoint` | 비우면 페이지가 프리뷰 모드(배너 표시, 접수 안 함)로 동작 |
| 카카오 상담 링크 | `public/config.js` → `kakaoUrl` | 비우면 관련 버튼·섹션이 자동으로 숨는다 |
| 알림 채널 | `.env` → `NOTIFY_KIND` | `slack` \| `discord` \| `telegram` \| `generic` \| `none` |
| 구글 시트 | `.env` → `SHEETS_WEBHOOK_URL` | `docs/google-sheets-webhook.gs` 참고 |
| 리드 확인 화면 | `.env` → `ADMIN_TOKEN` | 비우면 `/admin` 이 404 |
| 교차 도메인 호출 | `.env` → `ALLOWED_ORIGINS` | 정적 호스팅 + 별도 API 서버 구성일 때 필요 |

## 개인정보 취급

- 수집 항목은 **이름 / 연락처 / 거래 경험 수준 / 유입 경로 4개뿐**이다. 늘리지 않는다.
- `data/` 와 `.env` 는 `.gitignore` 에 있다. **리드 파일을 절대 커밋하지 않는다.**
- 알림 메시지에는 연락처 뒤 4자리만 보낸다. 전체 번호는 `/admin` 에서만 본다.
- 동의 문구 원문이 각 리드 레코드에 함께 저장된다 (`consentText`).

## 표현 관련 (건드리기 전에 읽을 것)

랜딩 문구는 IB-2 브리프와 IB-6 가이드라인의 제약을 받는다.

- 수익·원금 보장, 확정 수익률, "무조건/100%/절대" 표현 금지
- 타 브로커·타 IB 비방 금지
- **리스크 고지 문구는 생략 불가** (`index.html` 푸터). 문구를 임의로 줄이지 않는다.
- 리베이트·캐시백·환급 단어와 모든 수치는 **IB-8 확인 전까지 사용 금지**.
  현재 근거 블록 03에 들어간 문구가 브리프 6-1절이 허용한 유일한 표현이다.

카피를 바꿔야 하면 브리프를 먼저 고치고 여기를 고친다.
