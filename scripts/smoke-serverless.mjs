/**
 * 서버리스 리드 엔드포인트(api/lead.js) 엔드투엔드 검사.
 *
 * 진짜 텔레그램 대신 가짜 API 서버를 띄워서, 실제로 나가는 HTTP 요청까지 확인한다.
 * 특히 확인하고 싶은 것은 "아무 데도 저장되지 않았는데 접수됐다고 답하지 않는가" 다 —
 * 서버리스에는 로컬 원장이 없어서 이게 무너지면 리드가 조용히 사라진다.
 *
 * 사용: node scripts/smoke-serverless.mjs
 */
import { createServer } from "node:http";

const PORT = 8899;

/* ------------------------------------------------------------------ */
/* 가짜 텔레그램 API                                                   */
/* ------------------------------------------------------------------ */

const sent = [];          // 봇이 보낸 sendMessage 본문들
let failSendMessage = false;
let updatesPayload = { ok: true, result: [{ message: { chat: { id: 987654321 } } }] };

/* 가짜 구글 시트(Apps Script) 웹앱. Apps Script 는 실패해도 HTTP 200 을 주므로
   본문만 갈아끼우면 실제 실패 모드가 그대로 재현된다. */
let sheetsMode = "ok";        // ok | rejected | html_login | http_500
const rows = [];              // 시트에 실제로 들어간 리드들

const telegram = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/sheets") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (sheetsMode === "http_500") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end("boom");
      }
      if (sheetsMode === "html_login") {
        // 액세스 권한을 "모든 사용자" 로 두지 않았을 때 구글이 주는 응답.
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<!DOCTYPE html><html><head><title>로그인</title></head></html>");
      }
      if (sheetsMode === "rejected") {
        // doPost 안에서 예외가 났을 때. 상태는 200 이다.
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"ok":false,"error":"Exception: 시트를 찾을 수 없습니다"}');
      }
      rows.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  if (url.pathname.endsWith("/getUpdates")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(updatesPayload));
  }

  if (url.pathname.endsWith("/sendMessage")) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (failSendMessage) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end('{"ok":false,"description":"simulated outage"}');
      }
      sent.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  res.writeHead(404).end("nope");
});

await new Promise((resolve) => telegram.listen(PORT, "127.0.0.1", resolve));

/* ------------------------------------------------------------------ */
/* 환경 — config.mjs 가 import 시점에 읽으므로 반드시 먼저 세팅한다.   */
/* ------------------------------------------------------------------ */

process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.TELEGRAM_BOT_TOKEN = "test-token-123";
process.env.TELEGRAM_CHAT_ID = "";        // 자동 탐색 경로를 태운다
process.env.SHEETS_WEBHOOK_URL = "";
process.env.NOTIFY_KIND = "none";
process.env.NOTIFY_WEBHOOK_URL = "";
process.env.RATE_MAX = "3";
process.env.RATE_WINDOW_MS = "600000";

const { default: handler } = await import("../api/lead.js");

/* ------------------------------------------------------------------ */
/* 테스트 도구                                                         */
/* ------------------------------------------------------------------ */

let pass = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function mockRes() {
  const r = { statusCode: 200, headers: {}, payload: null, ended: false };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.payload = b; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}

function call(body, { ip = "10.0.0.1", method = "POST" } = {}) {
  const req = {
    method,
    headers: { "x-forwarded-for": ip, "user-agent": "smoke-test/1.0" },
    body,
    socket: { remoteAddress: ip },
  };
  const res = mockRes();
  return handler(req, res).then(() => res);
}

const validLead = (over = {}) => ({
  name: "김테스트",
  contact: "010-5555-1234",
  experience: "입문",
  source: "네이버 블로그",
  consent: true,
  attribution: {
    utm: { utm_source: "naver_blog", utm_medium: "post", utm_campaign: "cost_calc" },
    referrer: "https://blog.naver.com/",
    landingPath: "/?utm_source=naver_blog",
  },
  page: "https://example.com/?utm_source=naver_blog",
  ...over,
});

