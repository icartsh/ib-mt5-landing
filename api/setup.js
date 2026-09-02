/**
 * POST /api/setup — 봇 토큰을 꺼내지 않고 텔레그램 설정을 끝내는 운영 통로. (IB-10)
 *
 * ## 왜 이게 필요한가
 *
 * 설정을 마치려면 봇 토큰이 있어야 하는 동작이 두 가지 있다 — 목적지 chat_id 를 찾는
 * 것(getUpdates)과 webhook 을 거는 것(setWebhook). 그런데 토큰은 Vercel 에 `sensitive`
 * 로 들어가 있어서 **넣은 사람도 다시 읽을 수 없다.** 그래서 지금까지 이 두 동작은
 * "운영자가 토큰을 어딘가에 다시 붙여넣고 로컬 스크립트를 돌린다" 로만 가능했다.
 * 토큰을 다시 꺼내 돌리는 것 자체가 이 시스템에서 가장 위험한 순간이고, 붙여넣은 자리는
 * (채팅·터미널 기록·클립보드) 지워도 남는다.
 *
 * 토큰을 이미 가지고 있는 쪽은 서버다. 그러니 서버가 자기 설정을 하면 된다. 이 통로는
 * 값을 밖으로 내보내지 않는다 — chat_id 는 목적지를 고르기 위해 필요하므로 돌려주지만,
 * 봇 토큰과 webhook 비밀값은 어떤 응답에도 담기지 않는다.
 *
 * ## 기본값은 "꺼짐" 이다
 *
 * `SETUP_TOKEN` 이 없으면 404 다. 403 이 아니라 404 인 이유는, 존재하지 않는 주소와
 * 잠긴 주소를 구분해 주면 잠긴 주소가 있다는 사실 자체가 단서가 되기 때문이다.
 * 설정을 마치면 `SETUP_TOKEN` 을 지워서 이 통로를 다시 닫는 것을 전제로 만들었다.
 *
 * webhook 을 걸 수 있다는 것은 곧 문의가 어디로 갈지 정할 수 있다는 뜻이라 권한이 세다.
 * 그래서 (1) 긴 무작위 토큰을 요구하고 (2) 비교를 타이밍 안전하게 하고 (3) GET 으로는
 * 아무것도 하지 않는다. 브라우저 주소창이나 리퍼러에 토큰이 남는 경로를 없애기 위해
 * 토큰은 쿼리스트링이 아니라 헤더로만 받는다.
 */
import { timingSafeEqual } from "node:crypto";
import { config } from "../server/config.mjs";
import { listChatCandidates } from "../server/sinks.mjs";

const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
const TIMEOUT_MS = 8000;

/* 짧은 토큰은 추측당한다. 길이를 강제해 두면 "임시로 아무 값" 을 넣는 경로가 막힌다. */
const MIN_TOKEN_LENGTH = 24;

/** 길이가 다르면 timingSafeEqual 이 던지므로 길이 검사를 먼저 한다. */
function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function telegram(token, method, body) {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(`${method}: HTTP ${res.status} ${String(data?.description || "").slice(0, 200)}`);
  }
  return data?.result;
}

/**
 * webhook 주소는 우리가 지금 응답하고 있는 그 호스트여야 한다.
 *
 * 손으로 적어 두면 도메인이 바뀌는 날 조용히 어긋난다 — 텔레그램은 옛 주소로 계속 보내고,
 * 고객 화면에는 아무 이상이 없고, 문의만 사라진다.
 */
function publicOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const expected = process.env.SETUP_TOKEN || "";
  if (!expected || expected.length < MIN_TOKEN_LENGTH) {
    return res.status(404).json({ ok: false, error: "not found" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }
  if (!tokenMatches(req.headers["x-setup-token"], expected)) {
    return res.status(404).json({ ok: false, error: "not found" });
  }

  const token = config.telegramBotToken;
  if (!token) {
    return res.status(409).json({ ok: false, error: "TELEGRAM_BOT_TOKEN 미설정" });
  }

  const action = String(req.query?.action || "");

  try {
    if (action === "whoami") {
      /* 목적지 후보. 이 값을 TELEGRAM_CHAT_ID 에 넣으면 자동 탐색이 끝난다. */
      const me = await telegram(token, "getMe");
      const candidates = config.telegramChatId ? [] : await listChatCandidates(token);
      return res.status(200).json({
        ok: true,
        bot: me?.username ? `@${me.username}` : "",
        pinned: config.telegramChatId ? true : false,
        candidates,
      });
    }

    if (action === "webhook-info") {
      const info = await telegram(token, "getWebhookInfo");
      return res.status(200).json({
        ok: true,
        url: info?.url || "",
        pendingUpdateCount: info?.pending_update_count ?? 0,
        lastErrorMessage: info?.last_error_message || "",
      });
    }

    if (action === "webhook-set") {
      const secret = config.telegramWebhookSecret;
      /* 비밀값 없이 걸면 /api/telegram 이 503 으로 전부 되돌려보낸다. 텔레그램은 그걸
         재전송으로 받아들여 같은 업데이트를 계속 두드린다 — 걸기 전에 막는다. */
      if (!secret) {
        return res.status(409).json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET 미설정" });
      }
      const url = `${publicOrigin(req)}/api/telegram`;
      await telegram(token, "setWebhook", {
        url,
        secret_token: secret,
        allowed_updates: ["message"],
        /* 등록 전에 쌓여 있던 것은 버린다. 설정 확인용으로 보낸 /start 같은 것이
           고객 문의 카드로 둔갑해 운영자 화면에 뜨는 것을 막는다. */
        drop_pending_updates: true,
      });
      const info = await telegram(token, "getWebhookInfo");
      return res.status(200).json({ ok: true, url: info?.url || "", lastErrorMessage: info?.last_error_message || "" });
    }

    if (action === "webhook-delete") {
      await telegram(token, "deleteWebhook", { drop_pending_updates: false });
      return res.status(200).json({ ok: true, url: "" });
    }

    return res.status(400).json({
      ok: false,
      error: "action 은 whoami | webhook-info | webhook-set | webhook-delete 중 하나여야 합니다",
    });
  } catch (err) {
    /* 메시지에 토큰이 섞이지 않도록 텔레그램 응답의 description 만 위에서 잘라 두었다. */
    return res.status(502).json({ ok: false, error: String(err?.message || err) });
  }
}
