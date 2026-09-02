# MIM(My Investment Markets) 브로커 사실 대장

> **이 문서의 역할** — 브로커 관련 숫자와 사실을 모아 두는 **내부 대장**이다.
> 여기 없는 숫자는 어디에도 쓰지 않는다.
>
> ⚠️ **2026-09-03 변경 — 조건 수치는 이제 페이지에 나가지 않는다.**
> 사장님 결정(IB-10 질문 3번, `name_only`): **MIM 이름 표기는 가능하되 계좌별 조건표(최소 입금액·스프레드·
> 레버리지·커미션)는 우리 페이지에 싣지 않는다.** 아래 3·4절 숫자는 **상담·내부 판단용**이며,
> 페이지에서는 MIM 공식 페이지로 링크한다. 이 규칙은 `scripts/copy-guard.mjs` 4-B 검사가 기계로 막는다.
>
> **확인일: 2026-09-02** · **출처: MIM 공식 사이트(myinvestmentmarkets.com) 게시 내용**
> IB-6 `guidelines` 5번(숫자에는 출처와 기준일을 붙인다) 이행 문서다.

---

## 0. 우리와 MIM의 관계

- 우리 회사는 **MIM의 IB(Introducing Broker, 소개영업자) 코드를 보유**하고 있다. (IB-10, 사용자 확인)
- 즉 우리는 MIM의 자회사·지점·대리인이 아니다. **소개영업자**다.
- 따라서 모든 페이지 하단에 이해관계를 고지한다 (IB-6 `guidelines` 2-A 마지막 줄, 생략 불가):
  > 본 페이지 운영자는 MIM의 IB(소개영업자)로서 거래 수수료의 일부를 지급받습니다.

---

## 1. 법인·규제 (확인됨)

| 항목 | 값 | 출처 |
|---|---|---|
| 브랜드명 | MIM / My Investment Markets (엠아이엠 · 마이인베스트먼트마켓) | 공식 사이트 표기 |
| 규제 기관 | 모리셔스 금융감독위원회 (Financial Services Commission, FSC of Mauritius) | 회사 소개 페이지 |
| 라이선스 번호 | **GB24203684** (Investment Dealer License) | 회사 소개 · 문의 페이지 · 푸터 |
| 등록 주소 | 1st Floor River Court, 6 St Denis Street, Port Louis 11328, Mauritius | 문의 페이지 |
| 서비스 개시 | 2024년 | 회사 소개("Since 2024") |
| 고객 자금 | 분리 보관 (Segregated Account, 회사 운영자금과 분리) | 회사 소개 |
| 지원 이메일 | support@myinvestmentmarkets.com | 푸터 |
| 고객지원 시간 | 24/5 (이메일·라이브챗·전화·콜백) | 문의 페이지 |

> ⚠️ **정직하게 같이 적어야 하는 사실** — 모리셔스 FSC는 미국 NFA/CFTC, 영국 FCA와 **규제 강도와 투자자 보호 장치가 다르다.**
> 이 차이를 감추면 표시광고법 §3(기만: 불리한 사실 은폐)에 걸린다. 체크포인트 페이지에서 이 문장을 빼지 않는다.

## 2. 플랫폼 (확인됨)

| 플랫폼 | 설명 |
|---|---|
| MIM MT5 터미널 | 데스크톱 MetaTrader 5. 수동·알고리즘(EA) 거래 |
| MI-Markets 웹트레이더 | 설치 없이 브라우저에서 접속 |
| MI-Markets 모바일 | iOS / Android 앱 |

- 체결 방식: **Market Execution (NDD)**
- 서버 시간: **GMT+2 / GMT+3 (서머타임 적용 시)** — 한국 시간과 다르므로 차트 시간 해석에 주의
- Forex 거래 시간: 24/5 (00:01 – 23:59, 금요일 00:01 – 23:57)

## 3. 계좌 유형 (확인됨)

| 계좌 | 최소 입금 | 스프레드 | 최대 레버리지 | 커미션 |
|---|---|---|---|---|
| STANDARD | $100 USD | 1.5핍부터 | 1:500 | 별도 커미션 없음 |
| EXCLUSIVE | $5,000 USD | 1.1핍부터 | 1:500 | 별도 커미션 없음 |
| EXCLUSIVE (SWAP-FREE) | $5,000 USD | 1.3핍부터 | 1:200 | 거래량 1로트 기준 $1 |

> **"커미션 없음"을 "비용 없음"으로 옮겨 쓰지 않는다.** 스프레드와 스왑(오버나이트 이자)이 실제 비용이다.
> IB-6 `guidelines` 1-E: "수수료 0원 / 완전 무료"는 비용 은폐로 금지.

## 4. 거래 상품 (확인됨)

| 분류 | 대표 종목 | 최대 레버리지 |
|---|---|---|
| 외환(Forex) | EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, EURGBP, EURJPY, GBPJPY, AUDNZD | 1:500 |
| 지수(Indices) | US30, US500, US100, GER40, UK100, JP225 외 | 1:200 |
| 원자재(Commodities) | XAUUSD(금), XAGUSD(은), XTIUSD(WTI), XBRUSD(브렌트) | 1:100 |
| 암호화폐 CFD | 비트코인·이더리움 등 (24/7, 점검 시간 제외) | 1:100 |
| 주식 CFD | 미국·EU·영국 주요 50종목 이상 | 1:20 |

