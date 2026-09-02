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

  /* 문의 봇의 @이름을 /api/health 가 보고한다. 페이지 버튼이 "우리가 읽지 않는 봇" 을
     가리키고 있는지 배포 뒤에 확인할 수 있는 유일한 값이라 여기서도 흉내 낸다. */
  if (url.pathname.endsWith("/getMe")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end('{"ok":true,"result":{"username":"icartsh_answer_bot"}}');
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

console.log("\n[7] 토큰은 넣었는데 봇에게 /start 를 안 보낸 경우");
{
  /* 라이브에서 실제로 만들어지는 상태다. 토큰을 환경변수에 넣고 배포까지 끝냈지만
     운영자가 아직 /start 를 누르지 않았다면 chat_id 를 찾을 수 없다.

     여기서 '설정은 되어 있다' 를 근거로 "잠시 후 다시 시도해 주세요" 를 내보내면
     안 된다. 운영자가 /start 를 누르기 전까지 신청자는 몇 번을 눌러도 같은 화면을
     본다. 문구까지 검사하지 않으면 이 조합이 조용히 되살아난다. */
  const { __testing } = await import("../server/sinks.mjs");
  __testing.resetChatIdCache();
  updatesPayload = { ok: true, result: [] };   // 아무도 봇에게 말을 건 적이 없다

  const before = sent.length;
  const res = await call(validLead(), { ip: "10.0.0.7" });
  check("HTTP 503", res.statusCode === 503, `got ${res.statusCode}`);
  check("ok:false", res.payload?.ok === false);
  check(
    "'설정이 완료되지 않았습니다' 라고 말한다",
    /설정이 완료되지 않았습니다/.test(res.payload?.error || ""),
    res.payload?.error
  );
  check(
    "재시도 안내를 붙이지 않는다 — /start 전까지 결과가 같다",
    !/다시 시도/.test(res.payload?.error || ""),
    res.payload?.error
  );
  check("메시지 발송 시도 없음", sent.length === before, `sent=${sent.length}`);
}

console.log("\n[7-b] 알림 봇에 대화가 둘 이상 — 남의 전화번호를 낯선 사람에게 보내지 않는다");
{
  /* IB-10 에서 실제로 만들 뻔한 상태다. 알림 봇 주소를 페이지에 걸면 고객이 그 봇에
     말을 걸고, '가장 최근 대화' 규칙은 그 고객을 목적지로 고른다. 그 다음 리드 알림에는
     신청자의 이름과 전체 전화번호가 그대로 들어 있다(full: true). 시트가 꺼져 있으면
     그게 유일한 사본이라 운영자는 그런 리드가 있었다는 것조차 모른다.

     그래서 후보가 둘 이상이면 고르지 않고 실패해야 한다. 리드 한 건을 잃는 쪽이
     남의 번호가 새는 쪽보다 낫다 — 잃은 리드는 보이지만 새어 나간 번호는 안 보인다. */
  const { __testing } = await import("../server/sinks.mjs");
  __testing.resetChatIdCache();
  updatesPayload = {
    ok: true,
    result: [
      { message: { chat: { id: 987654321 } } },   // 운영자
      { message: { chat: { id: 111222333 } } },   // 페이지 보고 들어온 고객
    ],
  };

  const before = sent.length;
  const res = await call(validLead(), { ip: "10.0.0.71" });

  check("아무에게도 보내지 않는다", sent.length === before, `sent=${sent.length}`);
  check("접수를 성공으로 답하지 않는다", res.payload?.ok !== true, JSON.stringify(res.payload));
  check(
    "재시도 안내를 붙이지 않는다 — 운영자가 고쳐야 풀린다",
    !/다시 시도/.test(res.payload?.error || ""),
    res.payload?.error
  );

  /* 목적지를 고정하면 같은 상황에서도 정상 발송된다 — 이것이 유일한 해소 방법이다. */
  const { config } = await import("../server/config.mjs");
  config.telegramChatId = "987654321";
  __testing.resetChatIdCache();
  const fixed = await call(validLead(), { ip: "10.0.0.72" });
  config.telegramChatId = "";
  __testing.resetChatIdCache();

  check("TELEGRAM_CHAT_ID 를 고정하면 정상 접수된다", fixed.payload?.ok === true, JSON.stringify(fixed.payload));
  check(
    "고정된 목적지로만 간다",
    String(sent[sent.length - 1]?.chat_id) === "987654321",
    String(sent[sent.length - 1]?.chat_id)
  );

  updatesPayload = { ok: true, result: [{ message: { chat: { id: 987654321 } } }] };
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
    /* 액세스 권한을 고치기 전까지는 계속 로그인 페이지가 온다 — 재시도 대상이 아니다. */
    check(
      "권한 오류에는 재시도를 권하지 않는다",
      !/다시 시도/.test(res.payload?.error || ""),
      res.payload?.error
    );
  }

  {
    // 반대로 5xx 는 구글 쪽 사정이라 기다리면 풀린다 — 이때는 재시도가 맞는 안내다.
    sheetsMode = "http_500";
    const res = await call(validLead(), { ip: "10.0.8.4" });
    check("웹앱 5xx → HTTP 503", res.statusCode === 503, `got ${res.statusCode}`);
    check(
      "일시적 장애에는 재시도를 권한다",
      /다시 시도/.test(res.payload?.error || ""),
      res.payload?.error
    );
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
    "'설정이 완료되지 않았습니다' 라고 말한다",
    /설정이 완료되지 않았습니다/.test(res.payload?.error || ""),
    res.payload?.error
  );
  /* 문구에 '다시 시도' 가 들어가면 검사는 통과하면서 사용자는 재시도를 반복한다.
     여기서 부재를 직접 못 박아야 그 조합이 다시 생기지 않는다. */
  check(
    "재시도 안내를 붙이지 않는다 — 눌러도 결과가 같다",
    !/다시 시도/.test(res.payload?.error || ""),
    res.payload?.error
  );
  check("바깥으로 나간 요청 없음", sent.length === before, `sent=${sent.length}`);

  config.telegramBotToken = savedToken;
}

