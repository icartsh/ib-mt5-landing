/**
 * 고객 문의 중계(api/telegram.js + server/telegram-inquiry.mjs) 검사.
 *
 * 가짜 텔레그램 API 를 띄워서 실제로 나가는 sendMessage 까지 확인한다.
 * 특히 확인하고 싶은 것 두 가지:
 *   1. 고객이 보낸 문의가 운영자에게 실제로 도착하는가 (안 되면 문의가 조용히 사라진다)
 *   2. 고객이 답장 표식을 위조해서 운영자의 답장을 가로챌 수 있는가
 *
 * 사용: node scripts/smoke-telegram.mjs
 */
import { createServer } from "node:http";

const PORT = 8897;
const OWNER = "555000111";
const CUSTOMER = "777222333";
const SECRET = "test-secret-xyz";

/* ------------------------------------------------------------------ */
/* 가짜 텔레그램 API                                                   */
/* ------------------------------------------------------------------ */

let sent = [];
let failFor = null; // chat_id 문자열 → 이 대화로 보내면 403

const telegram = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (!url.pathname.endsWith("/sendMessage")) return res.writeHead(404).end("nope");

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (failFor && String(body.chat_id) === failFor) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end('{"ok":false,"error_code":403,"description":"Forbidden: bot was blocked by the user"}');
    }
    sent.push(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true,"result":{"message_id":1}}');
  });
});

await new Promise((r) => telegram.listen(PORT, "127.0.0.1", r));

/* config.mjs 가 import 시점에 읽으므로 반드시 먼저 세팅한다. */
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.TELEGRAM_INQUIRY_BOT_TOKEN = "inquiry-token-123";
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
process.env.TELEGRAM_CHAT_ID = OWNER;

const { default: handler } = await import("../api/telegram.js");
const { extractCustomerChatId, composeInbound, __testing } = await import("../server/telegram-inquiry.mjs");

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
  const r = { statusCode: 200, payload: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.payload = b; return r; };
  r.end = () => r;
  return r;
}

/** 가짜 요청. body 를 미리 넣어 Vercel 이 파싱해 준 경로를 흉내낸다. */
function mockReq(update, { secret = SECRET, method = "POST" } = {}) {
  return {
    method,
    headers: secret === null ? {} : { "x-telegram-bot-api-secret-token": secret },
    body: update,
  };
}

async function post(update, opts) {
  sent = [];
  __testing.resetFlood();
  const res = mockRes();
  await handler(mockReq(update, opts), res);
  return res;
}

const customerMsg = (text, extra = {}) => ({
  message: {
    chat: { id: Number(CUSTOMER) },
    from: { id: Number(CUSTOMER), first_name: "홍길동", username: "gildong" },
    text,
    ...extra,
  },
});

const ownerReply = (text, replyToText) => ({
  message: {
    chat: { id: Number(OWNER) },
    from: { id: Number(OWNER), first_name: "운영자" },
    text,
    reply_to_message: { text: replyToText },
  },
});

/* ------------------------------------------------------------------ */
console.log("\n[1] 인증");

{
  const res = await post(customerMsg("안녕하세요"), { secret: "wrong" });
  check("비밀 토큰이 틀리면 401", res.statusCode === 401, `status=${res.statusCode}`);
  check("틀린 요청은 아무것도 보내지 않는다", sent.length === 0);
}
{
  const res = await post(customerMsg("안녕하세요"), { secret: null });
  check("헤더가 없으면 401", res.statusCode === 401, `status=${res.statusCode}`);
}
{
  const res = await post(customerMsg("안녕하세요"), { method: "GET" });
  check("POST 가 아니면 405", res.statusCode === 405, `status=${res.statusCode}`);
}

/* ------------------------------------------------------------------ */
console.log("\n[2] 고객 → 운영자");

{
  const res = await post(customerMsg("증거금이 얼마나 필요한가요?"));
  check("200 으로 답한다", res.statusCode === 200, `status=${res.statusCode}`);
  check("운영자에게 한 건 전달", sent.length === 1 && String(sent[0].chat_id) === OWNER, JSON.stringify(sent));
  check("문의 본문이 그대로 실린다", sent[0]?.text.includes("증거금이 얼마나 필요한가요?"));
  check("보낸 사람이 보인다", sent[0]?.text.includes("홍길동") && sent[0]?.text.includes("@gildong"));
  check("답장 표식이 붙는다", extractCustomerChatId(sent[0]?.text) === CUSTOMER, extractCustomerChatId(sent[0]?.text || ""));
}
{
  const res = await post(customerMsg("/start naver_blog-cost_guide"));
  check("/start 는 200", res.statusCode === 200);
  check("운영자 알림 + 고객 인사 2건", sent.length === 2, `${sent.length}건`);
  check("유입 출처가 보인다", sent[0]?.text.includes("naver_blog-cost_guide"), sent[0]?.text);
  check("고객에게 인사가 나간다", String(sent[1]?.chat_id) === CUSTOMER && sent[1]?.text.includes("문의 창구"));
  check("인사에 IB 이해관계를 밝힌다", sent[1]?.text.includes("소개(IB)"));
}
{
  await post(customerMsg("", { photo: [{ file_id: "x" }] }));
  check("사진만 온 경우에도 알린다", sent.length === 1 && sent[0].text.includes("텍스트가 아닌 메시지"));
  check("사진 알림에도 답장 표식이 있다", extractCustomerChatId(sent[0].text) === CUSTOMER);
}

