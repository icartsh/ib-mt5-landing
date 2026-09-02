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
import { config } from "./config.mjs";
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
 */
async function resolveChatId(token) {
  if (config.telegramChatId) return config.telegramChatId;
  if (cachedChatId) return cachedChatId;

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getUpdates?limit=10`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 401/404 는 토큰이 틀렸거나 무효화된 것 — 기다린다고 풀리지 않는다.
  if (!res.ok) throw httpError(res.status, `getUpdates`);

  const data = await res.json();
  const updates = Array.isArray(data?.result) ? data.result : [];

  // 가장 최근 대화를 쓴다. 여러 사람이 봇에 말을 걸었다면 마지막 사람이 이긴다 —
  // 그래서 TELEGRAM_CHAT_ID 를 명시하는 쪽이 항상 더 안전하다.
  for (let i = updates.length - 1; i >= 0; i -= 1) {
    const chatId = updates[i]?.message?.chat?.id ?? updates[i]?.channel_post?.chat?.id;
    if (chatId !== undefined && chatId !== null) {
      cachedChatId = String(chatId);
      return cachedChatId;
    }
  }

  /* 운영자가 /start 를 보내기 전까지는 몇 번을 다시 눌러도 같은 결과다. */
  throw configError("chat_id 미확인 — 텔레그램에서 봇에게 /start 를 한 번 보내 주세요.");
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

export function summarize(results) {
  return results
    .map((r) => `${r.name}=${r.attempted ? (r.ok ? "ok" : `fail(${r.detail})`) : "skip"}`)
    .join(" ");
}

export const __testing = { resetChatIdCache: () => { cachedChatId = ""; } };