console.log("\n[10] /api/health — 리드를 만들지 않고 배포 게이트를 판정한다");
{
  /* 확인용으로 가짜 신청을 넣던 방식은 확인할 때마다 운영자 휴대폰에 가짜 리드를
     남겼다. 여기서 검사하는 것은 두 가지다: 부작용 없이 판정하는가, 그리고
     접수가 막힌 이유를 운영자에게 구분해서 알려주는가. */
  const { default: health, __testing: healthTesting } = await import("../api/health.js");
  const { config } = await import("../server/config.mjs");
  const { __testing } = await import("../server/sinks.mjs");

  const callHealth = async (method = "GET") => {
    const res = mockRes();
    await health({ method, headers: {} }, res);
    return res;
  };

  {
    // 토큰은 있는데 /start 가 없는 상태 — 지금 라이브가 정확히 여기다.
    __testing.resetChatIdCache();
    healthTesting.resetCache();
    updatesPayload = { ok: true, result: [] };
    const before = sent.length;
    const res = await callHealth();
    check("HTTP 200", res.statusCode === 200, `got ${res.statusCode}`);
    check("accepting:false — 링크를 뿌리면 안 되는 상태", res.payload?.accepting === false);
    check("텔레그램은 '설정됨'으로 나온다", res.payload?.sinks?.telegram?.configured === true);
    check("다만 ready:false", res.payload?.sinks?.telegram?.ready === false);
    check(
      "다음 할 일로 /start 를 지목한다",
      /\/start/.test(res.payload?.nextAction || ""),
      res.payload?.nextAction
    );
    check("리드를 만들지 않는다 — 발송 0건", sent.length === before, `sent=${sent.length}`);
  }

  {
    // /start 를 보낸 뒤. 같은 주소가 통과로 뒤집혀야 한다.
    __testing.resetChatIdCache();
    healthTesting.resetCache();
    updatesPayload = { ok: true, result: [{ message: { chat: { id: 987654321 } } }] };
    const res = await callHealth();
    check("/start 이후 accepting:true 로 뒤집힌다", res.payload?.accepting === true);
    check(
      "chat_id 같은 비밀값을 내보내지 않는다",
      !JSON.stringify(res.payload).includes("987654321"),
      JSON.stringify(res.payload)
    );

    /* 자동 탐색으로 통과한 상태다. 접수는 되지만 이 봇에 다른 대화가 하나만 생겨도
       접수가 멈춘다(위 [7-b]). 통과 여부와 별개로 그 사실이 보여야 손을 쓸 수 있다. */
    check("목적지가 자동 탐색임을 밝힌다", res.payload?.sinks?.telegram?.destination === "auto",
      res.payload?.sinks?.telegram?.destination);
    check("고정을 권한다", /고정/.test(res.payload?.nextAction || ""), res.payload?.nextAction);

    /* 고정하면 같은 자리에서 평범한 통과 문구로 돌아온다. */
    healthTesting.resetCache();
    config.telegramChatId = "987654321";
    const pinned = await callHealth();
    config.telegramChatId = "";
    healthTesting.resetCache();
    check("고정하면 destination:pinned", pinned.payload?.sinks?.telegram?.destination === "pinned");
    check("고정하면 게이트 통과 문구", /뿌려도 된다/.test(pinned.payload?.nextAction || ""), pinned.payload?.nextAction);
  }

  {
    /* 문의 중계 상태도 같이 보고한다. 이게 안 보이면 페이지의 텔레그램 버튼은 살아 있는데
       그 끝이 비어 있는 상태를 배포 전에 알아챌 방법이 없다. */
    __testing.resetChatIdCache();
    healthTesting.resetCache();
    const res = await callHealth();
    check("문의 중계 상태를 보고한다", res.payload?.sinks?.inquiry !== undefined);
    check("문의 봇 미설정이면 ready:false", res.payload?.sinks?.inquiry?.ready === false);

    /* 여기는 알림 봇 토큰은 있는데 chat_id 가 비어 있는 상태다. 남은 할 일이
       "새 봇 토큰을 받아 온다" 가 아니라 "목적지를 고정한다" 라는 것이 보여야 한다 —
       전자는 @BotFather 를 열어야 하고 후자는 이미 가진 값으로 끝난다. */
    check(
      "이유를 말한다 — chat_id 를 고정하면 알림 봇을 같이 쓸 수 있다",
      /TELEGRAM_CHAT_ID/.test(res.payload?.sinks?.inquiry?.detail || ""),
      res.payload?.sinks?.inquiry?.detail
    );

    /* 토큰이 하나도 없을 때만 "아무도 읽지 않는다" 다. 이 문구는 새 봇을 받아 와야
       한다는 뜻이라, 위 상태와 섞이면 안 하려도 되는 일을 하게 만든다. */
    healthTesting.resetCache();
    const savedAlertToken = config.telegramBotToken;
    config.telegramBotToken = "";
    const noBot = await callHealth();
    config.telegramBotToken = savedAlertToken;
    healthTesting.resetCache();
    check(
      "봇이 아예 없을 때만 '아무도 읽지 않는다'",
      /아무도 읽지 않는다/.test(noBot.payload?.sinks?.inquiry?.detail || ""),
      noBot.payload?.sinks?.inquiry?.detail
    );
  }

  {
    /* 전용 문의 봇 토큰이 없어도, chat_id 가 박혀 있으면 알림 봇을 같이 써서 문의를 받는다.
       봇을 나누는 이유는 목적지 자동 탐색이 고객을 고르는 사고 하나뿐인데, 목적지가
       고정되면 그 사고가 성립하지 않는다(server/config.mjs 의 resolveInquiryBot). */
    __testing.resetChatIdCache();
    healthTesting.resetCache();
    const savedChatId = config.telegramChatId;
    const savedSecret = config.telegramWebhookSecret;
    config.telegramChatId = "987654321";
    config.telegramWebhookSecret = "s3cret";

    const shared = await callHealth();

    config.telegramChatId = savedChatId;
    config.telegramWebhookSecret = savedSecret;
    healthTesting.resetCache();

    check("전용 토큰이 없어도 문의 중계가 켜진다", shared.payload?.sinks?.inquiry?.configured === true,
      shared.payload?.sinks?.inquiry?.detail);
    check("ready:true", shared.payload?.sinks?.inquiry?.ready === true,
      shared.payload?.sinks?.inquiry?.detail);
    check("알림 봇을 같이 쓰고 있음을 밝힌다", shared.payload?.sinks?.inquiry?.shared === true);

    /* 봇 username 은 공개 정보다. 이 값이 없으면 페이지 버튼을 어느 주소로 맞춰야
       하는지 배포 뒤에 알 방법이 없다 — 잘못 맞추면 문의가 조용히 사라진다. */
    check("문의를 읽는 봇의 @이름을 알려준다", shared.payload?.sinks?.inquiry?.username === "@icartsh_answer_bot",
      shared.payload?.sinks?.inquiry?.username);
    check("username 을 주면서도 토큰은 내보내지 않는다",
      !JSON.stringify(shared.payload).includes(config.telegramBotToken || "###"));
  }

  {
    // 아무것도 안 붙은 상태 — 이유가 달라지므로 안내도 달라져야 한다.
    __testing.resetChatIdCache();
    healthTesting.resetCache();
    const savedToken = config.telegramBotToken;
    config.telegramBotToken = "";
    const res = await callHealth();
    check("설정 전무 → accepting:false", res.payload?.accepting === false);
    check(
      "이때는 /start 가 아니라 '설정되지 않았다' 라고 말한다",
      !/\/start/.test(res.payload?.nextAction || ""),
      res.payload?.nextAction
    );
    config.telegramBotToken = savedToken;
  }

  {
    healthTesting.resetCache();
    const res = await callHealth("POST");
    check("POST → 405", res.statusCode === 405, `got ${res.statusCode}`);
  }
}

/* ------------------------------------------------------------------ */

telegram.close();

console.log(`\n${"-".repeat(60)}`);
if (failures.length) {
  console.error(`실패 ${failures.length}건:\n` + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`PASS  ${pass}개 검사 통과 — 서버리스 리드 접수 경로 정상`);
