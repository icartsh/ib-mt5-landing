/**
 * 리드가 나가는 바깥 목적지(sink)들. fetch 만 쓰므로 서버리스에서도 그대로 돈다.
 *
 * ## 왜 "durable" 을 따로 세는가
 *
 * 로컬 서버에서는 JSONL 원장이 있어서 리드가 절대 사라지지 않았고, 시트·알림은
 * 전부 best-effort 여도 괜찮았다. 서버리스에는 그 원장이 없다 — 디스크가
 * 호출마다 날아간다. 그래서 "리드를 나중에 다시 읽을 수 있는 곳"에 최소 한 군데는
 * 반드시 들어가야 하고, 그게 전부 실패하면 사용자에게 성공이라고 답하면 안 된다.
 * 접수됐다고 믿고 기다리는 사람을 만드는 것이 재시도를 요청하는 것보다 훨씬 나쁘다.
 *
 * durable 로 치는 곳:
 *   - 구글 시트  : 진짜 표. 정렬·검색된다.
 *   - 텔레그램   : 운영자 휴대폰에 남는 1:1 대화. 건수가 적은 초기에는 이것으로 충분하다.
 */
import { config, resolveInquiryBot } from "./config.mjs";
import { buildNotifyText } from "./lead-core.mjs";

const TIMEOUT_MS = 8000;

/** 테스트에서 가짜 텔레그램 서버로 갈아끼울 수 있게 열어 둔다. */
const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";

/**
 * 실패를 "다시 눌러서 풀리는 것" 과 "운영자가 손대야 풀리는 것" 으로 가른다.
 *
 * 이 구분이 없으면 두 상황이 같은 문구를 받는다. 텔레그램이 잠깐 죽은 것은
 * 30초 뒤에 풀리지만, 봇에게 /start 를 안 보낸 것이나 시트 액세스 권한이 잘못된
 * 것은 신청자가 몇 번을 눌러도 그대로다. 후자에게 "잠시 후 다시 시도해 주세요"
 * 를 보여주면 안 되는 버튼 앞에 사람을 붙잡아 두는 것밖에 안 된다.
 */
function configError(message) {
  const err = new Error(message);
  err.retryable = false;
  return err;
}

/** 명시하지 않은 실패(네트워크 끊김·타임아웃 등)는 일시적인 것으로 본다. */
function isRetryable(err) {
  return err?.retryable !== false;
}

/** 4xx 는 우리 설정이 틀린 것이고, 5xx·429 는 상대 사정이라 기다리면 풀린다. */
function httpError(status, text) {
  const err = new Error(`HTTP ${status} ${String(text).slice(0, 200)}`);
  err.retryable = status >= 500 || status === 429;
  return err;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw httpError(res.status, text);
  return text;
}

/* -------------------------------------------------------------------- */
/* 텔레그램                                                              */
/* -------------------------------------------------------------------- */

/**
 * chat_id 캐시. 웜 인스턴스에서 매번 getUpdates 를 때리지 않기 위한 것으로,
 * 인스턴스가 죽으면 같이 사라진다 — 그래도 정확성에는 영향이 없다(다시 조회한다).
 */
let cachedChatId = "";

/**
 * chat_id 를 모르면 봇에게 온 최근 메시지에서 찾아낸다.
 *
 * 사장님이 봇에게 "/start" 한 번 보내면 그게 곧 설정이 된다. chat_id 를 직접
 * 알아내라고 안내하는 순간(@userinfobot 을 찾아라, JSON 을 열어서 숫자를 찾아라)
 * 설정이 거기서 멈춘다. 그래서 토큰 하나만 받고 나머지는 여기서 처리한다.
 *
 * ## 대화가 둘 이상이면 보내지 않는다 (IB-10)
 *
 * 예전에는 "가장 최근 대화" 를 골랐다. 그 규칙은 봇 주소가 비공개일 때만 안전하다.
 * 이 봇 주소가 어딘가에 노출돼서 다른 사람이 말을 걸면, 그 사람이 곧 최근 대화가 되고
 * **다음 리드 알림이 이름과 전체 전화번호를 그대로 달고 그 사람에게 간다.** 구글 시트가
 * 꺼져 있는 동안 텔레그램은 유일한 기록이라, 운영자는 그 리드가 있었다는 사실조차 모른다.
 * 화면에는 아무 이상이 없어서 몇 주가 지나도 드러나지 않는다.
 *
 * 그래서 후보가 둘 이상이면 고르지 않고 실패한다. 실패하면 그 신청은 접수되지 않고
 * 신청자는 "지금 접수가 어렵다" 는 안내를 받는다 — 리드 한 건을 잃는 대신 남의 전화번호가
 * 낯선 사람에게 가는 일은 없다. 잃은 리드는 화면에 보이지만, 새어 나간 번호는 보이지 않는다.
 *
 * 이 상태를 영구히 없애는 방법은 TELEGRAM_CHAT_ID 를 직접 박아 두는 것 하나뿐이다.
 */
