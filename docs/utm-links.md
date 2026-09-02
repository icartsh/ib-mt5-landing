# 채널별 utm 링크 목록

랜딩페이지로 보내는 **모든 링크는 반드시 이 문서의 형식**을 따른다.
utm 없이 뿌린 링크는 어느 채널에서 온 리드인지 영원히 알 수 없다 — 나중에 복구가 안 된다.

---

## 0. 규칙 (먼저 읽을 것)

| 파라미터 | 뜻 | 값 규칙 |
|---|---|---|
| `utm_source` | **어디서** 왔나 (플랫폼) | 소문자·언더스코어. 아래 표의 값만 사용 |
| `utm_medium` | **어떤 형식**으로 왔나 | 소문자·언더스코어. 아래 표의 값만 사용 |
| `utm_campaign` | **무슨 주제**의 캠페인인가 | 소문자·언더스코어. 주제 단위로 하나 |
| `utm_content` | 같은 캠페인 안에서 **어느 소재**인가 | 개별 글·영상·소재 식별자 |

**지켜야 할 것**

1. **대소문자를 섞지 않는다.** `Instagram` 과 `instagram` 은 다른 채널로 집계된다.
2. **한글·공백을 넣지 않는다.** 인코딩이 깨지고 집계가 갈린다.
3. `utm_content` 는 **소재 하나당 하나**를 새로 만든다. 어떤 글이 리드를 만들었는지 여기서 갈린다.
4. 링크를 새로 만들면 **이 문서에 한 줄 추가**한다. 문서에 없는 링크는 뿌리지 않는다.
5. 단축 URL(비틀리·네이버 단축)을 써도 **원본에 utm 이 붙어 있어야** 한다. 단축이 utm 을 대신하지 않는다.

**베이스 URL** — 1절의 링크는 아래 주소로 이미 완성돼 있다. 그대로 복사해서 쓴다.

```
https://ib-mt5-landing.vercel.app
```

| 상태 | 주소 | 신청 접수 |
|---|---|---|
| 라이브 (배포됨) | `https://ib-mt5-landing.vercel.app` | 아래 **배포 게이트** 참조 |
| 이전 프리뷰 | `https://icartsh.github.io/ib-mt5-landing` | **안 됨** — 프리뷰 배너가 뜬다. 이제 쓰지 않는다 |
| 자체 도메인 이전 시 | 미정 | 옮길 때 이 문서를 한 번 더 일괄 교체 |

> Vercel 이 자동으로 만드는 **배포별 주소**(`ib-mt5-landing-<해시>-….vercel.app`)는
> 접근 보호가 걸려 있어 외부인이 열면 로그인 화면이 뜬다. 링크로 뿌릴 주소는
> 위의 `ib-mt5-landing.vercel.app` **하나뿐**이다.

### 배포 게이트 — 링크를 뿌리기 전에 반드시 통과할 것

페이지는 떠 있지만, **접수 채널(텔레그램/시트)이 붙기 전까지 신청은 접수되지 않는다.**
이 상태로 링크를 뿌리면 유입은 생기는데 리드는 한 건도 안 남는다 — 나중에 복구가 안 된다.

아래 명령이 `{"ok":true,...}` 를 돌려줄 때부터 배포를 시작한다.

```bash
curl -s -X POST https://ib-mt5-landing.vercel.app/api/lead \
  -H 'Content-Type: application/json' \
  -d '{"name":"게이트확인","contact":"010-0000-0000","experience":"입문",
       "source":"기타","consent":true,
       "utm":{"utm_source":"internal","utm_medium":"test","utm_campaign":"qa"}}'
```

- `{"ok":true,"id":"…"}` → **통과.** 링크 배포 시작. (이 확인 리드 1건은 알림으로 도착하니 무시하면 된다.)
- `접수 설정이 완료되지 않았습니다` → **아직.** 접수 채널이 안 붙었다. 뿌리지 않는다.

---