/* ------------------------------------------------------------------ */

console.log("\n[1] 정상 리드 — chat_id 자동 탐색 + 텔레그램 발송");
{
  const res = await call(validLead(), { ip: "10.0.0.1" });
  check("HTTP 200", res.statusCode === 200, `got ${res.statusCode}`);
  check("ok:true + 리드 ID 발급", res.payload?.ok === true && Boolean(res.payload.id));
  check("텔레그램 1건 발송", sent.length === 1, `sent=${sent.length}`);

  const msg = sent[0];
  check("chat_id 자동 탐색 성공", String(msg?.chat_id) === "987654321", `chat_id=${msg?.chat_id}`);
  check("연락처 전체가 담김 (전화를 걸어야 하므로)", /010-5555-1234/.test(msg?.text || ""));
  check("이름 포함", /김테스트/.test(msg?.text || ""));
  check("utm 채널 포함", /naver_blog/.test(msg?.text || ""));
  check("사용자가 고른 유입 경로 포함", /네이버 블로그/.test(msg?.text || ""));
}

console.log("\n[2] 저장 실패 — 접수됐다고 답하면 안 된다");
{
  failSendMessage = true;
  const before = sent.length;
  const res = await call(validLead(), { ip: "10.0.0.2" });
  check("HTTP 503", res.statusCode === 503, `got ${res.statusCode}`);
  check("ok:false", res.payload?.ok === false);
  check("재시도 안내 문구", /다시 시도/.test(res.payload?.error || ""), res.payload?.error);
  check("발송된 메시지 없음", sent.length === before);
  failSendMessage = false;
}

console.log("\n[3] 검증 — 클라이언트를 믿지 않는다");
{
  const cases = [
    ["이름 누락", { name: "" }],
    ["연락처 형식 오류", { contact: "abc" }],
    ["거래 경험 값 위조", { experience: "전문가" }],
    ["유입 경로 값 위조", { source: "해킹" }],
    ["동의 없음", { consent: false }],
  ];
  // 레이트리밋이 검증보다 먼저 걸리므로 케이스마다 IP 를 달리한다.
  for (const [i, [label, over]] of cases.entries()) {
    const res = await call(validLead(over), { ip: `10.0.3.${i + 1}` });
    check(label + " → 400", res.statusCode === 400, `got ${res.statusCode}`);
  }
}

console.log("\n[4] 허니팟 — 봇에게는 실패를 알려주지 않는다");
{
  const before = sent.length;
  const res = await call(validLead({ company: "봇이 채운 값" }), { ip: "10.0.0.4" });
  check("HTTP 200 (성공한 척)", res.statusCode === 200, `got ${res.statusCode}`);
  check("id=skipped", res.payload?.id === "skipped");
  check("알림 안 나감", sent.length === before, `sent=${sent.length} before=${before}`);
}

console.log("\n[5] 레이트리밋 — 같은 IP 반복 제출");
{
  const ip = "10.0.0.5";
  const codes = [];
  for (let i = 0; i < 5; i += 1) {
    codes.push((await call(validLead(), { ip })).statusCode);
  }
  check("RATE_MAX=3 초과분은 429", codes.filter((c) => c === 429).length === 2, codes.join(","));
}

console.log("\n[6] 메서드 제한");
{
  const res = await call(validLead(), { ip: "10.0.0.6", method: "GET" });
  check("GET → 405", res.statusCode === 405, `got ${res.statusCode}`);
}

console.log("\n[7] chat_id 를 못 찾는 경우 — 조용히 성공하지 않는다");
{
  const { __testing } = await import("../server/sinks.mjs");
  __testing.resetChatIdCache();
  updatesPayload = { ok: true, result: [] };   // 아무도 봇에게 말을 건 적이 없다

  const res = await call(validLead(), { ip: "10.0.0.7" });
  check("HTTP 503", res.statusCode === 503, `got ${res.statusCode}`);
  check("ok:false", res.payload?.ok === false);
}

