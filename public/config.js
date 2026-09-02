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

  /** 카카오톡 오픈채팅 / 1:1 채널 주소. 확정 전에는 비워 둔다 (버튼이 자동으로 숨는다). */
  kakaoUrl: "",

  /** 푸터 표기. 사업자 정보 확정 후 채운다. */
  brandName: "",
  brandContact: "",
};