## 1. 채널별 링크 표

### 네이버 블로그

| 용도 | utm_content | 링크 |
|---|---|---|
| 비용 구조 글 (본문 하단 CTA) | `post_cost_structure` | `https://ib-mt5-landing.vercel.app/?utm_source=naver_blog&utm_medium=post&utm_campaign=cost_guide&utm_content=post_cost_structure` |
| 증거금 글 (본문 하단 CTA) | `post_margin` | `https://ib-mt5-landing.vercel.app/?utm_source=naver_blog&utm_medium=post&utm_campaign=cost_guide&utm_content=post_margin` |
| 마이크로 계약 글 (본문 하단 CTA) | `post_micro` | `https://ib-mt5-landing.vercel.app/?utm_source=naver_blog&utm_medium=post&utm_campaign=cost_guide&utm_content=post_micro` |
| 블로그 프로필/위젯 상시 링크 | `profile` | `https://ib-mt5-landing.vercel.app/?utm_source=naver_blog&utm_medium=profile&utm_campaign=always_on&utm_content=profile` |

> 글이 늘어나면 `utm_content` 만 새로 만든다. `utm_source`·`utm_medium` 은 고정.

### 인스타그램

| 용도 | utm_content | 링크 |
|---|---|---|
| 프로필 링크(bio) — 상시 | `bio` | `https://ib-mt5-landing.vercel.app/?utm_source=instagram&utm_medium=bio&utm_campaign=always_on&utm_content=bio` |
| 스토리 스와이프업/링크 스티커 | `story_{날짜}` | `https://ib-mt5-landing.vercel.app/?utm_source=instagram&utm_medium=story&utm_campaign=cost_guide&utm_content=story_20260910` |
| 릴스 캡션 링크 | `reels_{소재명}` | `https://ib-mt5-landing.vercel.app/?utm_source=instagram&utm_medium=reels&utm_campaign=cost_guide&utm_content=reels_margin` |
| 피드 게시물 캡션 | `feed_{소재명}` | `https://ib-mt5-landing.vercel.app/?utm_source=instagram&utm_medium=feed&utm_campaign=cost_guide&utm_content=feed_cost` |

### 유튜브

| 용도 | utm_content | 링크 |
|---|---|---|
| 영상 설명란 (일반 영상) | `desc_{영상슬러그}` | `https://ib-mt5-landing.vercel.app/?utm_source=youtube&utm_medium=description&utm_campaign=cost_guide&utm_content=desc_cost_structure` |
| 쇼츠 설명란 | `shorts_{영상슬러그}` | `https://ib-mt5-landing.vercel.app/?utm_source=youtube&utm_medium=shorts&utm_campaign=cost_guide&utm_content=shorts_micro` |
| 고정 댓글 | `pinned_{영상슬러그}` | `https://ib-mt5-landing.vercel.app/?utm_source=youtube&utm_medium=pinned_comment&utm_campaign=cost_guide&utm_content=pinned_cost_structure` |
| 채널 배너/정보 링크 — 상시 | `channel` | `https://ib-mt5-landing.vercel.app/?utm_source=youtube&utm_medium=channel&utm_campaign=always_on&utm_content=channel` |

### 카카오톡 (공유 경로)

**상담 채널로서의 카카오는 없다** (사장님 확정, 2026-09-02 — 상담은 전화 콜백 한 가지).
오픈채팅·1:1 채널 링크는 존재하지 않으므로 쓰지 않는다.

다만 카톡으로 **링크를 보내는 것**은 여전히 유효한 유입 경로다. 개인 대화나 단톡방에
페이지 주소를 붙여 넣을 때 아래를 쓴다.

| 용도 | utm_content | 링크 |
|---|---|---|
| 개인 대화로 공유 | `dm` | `https://ib-mt5-landing.vercel.app/?utm_source=kakao&utm_medium=share&utm_campaign=always_on&utm_content=dm` |
| 단톡방에 공유 | `group` | `https://ib-mt5-landing.vercel.app/?utm_source=kakao&utm_medium=share&utm_campaign=always_on&utm_content=group` |

