# IB 전환 추적 지표·이벤트 정의

## 원칙

- 집계 시간대는 `Asia/Seoul`, 주간은 월요일 00:00부터 일요일 23:59:59까지다.
- 단계 수치는 해당 기간에 각 단계에 **최초 도달한 고유 식별자 수**다. 재시도·상태 왕복은 중복 집계하지 않는다.
- 대시보드에는 이름, 연락처, 계좌번호 등 개인 식별 정보를 보내지 않는다.
- `is_test=true` 또는 `utm_source=internal`은 운영 KPI에서 제외한다.
- 모든 전환은 신청 때 서버가 만든 `lead_id`로 연결한다. 방문 전에는 난수 `anonymous_id`만 쓴다.

## 퍼널과 측정 위치

| 단계 | 발생 조건 | 시각 | 원천/집계 키 |
|---|---|---|---|
| 유입 | 랜딩 페이지가 로드되고 봇 필터를 통과 | 최초 `landing_view` 서버 수신 시 | 웹 이벤트, `anonymous_id` |
| 신청 | 서버 검증과 영구 저장이 성공 | `lead_submitted`의 `occurred_at` | 리드 DB, `lead_id` |
| 상담 | 담당자가 실제 통화 연결을 `connected`로 기록 | CRM 상태 최초 변경 시 | CRM, `lead_id` |
| 계좌 개설 | 브로커/운영 확인 상태가 `opened` | 최초 확인 시 | 운영/CRM, `lead_id` |
| 첫 입금 | 첫 입금 완료가 확인됨(금액은 분석 테이블에 저장하지 않음) | 최초 확인 시 | 운영/CRM, `lead_id` |

`신청률=신청/유입`, `상담률=상담/신청`, `개설률=계좌 개설/상담`, `입금률=첫 입금/계좌 개설`이다. 분모가 0이면 `—`로 표시한다. 단계별 코호트가 아니라 **해당 주 발생량**을 기본 화면으로 사용하므로 전주 신청자가 이번 주 상담되면 서로 다른 주에 잡힌다.

## 웹·리드 이벤트 스펙

공통 필드:

```json
{
  "event_name": "landing_view | lead_submitted | consultation_connected | account_opened | first_deposit",
  "event_id": "uuid",
  "occurred_at": "ISO-8601 UTC",
  "anonymous_id": "browser random id",
  "lead_id": "server-generated id; landing_view에는 null",
  "utm_source": "lower_snake_case",
  "utm_medium": "lower_snake_case",
  "utm_campaign": "lower_snake_case",
  "utm_content": "lower_snake_case",
  "utm_term": "lower_snake_case or empty",
  "landing_path": "/path only; query의 개인정보는 제거",
  "is_test": false
}
```

- 웹은 현재 `sessionStorage` first-touch UTM을 유지한다. 신청 API는 이를 받아 리드 레코드의 `attribution.utm`에 저장한다.
- `lead_submitted`는 클라이언트 클릭 시점이 아니라 서버 저장 성공 뒤 한 번만 기록한다. `event_id` 또는 `lead_id + event_name`에 unique 제약을 둔다.
- `landing_view` API를 추가할 때 IP와 전체 user-agent는 대시보드 원천에 보존하지 않는다. 봇 필터용 단기 로그와 분석 이벤트를 분리한다.
- 상담 이후 세 이벤트는 담당자가 `lead_id`를 선택해 상태를 변경할 때 서버가 기록한다. 브라우저가 임의로 전송하지 않는다.
- 기존 Google Sheets 리드 헤더에는 `utm_term`, `landing_path`, `is_test`, `anonymous_id`가 없다. 실제 자동 집계 전 이 열을 추가하거나 별도 `events` 시트를 사용한다.

## 대시보드 입력 스키마

대시보드는 이벤트 원본이 아니라 아래 비식별 집계 CSV를 읽는다.

```text
week_start,utm_source,utm_medium,utm_campaign,utm_content,utm_term,is_test,visits,applications,consultations,accounts_opened,first_deposits
```

그룹 키는 `week_start + 5개 UTM + is_test`다. UTM이 없으면 각각 `(direct)`, `(none)`, `(not set)`으로 정규화한다. 숫자는 0 이상의 정수여야 한다. CSV 값에는 쉼표를 쓰지 않는다.

## 데이터 품질 점검

- 일별: 동일 `event_id`, 단계 역전(예: 신청 없이 상담), 미래 시각, 허용 사전 밖 UTM을 격리한다.
- 주별: `신청 > 유입` 또는 후속 단계가 직전 단계보다 큰 집계행을 확인한다. 주간 발생량 화면에서는 시차로 가능하므로 자동 삭제하지 않는다.
- UTM 누락률과 `source` 자기응답 불일치율을 별도 기록한다.
- 테스트 리드는 `utm_source=internal`, `utm_medium=test`, `utm_campaign=qa`, `is_test=true`를 모두 사용한다.

## 현재 구현과 엔지니어 핸드오프

현재 코드에서 신청·UTM·`lead_id` 저장은 구현돼 있다. 남은 구현은 (1) `landing_view` 수집, (2) `anonymous_id`를 신청에 전달, (3) 상담/계좌/입금 상태 이벤트 저장, (4) 주간 집계 CSV 자동 생성이다. 그 전에는 운영자가 비식별 집계 CSV를 수동 작성해 대시보드에 넣을 수 있다.
