/**
 * 고객 문의 봇 ↔ 운영자 중계. (IB-10)
 *
 * ## 왜 이게 필요한가
 *
 * 텔레그램 봇은 방향이 두 개고, 둘은 완전히 다른 물건이다.
 *
 *   나가는 쪽(기존): 서버 → sendMessage → 운영자.  리드 알림이 이 경로다(sinks.mjs).
 *   들어오는 쪽(이것): 고객 → 봇 → ???
 *
 * `/broker`·`/signup` 의 "텔레그램 문의" 버튼은 **들어오는 쪽**이다. 그런데 봇에게 온
 * 메시지는 아무도 꺼내 읽지 않으면 그냥 큐에 쌓였다가 24시간 뒤 사라진다. 고객 화면에는
 * 대화창이 정상적으로 열리고 메시지도 전송된 것으로 보이기 때문에, 고객은 답을 기다리고
 * 우리는 문의가 왔다는 사실조차 모른다. 버튼이 죽어 있는 것보다 나쁘다 — 죽은 버튼은
 * 최소한 눌러 본 사람이 다른 경로를 찾는다.
 *
 * 이 모듈이 그 큐를 운영자 대화로 밀어 넣고, 운영자의 답장을 고객에게 되돌린다.
 *
 * ## 봇이 하나여도 되는 조건
 *
 * 봇을 둘로 나눠야 하는 상황이 실제로 있다. sinks.mjs 의 `resolveChatId` 는
 * TELEGRAM_CHAT_ID 가 없으면 봇에게 온 최근 대화에서 목적지를 찾는데, 그 봇 주소를
 * 랜딩페이지에 걸면 **고객이 그 대화 목록에 들어온다** — 리드 알림(이름·전체 전화번호)이
 * 생판 남에게 갈 수 있고, 구글 시트가 꺼져 있는 지금 텔레그램이 유일한 기록이라
 * 운영자는 그 리드를 영영 못 본다.
 *
 * 다만 그 사고는 **자동 탐색이 켜져 있을 때만** 성립한다. TELEGRAM_CHAT_ID 가 박혀
 * 있으면 목적지는 그 값 하나이고, 그 봇에 누가 말을 걸든 알림이 새지 않는다. 그리고
 * 이 중계는 어차피 TELEGRAM_CHAT_ID 를 필수로 요구한다 — 중계가 도는 조건 자체가
 * 사고 조건을 배제한다. 그래서 토큰을 하나만 가진 운영자도 문의를 받을 수 있다.
 * 판정은 config.mjs 의 `resolveInquiryBot()` 한 곳에 모아 두었다.
 *
 * 봇을 같이 쓰면 운영자 대화 하나에 리드 알림과 고객 문의가 섞여 들어온다. 운영자가
 * 리드 알림에 답장하면 표식이 없으므로 "전달할 대상을 찾지 못했습니다" 로 돌려보낸다
 * (아래 `reply_no_target`) — 고객에게 잘못 나가지는 않는다.
 */
import { config, resolveInquiryBot } from "./config.mjs";

const TIMEOUT_MS = 8000;

/** 운영자에게 옮겨 실을 본문 길이 상한. 텔레그램 메시지 상한(4096)보다 넉넉히 아래로. */
const MAX_BODY_CHARS = 3000;

/**
 * 답장 대상 표식. 운영자가 어떤 문의에 답하는지는 `reply_to_message` 로만 알 수 있는데,
 * 텔레그램은 그 안에 원래 보낸 사람의 chat_id 를 주지 않는다(고객이 프로필을 숨기면
 * `forward_from` 도 비어 온다). 그래서 우리가 보낸 메시지 **본문 마지막 줄**에 직접 적어 두고
 * 답장할 때 그 줄을 되읽는다. 서버리스에는 매핑을 저장할 곳이 없어서 이 방식이 유일하게
 * 상태 없이 동작한다.
 */
const MARKER_PREFIX = "↩︎ 이 메시지에 답장하면 그대로 전달됩니다.";
const MARKER_LINE = /^↩︎ 이 메시지에 답장하면 그대로 전달됩니다\.\s+#c(-?\d{3,})$/;

