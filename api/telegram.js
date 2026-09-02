/**
 * POST /api/telegram — 고객 문의 봇 webhook 수신구. (IB-10)
 *
 * 로직은 server/telegram-inquiry.mjs 에 있고 여기서는 세 가지만 한다:
 *   1. 이 요청이 진짜 텔레그램에서 온 것인지 확인한다
 *   2. 업데이트 하나를 넘긴다
 *   3. 무슨 일이 있어도 200 으로 답한다
 *
 * ## 왜 비밀 토큰 확인이 필수인가
 *
 * 이 주소는 공개된 https 엔드포인트다. 확인 없이 열어 두면 누구나 가짜 업데이트를
 * POST 해서 운영자 휴대폰에 아무 내용이나 띄울 수 있고, 더 나쁘게는 `#c<임의 chat_id>`
 * 가 박힌 가짜 문의 카드를 만들어 운영자가 거기에 답장하도록 유도할 수 있다.
 * 그래서 비밀값이 설정돼 있지 않으면 아예 동작하지 않는다 — 열려 있는 것보다 꺼져 있는
 * 쪽이 낫다. (setWebhook 의 secret_token 으로 등록하면 텔레그램이 매 요청에 헤더로 실어 준다.)
 *
 * ## 왜 항상 200 인가
 *
 * 텔레그램은 2xx 가 아니면 같은 업데이트를 재전송한다. 우리 쪽 오류로 500 을 주면
 * 재전송이 반복되고, 그 사이 sendMessage 가 성공한 건은 운영자 화면에 같은 문의가
 * 여러 번 쌓인다. 처리 실패는 로그로 남기고 수신 자체는 확정한다.
 */
import { config } from "../server/config.mjs";
import { handleUpdate } from "../server/telegram-inquiry.mjs";

const MAX_BODY_BYTES = 1_000_000;

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body; // Vercel 이 이미 파싱한 경우
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("본문이 너무 큽니다");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const secret = config.telegramWebhookSecret;
  if (!secret) {
    /* 설정이 없으면 기능을 켜지 않는다. 200 이 아니라 503 인 이유는, 이건 텔레그램이
       재전송해서 풀릴 문제가 아니라 우리가 값을 넣어야 풀리는 문제이고,
       setWebhook 상태 화면(getWebhookInfo)에 오류로 남아야 눈에 띄기 때문이다. */
    return res.status(503).json({ ok: false, error: "webhook secret unset" });
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  let update;
  try {
    update = await readJson(req);
  } catch (err) {
    console.error("[telegram] 본문 파싱 실패", err?.message || err);
    return res.status(200).json({ ok: true, action: "bad_body" });
  }

  try {
    const result = await handleUpdate(update);
    if (["forward_failed", "misconfigured", "reply_failed"].includes(result.action)) {
      console.error(`[telegram] ${result.action}: ${result.detail || ""}`);
    } else {
      console.log(`[telegram] ${result.action}${result.detail ? ` ${result.detail}` : ""}`);
    }
    return res.status(200).json({ ok: true, action: result.action });
  } catch (err) {
    console.error("[telegram] 처리 중 오류", err);
    return res.status(200).json({ ok: true, action: "error" });
  }
}