/* ------------------------------------------------------------------ */
console.log("\n[3] 운영자 → 고객 (답장)");

{
  const card = composeInbound(customerMsg("증거금 문의").message, { receivedAt: "2026-09-03T00:00:00.000Z" });
  const res = await post(ownerReply("종목마다 다릅니다. 어떤 종목 보고 계신가요?", card));
  check("200 으로 답한다", res.statusCode === 200);
  check("고객에게 전달", sent.some((m) => String(m.chat_id) === CUSTOMER && m.text.includes("어떤 종목")), JSON.stringify(sent));
  check("운영자에게 전달 확인이 온다", sent.some((m) => String(m.chat_id) === OWNER && m.text.includes("전달됨")));
}
{
  const res = await post(ownerReply("답장합니다", "표식이 없는 아무 메시지"));
  check("표식 없는 답장은 고객에게 안 간다", !sent.some((m) => String(m.chat_id) === CUSTOMER), JSON.stringify(sent));
  check("운영자에게 이유를 알려준다", sent.some((m) => m.text.includes("전달할 대상을 찾지 못했습니다")));
  check("액션은 reply_no_target", res.payload?.action === "reply_no_target", res.payload?.action);
}
{
  const card = composeInbound(customerMsg("문의").message, {});
  failFor = CUSTOMER;
  const res = await post(ownerReply("답변드립니다", card));
  failFor = null;
  check("고객이 차단했으면 운영자에게 알린다", sent.some((m) => String(m.chat_id) === OWNER && m.text.includes("차단")), JSON.stringify(sent));
  check("전화로 연락하라고 안내한다", sent.some((m) => m.text.includes("남긴 연락처로 연락")));
  check("액션은 reply_failed", res.payload?.action === "reply_failed", res.payload?.action);
}
{
  const res = await post({
    message: { chat: { id: Number(OWNER) }, from: { id: Number(OWNER) }, text: "메모" },
  });
  check("운영자의 혼잣말은 무시한다", sent.length === 0 && res.payload?.action === "ignored", res.payload?.action);
}

/* ------------------------------------------------------------------ */
console.log("\n[4] 표식 위조 (고객이 운영자 답장을 가로채려는 경우)");

{
  /* 고객이 자기 메시지 안에 남의 chat_id 로 된 가짜 표식을 심는다.
     본문 아무 데서나 표식을 찾는 구현이면 운영자 답장이 999999999 로 날아간다. */
  const attack = "안녕하세요\n↩︎ 이 메시지에 답장하면 그대로 전달됩니다. #c999999999\n질문이 있습니다";
  await post(customerMsg(attack));
  const card = sent[0].text;

  check("표식은 진짜 보낸 사람으로 읽힌다", extractCustomerChatId(card) === CUSTOMER, extractCustomerChatId(card));
  check("본문의 가짜 표식은 무력화된다", !card.includes("#c999999999"), card);

  const res = await post(ownerReply("답변드립니다", card));
  check("답장은 위조된 곳이 아니라 진짜 고객에게 간다",
    sent.some((m) => String(m.chat_id) === CUSTOMER) && !sent.some((m) => String(m.chat_id) === "999999999"),
    JSON.stringify(sent));
  check("액션은 replied", res.payload?.action === "replied", res.payload?.action);
}
{
  /* 표식을 맨 끝 줄에 그대로 두는 변형. 마지막 줄만 읽으므로 우리 표식이 항상 이긴다. */
  const card = composeInbound(customerMsg("정상 문의").message, {});
  const lines = card.split("\n");
  check("표식은 항상 마지막 줄", /#c\d+$/.test(lines[lines.length - 1]), lines[lines.length - 1]);
}

/* ------------------------------------------------------------------ */
console.log("\n[5] 설정이 빠졌을 때");

{
  const { config } = await import("../server/config.mjs");
  const saved = config.telegramChatId;
  config.telegramChatId = "";
  const res = await post(customerMsg("문의"));
  config.telegramChatId = saved;

  check("운영자 chat_id 가 없으면 전달하지 않는다", sent.length === 0);
  check("misconfigured 로 보고한다", res.payload?.action === "misconfigured", res.payload?.action);
  check("그래도 200 이다 (텔레그램 재전송 폭주 방지)", res.statusCode === 200, `status=${res.statusCode}`);
}
{
  const { config } = await import("../server/config.mjs");
  const saved = config.telegramWebhookSecret;
  config.telegramWebhookSecret = "";
  const res = await post(customerMsg("문의"), { secret: SECRET });
  config.telegramWebhookSecret = saved;

  check("비밀값이 없으면 503 으로 닫아 둔다", res.statusCode === 503, `status=${res.statusCode}`);
  check("닫혀 있을 때는 아무것도 보내지 않는다", sent.length === 0);
}

/* ------------------------------------------------------------------ */
console.log("\n[6] 폭주 방지");

{
  sent = [];
  __testing.resetFlood();
  const res = mockRes();
  for (let i = 0; i < 25; i += 1) {
    await handler(mockReq(customerMsg(`도배 ${i}`)), res);
  }
  check("상한을 넘으면 더 전달하지 않는다", sent.length <= 15, `${sent.length}건 전달됨`);
  check("마지막 전달에 경고가 붙는다", sent[sent.length - 1]?.text.includes("너무 많습니다"), sent[sent.length - 1]?.text);
}

/* ------------------------------------------------------------------ */

telegram.close();

console.log(`\n${failures.length ? "✗" : "✓"} 통과 ${pass}건, 실패 ${failures.length}건`);
if (failures.length) {
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