/** 읽기 전용 텔레그램 호출. `result` 만 돌려준다. */
async function telegramApi(token, method) {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw httpError(res.status, method);
  const data = await res.json();
  return data?.result;
}

/**
 * 봇에게 온 최근 대화들. 읽기 전용(getUpdates)이라 부작용이 없다.
 *
 * `resolveChatId` 는 후보가 정확히 하나일 때만 목적지로 쓴다. 그런데 후보가 둘 이상이면
 * 접수가 멈추고, 그때 운영자에게 필요한 것은 "둘이다" 가 아니라 **어느 것이 자기 대화인지**다.
 * 그래서 판정과 목록을 분리해 둔다 — 운영 통로(api/setup.js)가 이 목록을 그대로 보여준다.
 */
export async function listChatCandidates(token) {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getUpdates?limit=100`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 401/404 는 토큰이 틀렸거나 무효화된 것 — 기다린다고 풀리지 않는다.
  if (!res.ok) throw httpError(res.status, `getUpdates`);

  const data = await res.json();
  const updates = Array.isArray(data?.result) ? data.result : [];

  const candidates = [];
  for (const update of updates) {
    const chat = update?.message?.chat ?? update?.channel_post?.chat;
    if (!chat || chat.id === undefined || chat.id === null) continue;
    const id = String(chat.id);
    if (candidates.some((c) => c.id === id)) continue;
    candidates.push({
      id,
      type: chat.type || "",
      /* 사람이 고를 수 있어야 하므로 이름을 같이 준다. 숫자만 보여주면 고를 수가 없다. */
      name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" "),
      username: chat.username ? `@${chat.username}` : "",
    });
  }
  return candidates;
}

async function resolveChatId(token) {
  if (config.telegramChatId) return config.telegramChatId;
  if (cachedChatId) return cachedChatId;

  const candidates = await listChatCandidates(token);

  /* 운영자가 /start 를 보내기 전까지는 몇 번을 다시 눌러도 같은 결과다. */
  if (candidates.length === 0) {
    throw configError("chat_id 미확인 — 텔레그램에서 봇에게 /start 를 한 번 보내 주세요.");
  }

  if (candidates.length > 1) {
    throw configError(
      `알림 봇에 대화가 ${candidates.length}개 있어 목적지를 확정할 수 없습니다 — ` +
        "리드가 엉뚱한 사람에게 갈 수 있어 보내지 않았습니다. " +
        "TELEGRAM_CHAT_ID 를 운영자 chat_id 로 직접 지정해 주세요. " +
        "(고정하고 나면 이 봇을 고객 문의용으로 같이 써도 안전합니다 — config.mjs 참고.)"
    );
  }

  cachedChatId = candidates[0].id;
  return cachedChatId;
}

async function sendTelegram(lead) {
  const token = config.telegramBotToken;
  if (!token) {
    return {
      name: "telegram", durable: true, attempted: false, ok: false,
      retryable: false, detail: "봇 토큰 미설정",
    };
  }

  try {
    const chatId = await resolveChatId(token);
    // 텔레그램은 운영자 1:1 채널이고 서버리스에서는 유일한 기록이다 → 전체 번호를 담는다.
    await postJson(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: buildNotifyText(lead, { full: true }),
      disable_web_page_preview: true,
    });
    return {
      name: "telegram", durable: true, attempted: true, ok: true,
      retryable: false, detail: `chat=${chatId}`,
    };
  } catch (err) {
    return {
      name: "telegram", durable: true, attempted: true, ok: false,
      retryable: isRetryable(err), detail: String(err?.message || err),
    };
  }
}

/* -------------------------------------------------------------------- */
/* 구글 시트 (Apps Script 웹앱)                                          */
/* -------------------------------------------------------------------- */

/**
 * Apps Script 웹앱은 실패를 HTTP 상태로 알려주지 않는다.
 *
 *   - doPost 안에서 예외가 나도 200 + {"ok":false,"error":...} 로 답한다.
 *   - 배포 액세스 권한이 "모든 사용자" 가 아니면 200 + 구글 로그인 HTML 이 온다.
 *
 * 상태 코드만 보면 둘 다 성공으로 보인다. 시트가 유일한 기록일 때 이걸 성공으로
 * 치면 한 줄도 안 남은 채 "접수되었습니다" 가 나가고, 그 사람은 오지 않는 전화를
 * 기다린다. 그래서 본문을 열어 ok:true 를 직접 확인한다.
 */
function assertSheetsAck(text) {
  const head = String(text).trim().slice(0, 200);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // JSON 이 아니면 십중팔구 구글 로그인 페이지나 오류 페이지다.
    if (/^\s*<|<html/i.test(head)) {
      // 액세스 권한 문제다. 다시 눌러도 계속 로그인 페이지가 온다.
      throw configError("웹앱이 HTML 을 반환 — 배포 액세스 권한이 '모든 사용자' 인지 확인해 주세요.");
    }
    throw configError(`응답을 해석하지 못함: ${head}`);
  }

  // doPost 가 스크립트 오류로 거부한 것이므로 스크립트를 고쳐야 풀린다.
  if (data?.ok !== true) throw configError(`웹앱이 저장을 거부: ${data?.error || head}`);
}

async function sendSheets(lead) {
  if (!config.sheetsWebhookUrl) {
    return {
      name: "sheets", durable: true, attempted: false, ok: false,
      retryable: false, detail: "URL 미설정",
    };
  }
  try {
    assertSheetsAck(await postJson(config.sheetsWebhookUrl, lead));
    return { name: "sheets", durable: true, attempted: true, ok: true, retryable: false, detail: "ok" };
  } catch (err) {
    return {
      name: "sheets", durable: true, attempted: true, ok: false,
      retryable: isRetryable(err), detail: String(err?.message || err),
    };
  }
}

/* -------------------------------------------------------------------- */
/* 알림 전용 채널 (기록으로 치지 않는다)                                 */
/* -------------------------------------------------------------------- */

async function sendWebhookNotify(lead) {
  const kind = config.notifyKind;
  const url = config.notifyWebhookUrl;
  if (!["slack", "discord", "generic"].includes(kind)) {
    return { name: kind || "none", durable: false, attempted: false, ok: false, retryable: false, detail: "미사용" };
  }
  if (!url) {
    return { name: kind, durable: false, attempted: false, ok: false, retryable: false, detail: "URL 미설정" };
  }

  // 공유 채널일 수 있으므로 번호를 가린다.
  const text = buildNotifyText(lead, { full: false });
  const payload =
    kind === "slack" ? { text } : kind === "discord" ? { content: text } : { text, lead };

  try {
    await postJson(url, payload);
    return { name: kind, durable: false, attempted: true, ok: true, retryable: false, detail: "sent" };
  } catch (err) {
    return {
      name: kind, durable: false, attempted: true, ok: false,
      retryable: isRetryable(err), detail: String(err?.message || err),
    };
  }
}

/* -------------------------------------------------------------------- */

/**
 * 설정된 모든 sink 에 리드를 보낸다. 한 곳이 실패해도 나머지는 계속 시도한다.
 *
 * `durableRetryable` 은 "지금 다시 누르면 될 수도 있는가" 다. 설정이 아예 없는
 * 경우뿐 아니라 /start 미발송·시트 권한 오류처럼 운영자가 손대야 풀리는 실패도
 * false 가 되어야 한다. 이 값 하나가 신청자에게 나갈 문구를 가른다.
 *
 * @returns {{results: Array, durableConfigured: boolean, durableOk: boolean, durableRetryable: boolean}}
 */
export async function deliverLead(lead) {
  const tasks = [sendTelegram(lead), sendSheets(lead)];
  if (["slack", "discord", "generic"].includes(config.notifyKind)) {
    tasks.push(sendWebhookNotify(lead));
  }

  const results = await Promise.all(tasks);
  const durable = results.filter((r) => r.durable);

  return {
    results,
    durableConfigured: durable.some((r) => r.attempted),
    durableOk: durable.some((r) => r.ok),
    durableRetryable: durable.some((r) => r.attempted && !r.ok && r.retryable),
  };
}

/**
 * "지금 신청이 접수될 수 있는 상태인가" 를 리드를 만들지 않고 확인한다.
 *
 * 이게 없으면 확인 방법이 가짜 신청을 한 건 넣어 보는 것뿐이다. 그러면 확인할
 * 때마다 운영자 휴대폰에 가짜 리드가 쌓이고, 진짜와 섞인다. 텔레그램 chat_id
 * 조회는 읽기 전용이라 부작용이 없어서 그대로 확인용으로 쓸 수 있다.
 *
 * 시트는 사정이 다르다 — 확인하려면 실제로 한 줄을 써야 한다. 그래서 설정
 * 여부까지만 보고하고 저장이 실제로 되는지는 단언하지 않는다.
 */
export async function probeSinks() {
  const telegram = {
    name: "telegram",
    configured: Boolean(config.telegramBotToken),
    ready: false,
    /* 목적지를 어떻게 정하고 있는지. "auto" 는 지금은 되지만 봇에 다른 대화가 하나라도
       생기면 그 순간 접수가 멈춘다 — 운영자가 이 차이를 볼 수 있어야 한다. */
    destination: config.telegramChatId ? "pinned" : "auto",
    detail: "봇 토큰 미설정",
  };

  if (telegram.configured) {
    try {
      await resolveChatId(config.telegramBotToken);
      telegram.ready = true;
      telegram.detail = config.telegramChatId
        ? "목적지 고정됨 — TELEGRAM_CHAT_ID 로 지정된 곳으로만 간다"
        : "대화 확인됨(자동 탐색) — 이 봇에 다른 사람이 말을 걸면 접수가 멈춘다. TELEGRAM_CHAT_ID 고정 권장";
    } catch (err) {
      telegram.detail = String(err?.message || err);
    }
  }

  const sheetsConfigured = Boolean(config.sheetsWebhookUrl);
  const sheets = {
    name: "sheets",
    configured: sheetsConfigured,
    ready: sheetsConfigured,
    detail: sheetsConfigured
      ? "URL 설정됨 — 실제 저장 여부는 리드가 들어와야 확인된다"
      : "URL 미설정",
  };

  /* 고객 문의 중계(api/telegram.js)는 리드 접수와 무관하므로 accepting 에는 넣지 않는다.
     다만 세 값 중 하나라도 빠지면 문의가 조용히 사라지므로 상태는 같이 보고한다. */
  const { token: inquiryToken, shared } = resolveInquiryBot();
  const inquiryConfigured = Boolean(inquiryToken);
  const inquiry = {
    name: "telegram-inquiry",
    configured: inquiryConfigured,
    ready: inquiryConfigured && Boolean(config.telegramWebhookSecret) && Boolean(config.telegramChatId),
    /* 전용 봇인지 알림 봇을 같이 쓰는지. 운영자가 페이지 버튼 주소를 맞출 때 필요하다. */
    shared,
    /* 실제로 문의를 읽고 있는 봇의 @이름. 봇 username 은 공개 정보라 내보내도 된다 —
       오히려 이게 없으면 페이지 버튼이 "우리가 읽지 않는 봇" 을 가리켜도 알 방법이 없다. */
    username: "",
    /* 아래에서 getWebhookInfo 로 채운다. 토큰이 없으면 물어볼 것도 없으므로 null 로 둔다. */
    webhook: null,
    detail: !inquiryConfigured
      ? config.telegramBotToken
        ? "TELEGRAM_CHAT_ID 미설정 — 알림 봇을 같이 쓰려면 목적지가 고정돼 있어야 한다"
        : "문의 봇 토큰 미설정 — 봇에 온 문의는 아무도 읽지 않는다"
      : !config.telegramWebhookSecret
        ? "TELEGRAM_WEBHOOK_SECRET 미설정 — webhook 이 열리지 않는다"
        : !config.telegramChatId
          ? "TELEGRAM_CHAT_ID 미설정 — 문의를 전달할 곳이 없다"
          : shared
            ? "문의가 운영자 대화로 전달된다 (알림 봇과 같은 봇을 쓴다)"
            : "문의가 운영자 대화로 전달된다 (전용 문의 봇)",
  };

  if (inquiryConfigured) {
    /* getMe 는 읽기 전용이라 부작용이 없다. 실패해도 문의 중계 자체는 멀쩡하므로
       이름만 비워 두고 ready 는 건드리지 않는다. */
    try {
      const me = await telegramApi(inquiryToken, "getMe");
      inquiry.username = me?.username ? `@${me.username}` : "";
    } catch {
      /* 이름을 못 읽은 것뿐이다. 상태 판정에는 쓰지 않는다. */
    }

    /**
     * webhook 이 실제로 붙어 있는지.
     *
     * 위의 `ready` 는 **우리 쪽 설정이 갖춰졌는가** 만 본다 — 토큰·비밀값·목적지가
     * 다 있으면 true 다. 그런데 setWebhook 등록이 빠졌거나 텔레그램이 우리 주소로
     * 배달하다 실패하고 있으면, 설정은 완벽한데 문의는 한 건도 안 들어온다.
     * 그 상태가 `ready: true` 로 보였기 때문에 "봇이 응답을 안 한다" 를 만났을 때
     * 원인을 좁힐 수가 없었다. 등록 여부와 마지막 배달 오류를 같이 답한다.
     *
     * 비밀값은 내보내지 않는다 — 등록된 주소는 우리 공개 엔드포인트이고,
     * secret_token 은 getWebhookInfo 가 애초에 돌려주지 않는다.
     */
    try {
      const info = await telegramApi(inquiryToken, "getWebhookInfo");
      const url = typeof info?.url === "string" ? info.url : "";
      inquiry.webhook = {
        registered: Boolean(url),
        /* 등록된 주소가 우리 수신구인지. 다른 곳을 가리키면 문의는 남의 서버로 간다. */
        pointsHere: url.endsWith("/api/telegram"),
        pending: Number(info?.pending_update_count) || 0,
        lastError: info?.last_error_message || "",
        lastErrorAt: info?.last_error_date
          ? new Date(info.last_error_date * 1000).toISOString()
          : "",
      };
      if (!url) {
        inquiry.ready = false;
        inquiry.detail = "webhook 미등록 — 고객이 봇에 남긴 문의가 서버까지 오지 않는다";
      } else if (!inquiry.webhook.pointsHere) {
        inquiry.ready = false;
        inquiry.detail = "webhook 이 이 서버가 아닌 다른 주소로 등록돼 있다";
      } else if (info?.last_error_message) {
        inquiry.detail = `${inquiry.detail} (마지막 배달 오류: ${info.last_error_message})`;
      }
    } catch {
      /* 조회에 실패한 것뿐이다. 등록 상태를 모른다는 것과 꺼져 있다는 것은 다르므로
         ready 를 내리지 않고 "모름" 으로 남긴다. */
      inquiry.webhook = { registered: null, pointsHere: null, pending: 0, lastError: "", lastErrorAt: "" };
    }
  }

  return { telegram, sheets, inquiry, accepting: telegram.ready || sheets.ready };
}

export function summarize(results) {
  return results
    .map((r) => `${r.name}=${r.attempted ? (r.ok ? "ok" : `fail(${r.detail})`) : "skip"}`)
    .join(" ");
}

export const __testing = { resetChatIdCache: () => { cachedChatId = ""; } };