/** 본문 어디에 있든 표식처럼 생긴 줄을 찾아내는 느슨한 패턴 (고객 입력에서 걷어내는 용도). */
const MARKER_LOOKALIKE = /#c-?\d{3,}/;

function markerLine(chatId) {
  return `${MARKER_PREFIX} #c${chatId}`;
}

/**
 * 표식은 **마지막 줄에서만** 읽는다.
 *
 * 우리가 보내는 메시지에는 고객이 쓴 글이 그대로 들어간다. 본문 전체에서 첫 번째
 * `#c숫자` 를 찾는 방식이면 고객이 자기 메시지에 `#c<남의 chat_id>` 한 줄을 넣는 것만으로
 * 운영자의 답장을 원하는 곳으로 돌릴 수 있다. 우리 표식은 항상 맨 끝에 붙으므로
 * 마지막 줄만 보면 그 조작이 통하지 않는다. (composeInbound 에서 고객 본문의 유사 표식도
 * 한 번 더 걷어낸다 — 두 겹으로 막는다.)
 */
export function extractCustomerChatId(text) {
  if (typeof text !== "string" || !text) return "";
  const lines = text.split("\n");
  const last = lines[lines.length - 1].trim();
  const m = MARKER_LINE.exec(last);
  return m ? m[1] : "";
}

