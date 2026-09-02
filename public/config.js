/**
 * 배포 환경별 설정. 이 파일만 바꾸면 정적 호스팅(GitHub Pages 등)에서도
 * 리드 수집 서버 주소를 갈아끼울 수 있다. 빌드 과정 없음 — 그냥 값만 고친다.
 */
window.IB_CONFIG = {
  /**
   * 리드를 받는 API 주소.
   * - 같은 서버에서 서빙할 때: "/api/lead"
   * - 정적 호스팅 + 별도 API 서버: "https://api.example.com/api/lead"
   * - 빈 문자열이면 폼은 '프리뷰 모드'로 동작한다 (저장하지 않고 사용자에게 그렇게 안내함).
   */
  leadEndpoint: "/api/lead",

  /**
   * 우리 IB 코드가 붙은 MIM 가입 링크. (IB-10)
   * 비워 두면 가입 버튼이 뜨지 않고, 그 자리를 1:1 상담 신청이 대신한다 —
   * IB 코드 없는 링크를 내보내면 우리를 통한 가입으로 집계되지 않아 그냥 손해다.
   * 값이 들어오는 순간 broker/signup 페이지의 모든 가입 버튼이 한꺼번에 살아난다.
   *
   * 주소 끝의 `LKXAQG` 가 우리 IB 코드다. **이 문자열이 빠지면 가입은 되지만 우리 실적으로
   * 잡히지 않는다** — 화면상 아무 차이가 없어서 사고가 나도 알아채기 어렵다.
   * 주소를 손볼 일이 생기면 코드가 그대로인지 먼저 확인할 것. (해시 라우팅이라
   * links.js 는 이 주소에 utm 을 붙이지 않고 원본 그대로 내보낸다.)
   */
  mimSignupUrl: "https://client.myinvestmentmarkets.com/#/login/LKXAQG",

  /**
   * 텔레그램 문의 봇 주소 (예: "https://t.me/xxxx").
   * 비워 두면 텔레그램 버튼 자체가 렌더링되지 않는다. 죽은 링크를 내보내지 않기 위해서다.
   *
   * **여기에는 반드시 문의 전용 봇(TELEGRAM_INQUIRY_BOT_TOKEN)만 적는다.**
   * 리드 알림을 받는 봇(@icartsh_answer_bot)을 적으면 고객이 그 봇에 말을 걸게 되고,
   * 알림 목적지 자동 탐색이 고객을 고를 수 있어 신청자의 이름과 전체 전화번호가
   * 낯선 사람에게 갈 수 있다. 서버 쪽에 잠금을 걸어 두었지만(server/sinks.mjs),
   * 그 잠금이 걸리면 리드 접수 자체가 멈춘다 — 애초에 섞지 않는 것이 맞다.
   * copy-guard 6-B 가 이 실수를 검사한다.
   *
   * 이 봇에 온 문의는 /api/telegram 이 받아서 사장님 대화로 옮긴다. webhook 이
   * 등록돼 있지 않으면 버튼은 살아 있는데 그 끝은 비어 있다:
   *   npm run telegram -- status
   */
  telegramUrl: "https://t.me/icartsh_ib_bot",

  /** 푸터 표기. 사업자 정보 확정 후 채운다. */
  brandName: "",
  brandContact: "",
};