### 네이버 지식iN / 카페

| 용도 | utm_content | 링크 |
|---|---|---|
| 지식iN 답변 내 링크 | `kin_{주제}` | `https://ib-mt5-landing.vercel.app/?utm_source=naver_kin&utm_medium=answer&utm_campaign=cost_guide&utm_content=kin_margin` |
| 카페 글 | `cafe_{주제}` | `https://ib-mt5-landing.vercel.app/?utm_source=naver_cafe&utm_medium=post&utm_campaign=cost_guide&utm_content=cafe_cost` |

> 지식iN·카페는 플랫폼 정책상 링크·홍보가 제재 대상이 될 수 있다.
> 뿌리기 전에 각 플랫폼 운영정책을 확인하고, 광고 표현 가이드라인(IB-6)을 함께 본다.

### 기타

| 용도 | utm_content | 링크 |
|---|---|---|
| 지인 소개·오프라인 (QR 포함) | `referral` | `https://ib-mt5-landing.vercel.app/?utm_source=referral&utm_medium=direct&utm_campaign=always_on&utm_content=referral` |
| 내부 테스트 | `internal_test` | `https://ib-mt5-landing.vercel.app/?utm_source=internal&utm_medium=test&utm_campaign=qa&utm_content=internal_test` |

> **유료 광고 링크는 이 문서에 아직 넣지 않는다.**
> 광고 표현 가이드라인(IB-6)에 따라 유료 광고 집행 전 사용자 확인과 법률 검토가 선행돼야 한다.

---

## 2. 값 사전 (허용 값만 사용)

**utm_source** · `naver_blog` `instagram` `youtube` `kakao` `naver_kin` `naver_cafe` `referral` `internal`

**utm_medium** · `post` `profile` `bio` `story` `reels` `feed` `description` `shorts` `pinned_comment` `channel` `openchat` `channel_message` `answer` `direct` `test`

**utm_campaign** · `cost_guide` (비용 구조 주제) · `always_on` (상시 링크) · `qa` (내부 테스트)

---

## 3. 이 값들이 어디에 저장되나

폼 제출 시 아래가 리드 레코드에 함께 저장된다. 별도 작업 없이 자동이다.

- `attribution.utm` — 위 4개 파라미터 (+ `utm_term`)
- `attribution.referrer` — 직전 페이지 주소
- `attribution.landingPath` — 처음 도착한 경로
- `source` — 사용자가 폼에서 **직접 고른** 유입 경로

`utm` 과 `source` 를 **둘 다** 본다. utm 은 링크가 알려주는 사실이고,
`source` 는 사용자가 기억하는 경로다. 둘이 어긋나는 케이스(예: 유튜브로 알고 검색으로 들어옴)가
실제 채널 기여도를 읽는 단서가 된다.

**세션 내 first-touch 유지** — utm 이 붙은 링크로 들어온 뒤 새로고침하거나 페이지를 옮겨도
최초 유입 정보가 `sessionStorage` 에 남아 폼 제출까지 따라간다.
단, utm 이 붙은 다른 링크로 새로 들어오면 그 값이 최신 유입으로 갱신된다.

---

## 4. 링크 만들 때 쓰는 체크리스트

- [ ] 위의 **배포 게이트**를 통과했는가 (접수가 `ok:true` 인가)
- [ ] 주소가 `https://ib-mt5-landing.vercel.app` 인가 (배포별 해시 주소가 아닌가)
- [ ] `utm_source` / `utm_medium` 이 2절 사전에 있는 값인가
- [ ] `utm_content` 가 이 소재 전용으로 새로 만든 값인가
- [ ] 이 문서 표에 한 줄 추가했는가
- [ ] 실제로 클릭해서 랜딩이 열리고, 폼 제출 후 리드에 utm 이 찍히는지 확인했는가
