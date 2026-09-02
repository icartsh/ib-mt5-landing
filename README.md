# IB 랜딩페이지 + 신청 폼 + 리드 저장

MT5 해외선물 입문자 대상 **1:1 세팅 지원** 신청 퍼널.
제휴 브로커는 **MIM(My Investment Markets)** 이고 우리는 그 IB(소개영업자)다 (IB-10).
카피 기준은 IB-2 `타깃·오퍼 확정 브리프`, 표현 기준은 IB-6 `광고 표현 가이드라인`,
브로커 사실 기준은 `docs/mim-broker-facts.md`.

의존성 없음 — Node 20+ 만 있으면 `npm start` 로 뜬다.

```
public/    랜딩페이지 (정적). config.js 만 바꾸면 어디에 올려도 동작한다.
api/       Vercel 서버리스 함수 (/api/lead) — 실제 배포에서 신청을 받는 곳
server/    로컬 개발 서버 + 공용 로직 (lead-core / sinks). Node 표준 라이브러리만 사용
deploy/    GitHub Pages 프리뷰용 설정
docs/      utm 링크 목록, 구글 시트 웹훅 스크립트, MIM 브로커 사실 대장
scripts/   스모크 테스트, 문구 가드, 알림 대역 수신기
data/      리드 원장 (gitignore — 개인정보)
```

검증·조립 규칙은 `server/lead-core.mjs` 한 곳에 있고 로컬 서버와 서버리스 함수가
그것을 함께 쓴다. 두 벌로 갈라지면 한쪽만 고치는 사고가 반드시 난다.

## 페이지 3개

| 경로 | 하는 일 | 노리는 것 |
|---|---|---|
| `/` (index.html) | 1:1 세팅 지원 신청 퍼널 | 전화 상담 리드 |
| `/broker` (broker.html) | 브로커를 직접 검증하는 6가지 체크포인트 + MIM을 같은 기준으로 대조 | 신뢰 → 가입 또는 상담 |
| `/signup` (signup.html) | MIM 계좌 개설 6단계 + 막히는 지점 | 가입 완주 |

`/broker` 와 `/signup` 은 IB-10 참고 영상 두 편의 구조를 그대로 따랐다 —
하나는 브로커 체크포인트, 하나는 가입 절차 A-Z 다.

**브로커 조건 수치(최소 입금액·스프레드·레버리지·커미션)는 페이지에 싣지 않는다.**
사장님 결정(IB-10, 2026-09-03): **브로커명 표기는 하되 조건표는 뺀다.** 파트너 가이드라인 위반은
IB 코드 정지로 이어지고, 그러면 트래픽이 아무리 늘어도 수수료가 0이다.
숫자는 `docs/mim-broker-facts.md`(내부 대장)에만 두고, 페이지는 MIM 공식 페이지로 링크한다.
문구 가드 4-B 가 이걸 기계로 막는다 — 사람이 기억하는 대신.

### 전환 경로 값 (`public/config.js`)

`mimSignupUrl` = 우리 IB 코드(`LKXAQG`)가 붙은 MIM 가입 링크, `telegramUrl` = 문의 봇 주소.
**비어 있으면 해당 버튼은 렌더링되지 않고** 그 자리를 1:1 상담 신청 버튼이 대신한다 —
죽은 링크나 "준비 중" 버튼을 내보내지 않기 위해서다.

주의할 점 두 가지:

- **가입 링크에서 IB 코드가 빠져도 가입은 정상적으로 된다.** 화면에도 로그에도 차이가 없고,
  정산이 비었을 때에야 드러난다. 그래서 문구 가드 6-B 가 코드 구간 존재를 검사한다.
- 포털은 그 코드를 **sessionStorage** 에 담는다(2026-09-03 실제 브라우저 확인).
  **창을 닫으면 사라진다** — 그래서 `/signup` 1단계에 "링크로 들어온 그 창에서 이어서 마치시라"고 적어 두었다.

## 빠르게 띄우기

```bash
cp .env.example .env      # 값 채우기
npm start                 # http://127.0.0.1:8787
npm run smoke             # 로컬 서버 리드 접수 스모크 테스트 (서버가 떠 있어야 한다)

npm test                  # 문구 가드 + 서버리스 접수 경로 검사 (서버 불필요)
```

`npm test` 는 가짜 텔레그램 서버를 띄워서 `api/lead.js` 를 실제 HTTP 요청까지
확인한다. 비밀값이 없어도 돌기 때문에 CI 에서도 그대로 돈다.

알림 채널이 아직 없을 때 알림 경로까지 검증하려면:

