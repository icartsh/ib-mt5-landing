/**
 * 리드 접수 엔드포인트 스모크 테스트.
 * 정상 케이스 1건 + 서버 검증이 실제로 막아야 하는 케이스들을 함께 친다.
 *
 * 먼저 `npm start` 로 서버를 띄워 두고 돌린다.
 *
 * 사용: node scripts/smoke.mjs [baseUrl]
 */
import { config } from "../server/config.mjs";

/* 주소를 안 주면 .env 의 PORT/HOST 를 따라간다. 예전에는 8787 을 박아 두었는데
   .env 는 8791 이라, 서버는 멀쩡한데 검사만 전부 404 로 떨어졌다. 그 404 는 우리
   서버가 아니라 그 포트에 있던 다른 프로세스가 준 응답이었다 — 원인을 찾는 데
   시간이 드는 종류의 실패라 기본값이 한 곳을 보게 맞춘다. */
const base = (process.argv[2] || `http://${config.host}:${config.port}`).replace(/\/$/, "");

const validLead = {
  name: "테스트리드",
  contact: "010-1234-5678",
  experience: "입문",
  source: "네이버 블로그",
  consent: true,
  attribution: {
    utm: {
      utm_source: "naver_blog",
      utm_medium: "post",
      utm_campaign: "cost_guide",
      utm_content: "smoke_test",
    },
    referrer: "https://blog.naver.com/example/1",
    landingPath: "/?utm_source=naver_blog&utm_medium=post&utm_campaign=cost_guide",
  },
  page: `${base}/?utm_source=naver_blog&utm_medium=post&utm_campaign=cost_guide`,
};

const cases = [
  { label: "정상 리드 접수", body: validLead, expect: 200, expectOk: true },
  { label: "동의 없음 거부", body: { ...validLead, consent: false }, expect: 400 },
  { label: "연락처 형식 거부", body: { ...validLead, contact: "abc" }, expect: 400 },
  { label: "이름 누락 거부", body: { ...validLead, name: "" }, expect: 400 },
  { label: "허용되지 않은 경험값 거부", body: { ...validLead, experience: "전문가" }, expect: 400 },
  { label: "허니팟(봇) 무시", body: { ...validLead, company: "bot-filled" }, expect: 200, expectSkipped: true },
];

let failed = 0;

for (const c of cases) {
  const res = await fetch(`${base}/api/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(c.body),
  });
  const body = await res.json().catch(() => ({}));

  let pass = res.status === c.expect;
  if (pass && c.expectOk) pass = body.ok === true && body.id && body.id !== "skipped";
  if (pass && c.expectSkipped) pass = body.id === "skipped";

  if (!pass) failed++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${c.label}  → HTTP ${res.status} ${JSON.stringify(body)}`
  );
}

console.log(failed ? `\n${failed}건 실패` : "\n전부 통과");
process.exit(failed ? 1 : 0);
