/**
 * GitHub Pages(정적 호스팅) 배포 전용 설정.
 * 리드 수집 서버가 아직 없으므로 leadEndpoint 를 비워 둔다 —
 * 페이지가 스스로 '프리뷰' 배너를 띄우고, 신청을 접수하지 않는다고 안내한다.
 * 호스팅·저장소·알림 채널이 확정되면 leadEndpoint 에 API 주소를 넣는 것으로 라이브 전환된다.
 *
 * mimSignupUrl·telegramUrl 도 프리뷰에서는 비운다. 프리뷰 주소는 배포용이 아니므로
 * 여기서 나간 가입 링크는 유입 집계가 어긋나기만 한다.
 */
window.IB_CONFIG = {
  leadEndpoint: "",
  mimSignupUrl: "",
  telegramUrl: "",
  brandName: "",
  brandContact: "",
};