```bash
node scripts/mock-webhook.mjs 9911     # 터미널 1
# .env → NOTIFY_KIND=slack, NOTIFY_WEBHOOK_URL=http://127.0.0.1:9911/hook
npm start                              # 터미널 2
npm run smoke                          # 터미널 3 → data/notifications.log 확인
```

## 리드가 흐르는 경로

두 환경에서 규칙이 **다르다**. 차이는 하나 — 로컬에는 원장이 있고 서버리스에는 없다.

```
[로컬 서버]  server/server.mjs
  폼 제출 → 서버 검증 → data/leads.jsonl 기록  ← 원장. 실패하면 500.
                      → 텔레그램/시트 전송      ← 전부 best-effort. 실패해도 성공 응답.
                      → /admin?token=... 에서 확인

[서버리스]   api/lead.js  (Vercel)
  폼 제출 → 서버 검증 → 텔레그램/시트 전송      ← 최소 한 곳이 성공해야 성공 응답.
                                                 전부 실패하면 503 + 재시도 안내.
```

로컬에서 바깥 호출을 전부 실패 허용하는 이유는 **리드 유실이 가장 비싼 실패**이기 때문이다.
원장에 이미 남았으므로 알림이 죽었다고 사용자에게 에러를 보여 줄 이유가 없다.

서버리스에서는 그 논리가 뒤집힌다. 디스크가 호출마다 사라져서 원장이 없고, 리드를 다시
읽을 수 있는 곳은 텔레그램 대화와 구글 시트뿐이다. 거기 다 실패했는데 "접수되었습니다"
라고 답하면 **그 사람은 오지 않는 전화를 기다리게 된다.** 그래서 거절하고 재시도를 받는다.

## 설정

| 항목 | 어디서 | 비고 |
|---|---|---|
| 리드 API 주소 | `public/config.js` → `leadEndpoint` | 비우면 페이지가 프리뷰 모드(배너 표시, 접수 안 함)로 동작 |
| 텔레그램 **알림** 봇 토큰 | `.env` / Vercel 환경변수 → `TELEGRAM_BOT_TOKEN` | 서버 → 사장님. **이 봇 주소는 어디에도 공개하지 않는다** |
| 텔레그램 대화 ID | `.env` / Vercel 환경변수 → `TELEGRAM_CHAT_ID` | **고정 권장.** 비우면 알림 봇의 최근 대화에서 찾는데, 그 봇에 대화가 둘 이상이면 접수가 멈춘다 |
| 텔레그램 **문의** 봇 토큰 | `.env` / Vercel 환경변수 → `TELEGRAM_INQUIRY_BOT_TOKEN` | 고객 → 사장님. 페이지의 "텔레그램 문의" 버튼이 향하는 봇 → `docs/telegram-inquiry.md` |
| 문의 webhook 비밀값 | `.env` / Vercel 환경변수 → `TELEGRAM_WEBHOOK_SECRET` | 없으면 `/api/telegram` 이 503 으로 닫혀 있다. `openssl rand -hex 24` |
| 구글 시트 | `.env` → `SHEETS_WEBHOOK_URL` | 선택. `docs/google-sheets-webhook.gs` 참고 |
| 추가 알림 채널 | `.env` → `NOTIFY_KIND` | `slack` \| `discord` \| `generic` \| `none`. 기록으로 치지 않는다 |
| 리드 확인 화면 | `.env` → `ADMIN_TOKEN` | 로컬 전용. 비우면 `/admin` 이 404 |
| 교차 도메인 호출 | `.env` → `ALLOWED_ORIGINS` | 정적 호스팅 + 별도 API 서버 구성일 때 필요 |

상담 연결은 **전화 콜백**과 **텔레그램 문의 봇** 두 가지다. 카카오 경로는 코드에 없다.

> **텔레그램 봇은 두 개이고 절대 하나로 합치면 안 된다.**
> 알림 봇(`@icartsh_answer_bot`)은 서버가 사장님에게 리드를 보내는 내부 채널이고,
> 문의 봇(`@icartsh_ib_bot`)은 고객이 우리에게 말을 거는 공개 채널이다.
> 알림 봇 주소를 페이지에 걸면 고객이 그 봇 대화 목록에 들어오고, 목적지 자동 탐색이
> 그 고객을 골라 **신청자의 이름과 전체 전화번호가 낯선 사람에게 갈 수 있다.**
> 켜는 순서와 고장 진단은 `docs/telegram-inquiry.md`.

## Vercel 배포

