/**
 * 리드 접수 엔드포인트 스모크 테스트.
 * 정상 케이스 1건 + 서버 검증이 실제로 막아야 하는 케이스들을 함께 친다.
 *
 * 사용: node scripts/smoke.mjs [baseUrl]
 */
const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");

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