- 지수 최소 거래 단위 0.1로트, 암호화폐 최소 0.01로트
- 원자재 계약 단위: 금 100oz, 원유 1,000배럴
- 전체 종목 수: 공식 표기 기준 **60종목 이상**(핵심 자산 선별 운용)

> ⚠️ 레버리지는 **손실도 같은 배율로 키운다.** 1:500을 "기회"로만 적지 않는다.

## 5. 입출금 수단 (확인됨)

은행 송금(실시간) · 현금 입금(제휴 창구) · 이월렛(Skrill, Neteller) · 모바일 머니 · QR 결제 · 암호화폐(USDT ERC20/TRC20)

## 6. MIM 공식 페이지 링크 (한국어, 2026-09-02 응답 확인)

| 내용 | URL |
|---|---|
| 한국어 홈 | https://myinvestmentmarkets.com/kr |
| 회사 소개 | https://myinvestmentmarkets.com/kr/about |
| 계좌 유형 | https://myinvestmentmarkets.com/kr/accounts |
| MT5 플랫폼 | https://myinvestmentmarkets.com/kr/platform/mt5 |
| 입출금 방법 | https://myinvestmentmarkets.com/kr/payments |
| 위험 고지 | https://myinvestmentmarkets.com/kr/legal/risk-disclosure |
| 고객확인·자금세탁방지(KYC/AML) | https://myinvestmentmarkets.com/kr/legal/kyc-aml |
| 주문 체결 정책 | https://myinvestmentmarkets.com/kr/legal/order-execution |
| 고객 포털 로그인 | https://client.myinvestmentmarkets.com/#/login |

## 7. 우리 전환 경로 (2026-09-03 사장님 확인, `public/config.js` 에 반영됨)

| 항목 | 값 | 주의 |
|---|---|---|
| **우리 IB 가입 링크** | `https://client.myinvestmentmarkets.com/#/login/LKXAQG` | 끝의 **`LKXAQG` 가 우리 IB 코드**다. 이게 빠져도 가입은 되지만 **우리 실적으로 집계되지 않는다** — 화면상 차이가 없어 사고를 알아채기 어렵다. copy-guard 6-B 가 코드 구간 존재를 검사한다 |
| **텔레그램 문의** | `https://t.me/icartsh_answer_bot` | 봇 계정이다. **봇은 사람이 먼저 `/start` 를 눌러야 응답이 열린다** — 응답 설정이 안 되어 있으면 문의가 그냥 사라진다 |

### 7-1. 포털 실제 동작 (2026-09-03, 실제 브라우저로 링크를 열어 확인)

- 링크를 열면 포털이 **`sessionStorage.referralCode = "LKXAQG"`** 를 심는다. → **IB 코드는 정상 작동한다.**
- 다만 저장 위치가 **sessionStorage** 다. 즉 **창(탭)을 닫으면 사라진다.**
  링크로 들어왔다가 나중에 주소를 직접 쳐서 가입하면 **우리 실적이 아니다.**
  → 그래서 `/signup` 1단계에 "링크를 타고 들어온 그 창에서 이어서 마치시라"고 적었다.
    (고객 비용은 달라지지 않는다는 점을 같이 적는다 — 숨기고 유도하면 그건 다른 종류의 글이 된다.)
- 첫 화면은 **가입·로그인 통합**이다. 휴대폰(**기본 국가번호 +82**) 또는 이메일 → 인증번호(Send Code),
  약관 동의 + "미국 시민이 아님" 확인 체크 2개.
- 포털 기본 언어는 **영어**. 우측 상단 언어 메뉴에 **한국어** 있음(그 외 中文-繁體).
- `#/register/...` 로 직접 들어가면 "로그인 세션이 갱신되었으니 다시 로그인하라"는 안내가 뜬다.
  → **가입 진입은 받은 `#/login/LKXAQG` 주소를 그대로 쓴다.** 우리가 주소를 재조립하지 않는다.

> 두 값 모두 `config.js` 에만 있다. HTML은 건드리지 않는다.
> 프리뷰(`deploy/config.preview.js`)에서는 일부러 비워 둔다 — 프리뷰 트래픽이 실적 집계를 흐리지 않게.

## 8. 아직 확인되지 않은 것 (페이지에 쓰지 않는다)

| 항목 | 왜 필요한가 | 지금 페이지의 처리 |
|---|---|---|
| 출금 처리 소요시간 공식 기준 | 체크포인트 ③의 핵심 수치 | "공식 고지 기준을 확인 중"이라고 쓰지 않고, **해당 문장 자체를 넣지 않았다** |
| 한국 거주자 대상 계좌 개설 제약 | 가입 안내의 전제 | 확인 전까지 "누구나 가능" 류의 문장을 쓰지 않는다 |
| MIM 파트너 계약서 원문의 마케팅 조항 | 이름·조건 표기 허용 범위의 최종 근거 | 지금은 **보수적으로** 간다 — 이름은 쓰되 조건 수치는 싣지 않음 (7절 결정) |