/** 고객이 본문에 심어 둔 가짜 표식을 무력화한다. 지우지 않고 눈에 보이게 표시만 깬다. */
function defuseLookalikes(text) {
  return text
    .split("\n")
    .map((line) => (MARKER_LOOKALIKE.test(line) ? line.replace(/#c(-?\d{3,})/g, "#⟨c$1⟩") : line))
    .join("\n");
}

function displayName(from) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  const handle = from?.username ? `@${from.username}` : "";
  return [name, handle].filter(Boolean).join(" ") || `id:${from?.id ?? "?"}`;
}

/**
 * 운영자 대화에 올라갈 문의 카드를 만든다.
 *
 * `parse_mode` 를 쓰지 않는다. 고객이 쓴 글에 `<b>` 나 `*` 가 섞여 있으면 텔레그램이
 * 파싱 오류로 **메시지 전체를 거절**한다 — 문의가 통째로 사라진다. 서식보다 도착이 중요하다.
 */
export function composeInbound(message, { receivedAt } = {}) {
  const from = message?.from || {};
  const chatId = message?.chat?.id;

  const raw = typeof message?.text === "string" ? message.text : "";
  let body;
  if (raw) {
    const trimmed = raw.length > MAX_BODY_CHARS ? `${raw.slice(0, MAX_BODY_CHARS)}\n…(생략됨)` : raw;
    body = defuseLookalikes(trimmed);
  } else {
    /* 사진·음성·파일 등. 내용을 옮길 수 없으므로 왔다는 사실만 정확히 알린다. */
    body = "(텍스트가 아닌 메시지입니다 — 봇 대화창을 직접 열어 확인해 주세요.)";
  }

  return [
    "💬 새 텔레그램 문의",
    `보낸 사람: ${displayName(from)}`,
    `받은 시각: ${receivedAt || new Date().toISOString()}`,
    "─────────────",
    body,
    "",
    markerLine(chatId),
  ].join("\n");
}

/** `/start <payload>` 로 실려 온 유입 출처. links.js 가 utm 을 여기에 넣어 보낸다. */
export function startPayload(text) {
  if (typeof text !== "string") return "";
  const m = /^\/start(?:@\w+)?\s+(\S{1,64})$/.exec(text.trim());
  return m ? m[1].replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) : "";
}

/**
 * 고객이 처음 봇을 열었을 때 나가는 인사.
 *
 * 이게 없으면 START 를 누른 고객 화면에는 **아무 일도 일어나지 않는다**. 응답이 없는
 * 창을 보고 나가는 사람을 우리는 셀 수도 없다. 답변 시각을 약속하지는 않는다 —
 * 지킬 수 없는 약속은 안 하느니만 못하다.
 */
export function greetingText() {
  return [
    "안녕하세요. MT5 해외선물 문의 창구입니다.",
    "",
    "궁금하신 내용을 이 창에 그대로 남겨 주세요. 담당자가 확인하고 답변드립니다.",
    "계좌 개설, 비용 구조, 플랫폼 설치 무엇이든 괜찮습니다.",
    "",
    "※ 저희는 브로커가 아니라 소개(IB) 업체입니다. 입금·출금은 브로커 계정에서 직접 하시게 되고,",
    "   저희가 고객님의 자금을 받거나 대신 거래해 드리지 않습니다.",
  ].join("\n");
}

/**
 * 고객의 문의를 운영자에게 올린 뒤 고객 화면에 남기는 접수 확인.
 *
 * 이게 없으면 고객은 질문을 보내고 **아무 응답도 받지 못한다**. 봇 대화창은 원래
 * 조용하므로 고객 입장에서는 "이 봇 죽었구나" 와 구별되지 않는다. 실제로 사장님이
 * 봇에 말을 걸었을 때 겪은 것이 정확히 이 침묵이다.
 */
export function receiptText() {
  return "문의가 담당자에게 전달되었습니다. 확인하는 대로 이 창으로 답변드립니다.";
}

/**
 * 운영자가 자기 봇에 말을 걸었을 때 돌려주는 안내.
 *
 * ## 왜 필요한가
 *
 * 운영자 대화는 **문의 수신함**이다. 그래서 아래 handleUpdate 는 운영자가 보낸 메시지를
 * 고객 문의로 취급하지 않는다 — 여기까지는 옳다. 그런데 답장이 아닌 메시지는 그냥
 * `ignored` 로 버려서, 운영자 화면에는 아무 일도 일어나지 않았다. 봇이 고장 난 것과
 * 정상 동작이 화면상 완전히 같아진다. 운영자는 자기 봇을 시험할 방법이 없었다.
 *
 * 그리고 이건 단순한 불편이 아니다 — 운영자는 이 창에 그냥 답을 써 두고 고객에게
 * 갔다고 생각할 수 있다. 그 글은 아무 데도 가지 않는다. 그래서 "여기 쓴 글은 고객에게
 * 가지 않는다" 를 명시적으로 알린다.
 *
 * @param {string} text 운영자가 보낸 원문. `/start` 류 명령이면 전체 안내를 준다.
 * @param {string} botUsername 자기 자신의 @이름. 비어 있으면 링크 줄을 뺀다.
 */
export function ownerHelpText(text, botUsername = "") {
  const asked = /^\/(start|help|status|ping)\b/.test((text || "").trim());
  if (!asked) {
    return [
      "이 창은 고객 문의가 올라오는 수신함입니다. 여기에 그냥 쓰신 글은 고객에게 가지 않습니다.",
      "고객에게 답하시려면 '💬 새 텔레그램 문의' 카드에 답장(reply)해 주세요.",
      "/help 로 전체 안내를 볼 수 있습니다.",
    ].join("\n");
  }

  const link = botUsername ? `https://t.me/${botUsername.replace(/^@/, "")}` : "";
  return [
    "✅ 문의 봇이 정상 동작 중입니다. 이 대화가 문의 수신함입니다.",
    "",
    "• 고객이 봇에 남긴 문의는 '💬 새 텔레그램 문의' 카드로 여기 올라옵니다.",
    "• 그 카드에 답장(reply)하면 내용이 그대로 고객에게 전달됩니다.",
    "• 카드에 답장하지 않고 이 창에 쓰신 글은 고객에게 가지 않습니다.",
    "",
    "고객 입장에서 시험해 보시려면 다른 텔레그램 계정으로 봇을 여세요.",
    "이 계정은 운영자 계정이라 고객 흐름을 탈 수 없습니다 — 문의가 자기 자신에게",
    "전달되는 것을 막기 위해 일부러 갈라 두었습니다.",
    ...(link ? ["", `고객용 링크: ${link}`] : []),
  ].join("\n");
}

/* -------------------------------------------------------------------- */
/* 텔레그램 호출                                                         */
/* -------------------------------------------------------------------- */

function apiBase() {
  return process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
}

async function callBot(token, method, body) {
  const res = await fetch(`${apiBase()}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 텔레그램이 JSON 이 아닌 것을 줄 때가 있다(게이트웨이 오류 등) */
  }
  if (!res.ok || data?.ok !== true) {
    const err = new Error(data?.description || `HTTP ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    err.errorCode = data?.error_code;
    throw err;
  }
  return data.result;
}

function sendText(token, chatId, text) {
  return callBot(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

/**
 * 자기 @이름. 봇마다 고정값이라 인스턴스 수명 동안 한 번만 물어본다.
 * 못 읽어도 안내문에서 링크 한 줄이 빠질 뿐이므로 오류를 위로 던지지 않는다.
 */
let cachedUsername = null;
async function botUsername(token) {
  if (cachedUsername !== null) return cachedUsername;
  try {
    const me = await callBot(token, "getMe", {});
    cachedUsername = me?.username ? `@${me.username}` : "";
  } catch {
    cachedUsername = "";
  }
  return cachedUsername;
}

/* -------------------------------------------------------------------- */
/* 폭주 방지                                                             */
/* -------------------------------------------------------------------- */

/**
 * 같은 사람이 짧은 시간에 쏟아붓는 것만 막는다. 웜 인스턴스 한정이라 완벽하지 않지만,
 * 봇 주소는 공개돼 있고 운영자 휴대폰은 하나뿐이라 최소한의 방벽은 있어야 한다.
 * 상한을 넘긴 뒤에도 **마지막으로 한 번만** 알려서, 조용히 삼킨 것처럼 보이지 않게 한다.
 */
const FLOOD_WINDOW_MS = 60_000;
const FLOOD_MAX = 15;
const floodHits = new Map();

/** @returns {{verdict: "pass"|"last"|"drop", count: number}} count 는 이번 창 안에서 몇 번째인지. */
function floodCheck(chatId) {
  const now = Date.now();
  const key = String(chatId);
  const recent = (floodHits.get(key) || []).filter((t) => now - t < FLOOD_WINDOW_MS);
  recent.push(now);
  floodHits.set(key, recent);

  if (floodHits.size > 1000) {
    for (const [k, times] of floodHits) {
      if (times.every((t) => now - t >= FLOOD_WINDOW_MS)) floodHits.delete(k);
    }
  }

  const verdict = recent.length < FLOOD_MAX ? "pass" : recent.length === FLOOD_MAX ? "last" : "drop";
  return { verdict, count: recent.length };
}

/* -------------------------------------------------------------------- */
/* 업데이트 처리                                                         */
/* -------------------------------------------------------------------- */

/**
 * webhook 으로 받은 업데이트 하나를 처리한다.
 *
 * 어떤 경우에도 예외를 밖으로 던지지 않고 결과를 값으로 돌려준다. 호출부가 텔레그램에
 * 200 이 아닌 응답을 주면 텔레그램은 같은 업데이트를 계속 재전송하고, 그 재전송이
 * 운영자 휴대폰에서는 중복 알림으로 보인다.
 *
 * @returns {{action: string, detail?: string}}
 */
export async function handleUpdate(update) {
  const { token } = resolveInquiryBot();
  const ownerChatId = config.telegramChatId;

  if (!token) return { action: "skipped", detail: "문의 봇 토큰 미설정" };
  if (!ownerChatId) {
    /* 운영자 chat_id 를 모르면 문의를 어디로 보낼지 알 수 없다. 알림 봇처럼
       getUpdates 로 추측하는 경로를 여기서는 일부러 쓰지 않는다 — 이 봇의 대화 상대는
       대부분 고객이라, 추측하면 고객끼리 문의가 오갈 수 있다. */
    return { action: "misconfigured", detail: "TELEGRAM_CHAT_ID 미설정 — 문의를 전달할 곳이 없다" };
  }

  const message = update?.message || update?.edited_message;
  if (!message) return { action: "ignored", detail: "메시지가 아닌 업데이트" };

  const chatId = message?.chat?.id;
  if (chatId === undefined || chatId === null) return { action: "ignored", detail: "chat 없음" };

  const isOwner = String(chatId) === String(ownerChatId);
  const text = typeof message.text === "string" ? message.text : "";

  /* ---- 운영자가 문의 카드에 답장한 경우 → 고객에게 되돌린다 ---- */
  if (isOwner) {
    const target = extractCustomerChatId(message?.reply_to_message?.text || "");
    if (!target) {
      if (!message.reply_to_message) {
        /* 답장이 아닌 운영자 메시지. 예전에는 여기서 조용히 버렸는데, 그러면 운영자
           화면에서 "봇이 죽음" 과 "정상" 이 구별되지 않는다. 반드시 무언가 돌려준다. */
        const username = await botUsername(token);
        await sendText(token, ownerChatId, ownerHelpText(text, username)).catch(() => {});
        return { action: "owner_help" };
      }
      await sendText(
        token,
        ownerChatId,
        "전달할 대상을 찾지 못했습니다.\n봇이 올린 '💬 새 텔레그램 문의' 카드에 직접 답장(reply)해 주세요."
      ).catch(() => {});
      return { action: "reply_no_target" };
    }
    if (!text) {
      await sendText(token, ownerChatId, "텍스트만 전달할 수 있습니다. 사진·파일은 고객 대화창에서 직접 보내 주세요.").catch(() => {});
      return { action: "reply_unsupported" };
    }

    try {
      await sendText(token, target, text);
      await sendText(token, ownerChatId, `✅ 전달됨 → #c${target}`).catch(() => {});
      return { action: "replied", detail: `#c${target}` };
    } catch (err) {
      /* 403 은 고객이 봇을 차단했거나 대화를 지운 것이다. 다시 눌러도 풀리지 않으므로
         운영자가 다른 경로(전화)로 가야 한다는 것을 분명히 알려 준다. */
      const blocked = err?.errorCode === 403;
      await sendText(
        token,
        ownerChatId,
        blocked
          ? `⚠️ 전달 실패 — 고객이 봇을 차단했거나 대화를 삭제했습니다 (#c${target}).\n텔레그램으로는 닿지 않습니다. 남긴 연락처로 연락해 주세요.`
          : `⚠️ 전달 실패 (#c${target}): ${String(err?.message || err).slice(0, 200)}`
      ).catch(() => {});
      return { action: "reply_failed", detail: String(err?.message || err) };
    }
  }

  /* ---- 고객이 보낸 경우 → 운영자에게 올린다 ---- */
  const { verdict: flood, count: floodCount } = floodCheck(chatId);
  if (flood === "drop") return { action: "throttled", detail: `#c${chatId}` };

  const payload = startPayload(text);
  const isStart = /^\/start(?:@\w+)?\b/.test(text.trim());

  const card = composeInbound(message, { receivedAt: new Date().toISOString() });
  const lines = isStart
    ? [
        "💬 새 방문자가 문의 봇을 열었습니다",
        `보낸 사람: ${displayName(message.from)}`,
        payload ? `유입: ${payload}` : "유입: (표시 없음)",
        "",
        "아직 질문은 오지 않았습니다. 먼저 말을 걸어도 됩니다.",
        "",
        markerLine(chatId),
      ].join("\n")
    : card;

  const notice = flood === "last" ? `${lines}\n\n⚠️ 이 사람의 메시지가 1분 안에 너무 많습니다 — 이후 몇 건은 전달하지 않습니다.` : lines;

  try {
    await sendText(token, ownerChatId, notice);
  } catch (err) {
    /* 운영자에게 못 올렸다 = 문의가 사라졌다. 상위에서 로그로 남긴다. */
    return { action: "forward_failed", detail: String(err?.message || err) };
  }

  if (isStart) {
    await sendText(token, chatId, greetingText()).catch(() => {});
    return { action: "greeted", detail: payload ? `유입=${payload}` : "" };
  }

  /* 접수 확인은 창(1분) 안에서 첫 건에만 보낸다. 매 줄마다 되돌려 주면 고객이
     여러 줄로 나눠 쓸 때 대화가 봇 응답으로 도배된다. 반대로 아예 안 보내면
     고객은 침묵만 본다 — 첫 건 한 번이 그 사이다. */
  if (floodCount === 1) {
    await sendText(token, chatId, receiptText()).catch(() => {});
    return { action: "forwarded_with_receipt", detail: `#c${chatId}` };
  }

  return { action: "forwarded", detail: `#c${chatId}` };
}

export const __testing = {
  markerLine,
  defuseLookalikes,
  resetFlood: () => floodHits.clear(),
  resetUsername: () => { cachedUsername = null; },
};