console.log("\n[8] 구글 시트만 붙은 경우 — 알림 없이 시트 하나로 접수가 성립하는가");
{
  // 텔레그램을 떼고 시트만 남긴다. 사장님이 알림을 나중에 붙이기로 하면 이 조합이
  // 유일한 기록 경로가 되므로, 여기서 무너지면 리드가 통째로 사라진다.
  const { config } = await import("../server/config.mjs");
  const savedToken = config.telegramBotToken;
  config.telegramBotToken = "";
  config.sheetsWebhookUrl = `http://127.0.0.1:${PORT}/sheets`;

  {
    sheetsMode = "ok";
    const res = await call(validLead(), { ip: "10.0.8.1" });
    check("시트 저장 성공 → HTTP 200", res.statusCode === 200, `got ${res.statusCode}`);
    check("시트에 1건 기록됨", rows.length === 1, `rows=${rows.length}`);
    check("연락처 원본이 그대로 전달됨", rows[0]?.contact === "010-5555-1234", rows[0]?.contact);
    check("utm 이 함께 전달됨", rows[0]?.attribution?.utm?.utm_source === "naver_blog");
  }

  {
    // Apps Script 는 doPost 가 터져도 200 을 준다. 상태 코드만 보면 성공으로 보인다.
    sheetsMode = "rejected";
    const before = rows.length;
    const res = await call(validLead(), { ip: "10.0.8.2" });
    check("웹앱이 ok:false → HTTP 503", res.statusCode === 503, `got ${res.statusCode}`);
    check("시트에 아무것도 안 들어감", rows.length === before);
  }

  {
    // 배포 액세스 권한을 "모든 사용자" 로 두지 않았을 때 가장 흔하게 나는 사고.
    sheetsMode = "html_login";
    const res = await call(validLead(), { ip: "10.0.8.3" });
    check("로그인 HTML 응답 → HTTP 503", res.statusCode === 503, `got ${res.statusCode}`);
    check("재시도 안내 문구", /다시 시도/.test(res.payload?.error || ""), res.payload?.error);
  }

  {
    sheetsMode = "http_500";
    const res = await call(validLead(), { ip: "10.0.8.4" });
    check("웹앱 5xx → HTTP 503", res.statusCode === 503, `got ${res.statusCode}`);
  }

  config.telegramBotToken = savedToken;
  config.sheetsWebhookUrl = "";
}

console.log("\n[9] 환경변수를 하나도 안 넣고 배포한 경우 — 갓 Import 한 Vercel 프로젝트의 상태");
{
  /* 리포를 Vercel 에 Import 하고 설정을 건드리지 않으면 정확히 이 상태가 된다:
     토큰도 시트 URL 도 없다. 페이지는 멀쩡히 떠 있는데 접수만 전부 거절된다.
     빈 껍데기를 라이브라고 착각하지 않도록, 이 경우의 문구는 "일시적인 문제"가
     아니라 "설정이 완료되지 않았습니다" 여야 한다 — 재시도해도 소용없기 때문이다. */
  const { config } = await import("../server/config.mjs");
  const savedToken = config.telegramBotToken;
  config.telegramBotToken = "";
  config.sheetsWebhookUrl = "";

  const before = sent.length;
  const res = await call(validLead(), { ip: "10.0.9.1" });
  check("HTTP 503 — 조용히 접수된 척하지 않는다", res.statusCode === 503, `got ${res.statusCode}`);
  check("ok:false", res.payload?.ok === false);
  check(
    "'설정이 완료되지 않았습니다' — 재시도 안내가 아니다",
    /설정이 완료되지 않았습니다/.test(res.payload?.error || ""),
    res.payload?.error
  );
  check("바깥으로 나간 요청 없음", sent.length === before, `sent=${sent.length}`);

  config.telegramBotToken = savedToken;
}

/* ------------------------------------------------------------------ */

telegram.close();

console.log(`\n${"-".repeat(60)}`);
if (failures.length) {
  console.error(`실패 ${failures.length}건:\n` + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`PASS  ${pass}개 검사 통과 — 서버리스 리드 접수 경로 정상`);