리포를 Vercel에 연결하면 `vercel.json` 대로 `public/` 이 정적으로, `api/lead.js` 가
`/api/lead` 로 붙는다. 페이지와 API가 같은 도메인이라 CORS 설정이 필요 없다.
빌드 단계에서 문구 가드가 돌고, **실패하면 배포가 막힌다.**

Vercel 환경변수에 `TELEGRAM_BOT_TOKEN` 하나만 넣으면 접수가 살아난다.

### 순서 — 환경변수는 Deploy **전에** 넣어야 한다

```
① vercel.com → Continue with GitHub
② Add New → Project → icartsh/ib-mt5-landing 옆 Import
③ Configure Project 화면에서 "Environment Variables" 를 펼치고
     TELEGRAM_BOT_TOKEN = <@BotFather 토큰>          ← 이 줄이 빠지면 아래 사고가 난다
④ Deploy
⑤ 텔레그램에서 그 봇에게 /start 를 한 번 보낸다 (chat_id 자동 탐색용)
```

**③을 건너뛰면 페이지는 정상으로 뜨는데 신청이 100% 거절된다.** 토큰도 시트 URL 도
없으면 리드를 담을 durable sink 가 하나도 없고, `api/lead.js` 는 그 상태에서
접수된 척하지 않고 `503 "접수 설정이 완료되지 않았습니다."` 를 돌려준다. 겉보기에는
멀쩡한 랜딩페이지라 라이브로 착각하기 쉽다. 이 상태는 스모크 `[9]` 가 검사한다.

이미 ③ 없이 Deploy 했다면 Settings → Environment Variables 에서 추가한 뒤
**반드시 Redeploy** 해야 한다. Vercel 문서:
> Any change you make to environment variables are not applied to previous
> deployments, they only apply to new deployments.

> **Deploy Button(`vercel.com/clone`)은 쓰지 않는다.** 그 흐름은 소스 리포를 사용자
> 계정으로 **복제**하기 때문에, 배포가 원본이 아니라 복제본을 추적하게 된다.
> 그러면 이 리포에 푸시해도 라이브에 반영되지 않는다. 리포 주인이 직접 Import 하는
> 위 순서가 맞다.

## 개인정보 취급

- 수집 항목은 **이름 / 연락처 / 거래 경험 수준 / 유입 경로 4개뿐**이다. 늘리지 않는다.
- `data/` 와 `.env` 는 `.gitignore` 에 있다. **리드 파일을 절대 커밋하지 않는다.**
- 연락처 전체가 나가는 곳은 **텔레그램 봇 1:1 대화뿐**이다. 운영자 개인 채널이고,
  서버리스에서는 그 메시지가 리드를 다시 읽을 수 있는 유일한 기록이며,
  무엇보다 **번호를 가리면 전화를 걸 수 없다.**
  슬랙·디스코드 웹훅은 여러 사람이 보는 채널일 수 있어 뒤 4자리만 보낸다.
  (봇의 `TELEGRAM_CHAT_ID` 를 단톡방으로 지정하면 그 방 사람들이 전체 번호를 보게 된다.)
- 동의 문구 원문이 각 리드 레코드에 함께 저장된다 (`consentText`).

## 표현 관련 (건드리기 전에 읽을 것)

랜딩 문구는 IB-2 브리프와 IB-6 가이드라인의 제약을 받는다.

- 수익·원금 보장, 확정 수익률, "무조건/100%/절대" 표현 금지
- 타 브로커·타 IB 비방 금지
- **리스크 고지 문구는 생략 불가** (`index.html` 푸터). 문구를 임의로 줄이지 않는다.
- 리베이트·캐시백·페이백·환급은 **단어 자체가 금지**이고 모든 수치도 금지다 (IB-8 §2).
  근거 블록 03의 `#rebate-copy` 문구가 허용된 **유일한** 표현이며, 이 문구는 **확정**이다.
  자리표시자·빈 칸·`TBD` 를 만들지 않는다.

카피를 바꿔야 하면 브리프를 먼저 고치고 여기를 고친다.

### `#rebate-copy` 를 교체해야 할 때

IB-8 답변 분기 **A·B에서만** `index.html` 의 `<p id="rebate-copy">` **안쪽만** 갈아끼운다.
분기 **C·D·E면 랜딩은 손대지 않는다.** 문구를 근거 블록 밖(헤드라인·서브카피·CTA)으로 옮기지 않는다.

### 문구 가드

```bash
npm run copy-guard
```

금지 표현, 확정 문구의 위치·중복·누락, 리스크 고지 존재, 수집 필드 4개를 검사한다.
**배포 워크플로가 이 검사를 통과해야만 Pages에 올라간다.** 카피는 여러 사람이 손대므로
문서에만 적어 두면 지켜지지 않는다.
