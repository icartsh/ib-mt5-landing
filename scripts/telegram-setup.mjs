/**
 * 텔레그램 설정을 점검하고, 고객 문의 봇의 webhook 을 등록/조회/해제한다. (IB-10)
 *
 *   node scripts/telegram-setup.mjs doctor    ← 무엇이 남았는지부터 본다
 *   node scripts/telegram-setup.mjs status
 *   node scripts/telegram-setup.mjs set https://ib-mt5-landing.vercel.app/api/telegram
 *   node scripts/telegram-setup.mjs delete
 *
 * ## 왜 스크립트로 만들어 두는가
 *
 * webhook 등록은 브라우저 주소창에 토큰이 박힌 URL 을 치는 방식으로도 된다. 그러면 그
 * 토큰이 방문 기록과 자동완성에 남는다. 봇 토큰 하나면 그 봇으로 아무에게나 메시지를
 * 보낼 수 있다 — 우리 경우 고객 대화 전부가 거기 붙어 있다.
 *
 * 그리고 이 절차는 한 번 하고 잊는 종류인데, 잊은 뒤에 도메인이 바뀌면 문의가 조용히
 * 끊긴다(텔레그램은 옛 주소로 계속 던지고, 아무 데도 오류가 안 뜬다). `status` 가
 * 지금 어디로 가고 있는지와 최근 배달 오류를 같이 보여주는 이유다.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { config, ROOT, resolveInquiryBot } from "../server/config.mjs";

const API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
/* 전용 문의 봇이 없으면 알림 봇을 같이 쓴다(chat_id 가 고정돼 있을 때만). 판정 기준은
   server/config.mjs 의 resolveInquiryBot() 에 적어 두었다. */
const { token, shared: sharedInquiryBot } = resolveInquiryBot();
const secret = config.telegramWebhookSecret;

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const [command, arg] = process.argv.slice(2);

/* doctor 는 "무엇이 아직 없는가" 를 알려 주는 명령이라 토큰이 없어도 돌아야 한다.
   나머지 명령은 토큰 없이는 할 일이 없다. */
if (!token && command !== "doctor") {
  die("TELEGRAM_INQUIRY_BOT_TOKEN 이 없습니다. .env 또는 배포 환경변수에 넣어 주세요. (진단: npm run telegram -- doctor)");
}

async function call(method, body) {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) die(`${method} 실패: ${data?.description || `HTTP ${res.status}`}`);
  return data.result;
}

/* ------------------------------------------------------------------ */
/* doctor — 켜는 데 남은 일이 무엇인지 한 번에 본다                     */
/* ------------------------------------------------------------------ */

/**
 * ## 왜 이 명령이 있나
 *
 * 텔레그램 설정은 값 네 개(알림 봇 토큰 / chat_id / 문의 봇 토큰 / webhook 비밀값)와
 * 손동작 두 개(두 봇에 START, webhook 등록)로 이뤄진다. 여섯 개 중 하나만 빠져도
 * **화면에는 아무 이상이 없다.** 버튼은 그대로 눌리고, 고객 쪽에는 전송된 것으로 보이고,
 * 오류 로그도 안 남는다. 빠진 것이 무엇이냐에 따라 결과만 조용히 달라진다 —
 * 문의가 사라지거나, 리드 접수가 멈추거나, 답장이 안 나간다.
 *
 * 그래서 "무엇이 빠졌는지" 를 사람이 여섯 군데를 돌아보며 확인하게 두지 않는다.
 * 이 명령 하나가 여섯 개를 다 짚고, 남은 것만 순서대로 알려 준다.
 *
 * chat_id 를 여기서 찾아 주는 이유도 같다. 문서대로 하면 브라우저 주소창에 토큰이 박힌
 * `api.telegram.org/bot<토큰>/getUpdates` 를 쳐야 하고, 그 토큰이 방문 기록과 자동완성에
 * 남는다. 봇 토큰 하나면 그 봇으로 아무에게나 메시지를 보낼 수 있다.
 */
const remaining = [];

/** 결과를 돌려주는 호출. doctor 는 실패해도 계속 가야 하므로 die 하지 않는다. */
async function ask(botToken, method, query = "") {
  try {
    const res = await fetch(`${API_BASE}/bot${botToken}/${method}${query}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok) return { ok: false, error: data?.description || `HTTP ${res.status}`, code: data?.error_code ?? res.status };
    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, error: err.message, code: 0 };
  }
}

async function doctor() {
  console.log("텔레그램 설정 점검\n");

  /* --- 1. 알림 봇: 서버 → 사장님 -------------------------------------- */
  console.log("1) 알림 봇 (리드 신청 알림, 주소 비공개)");
  let alertBotUsername = "";
  if (!config.telegramBotToken) {
    console.log("   ✗ TELEGRAM_BOT_TOKEN 없음 — 신청 폼이 리드를 아무 데도 남기지 못해 접수 자체를 거절한다.");
    remaining.push("TELEGRAM_BOT_TOKEN 을 넣는다 (@BotFather → @icartsh_answer_bot → API Token).");
  } else {
    const me = await ask(config.telegramBotToken, "getMe");
    if (!me.ok) {
      console.log(`   ✗ 토큰이 동작하지 않는다 — ${me.error}`);
      remaining.push("TELEGRAM_BOT_TOKEN 값을 다시 확인한다 (오타이거나 무효화된 토큰).");
    } else {
      alertBotUsername = me.result.username || "";
      console.log(`   ✓ @${alertBotUsername}`);
    }
  }

  /* --- 2. chat_id: 알림·문의가 도착할 곳 ------------------------------ */
  console.log("\n2) 사장님 chat_id (알림이 갈 곳 / 문의 중계의 목적지)");
  if (config.telegramChatId) {
    console.log(`   ✓ 고정됨 (${config.telegramChatId}) — 자동 탐색 잠금에 걸릴 일이 없다.`);
  } else if (!alertBotUsername) {
    console.log("   – 알림 봇 토큰이 없어서 확인하지 못했다.");
    remaining.push("알림 봇 토큰을 넣은 뒤 이 명령을 다시 돌려 chat_id 를 확인한다.");
  } else {
    const updates = await ask(config.telegramBotToken, "getUpdates", "?limit=100");
    if (!updates.ok) {
      /* 409 = 이 봇에 webhook 이 걸려 있다. 알림 봇에는 걸면 안 된다(자동 탐색이 막힌다). */
      console.log(`   ✗ 대화를 읽지 못했다 — ${updates.error}`);
      remaining.push("TELEGRAM_CHAT_ID 를 직접 넣는다.");
    } else {
      const chats = [];
      for (const u of updates.result) {
        const chat = u?.message?.chat ?? u?.channel_post?.chat;
        if (!chat?.id) continue;
        const id = String(chat.id);
        if (!chats.some((c) => c.id === id)) {
          chats.push({ id, who: chat.username ? `@${chat.username}` : chat.first_name || chat.title || "이름 없음" });
        }
      }

      if (chats.length === 0) {
        console.log("   ✗ 이 봇에 온 대화가 없다 — 알림이 갈 곳을 못 찾아 리드 접수가 멈춘다.");
        remaining.push(`텔레그램에서 @${alertBotUsername} 에게 아무 말이나 한 번 보낸 뒤 이 명령을 다시 돌린다.`);
      } else if (chats.length === 1) {
        console.log(`   ▸ 후보 하나: ${chats[0].id} (${chats[0].who})`);
        console.log("     지금은 자동 탐색으로 돌아가지만, 고정해 두는 편이 낫다 — 이 봇에 다른 사람이");
        console.log("     말을 거는 순간 후보가 둘이 되고 그때부터 리드 접수가 멈춘다.");
        remaining.push(`TELEGRAM_CHAT_ID=${chats[0].id} 를 환경변수에 넣는다.`);
      } else {
        console.log(`   ✗ 후보가 ${chats.length}개다 — 목적지를 확정할 수 없어 리드 접수가 멈춰 있다.`);
        for (const c of chats) console.log(`     - ${c.id} (${c.who})`);
        remaining.push("이 중 사장님 것을 골라 TELEGRAM_CHAT_ID 에 넣는다. 이것부터 해야 접수가 다시 열린다.");
      }
    }
  }

  /* --- 3. 문의 봇: 고객 → 사장님 -------------------------------------- */
  console.log("\n3) 문의 봇 (페이지의 '텔레그램 문의' 버튼이 향하는 곳)");
  /* 경로를 열어 둔 것은 테스트에서 다른 config.js 를 물리기 위해서다. 운영에서는 기본값. */
  const pageConfigPath = process.env.PAGE_CONFIG_PATH || join(ROOT, "public", "config.js");
  const pageBot = (
    readFileSync(pageConfigPath, "utf8").match(/telegramUrl:\s*"[^"]*t\.me\/([A-Za-z0-9_]+)/) || []
  )[1] || "";
  console.log(
    `   페이지가 가리키는 봇: ${pageBot ? `@${pageBot} (config.js 에 직접 적혀 있음)` : "(비어 있음 — /api/health 에 물어서 정한다)"}`
  );

  let inquiryBotUsername = "";
  if (!token) {
    /* 토큰이 없는 경우는 두 가지고, 남은 할 일이 서로 다르다. 알림 봇 토큰조차 없으면
       봇부터 붙여야 하고, 알림 봇은 있는데 chat_id 가 비어 있으면 같이 쓰기 위한
       조건(목적지 고정)만 채우면 된다 — 새 토큰을 받으러 갈 필요가 없다. */
    console.log("   ✗ 문의를 읽을 봇이 없다 — 고객이 봇에 남긴 문의를 아무도 읽지 못한다.");
    console.log("     고객 화면에는 정상 전송으로 보이므로, 답을 기다리다 그냥 떠난다.");
    if (config.telegramBotToken && !config.telegramChatId) {
      console.log("     알림 봇은 있다. TELEGRAM_CHAT_ID 만 고정하면 그 봇을 문의용으로 같이 쓴다.");
      remaining.push("TELEGRAM_CHAT_ID 를 고정한다 (2번). 그러면 알림 봇이 문의도 받는다.");
    } else {
      remaining.push(`@BotFather → /mybots → ${pageBot ? `@${pageBot}` : "문의 봇"} → API Token 을 TELEGRAM_INQUIRY_BOT_TOKEN 에 넣는다.`);
    }
  } else {
    const me = await ask(token, "getMe");
    if (!me.ok) {
      console.log(`   ✗ 토큰이 동작하지 않는다 — ${me.error}`);
      remaining.push(sharedInquiryBot ? "TELEGRAM_BOT_TOKEN 값을 다시 확인한다." : "TELEGRAM_INQUIRY_BOT_TOKEN 값을 다시 확인한다.");
    } else {
      inquiryBotUsername = me.result.username || "";
      console.log(`   ✓ 문의를 읽는 봇: @${inquiryBotUsername}${sharedInquiryBot ? " (알림 봇과 같은 봇)" : " (전용 문의 봇)"}`);

      /* 같은 봇인지는 어느 환경변수에 넣었는지가 아니라 **실제 봇 이름**으로 판정한다.
         전용 변수에 알림 봇 토큰을 넣어 두면 변수만 봐서는 분리된 것처럼 보인다. */
      const sameBot =
        alertBotUsername && inquiryBotUsername.toLowerCase() === alertBotUsername.toLowerCase();

      if (sameBot) {
        /* 같은 봇을 쓰는 것 자체는 사고가 아니다. 사고는 목적지 자동 탐색과 겹칠 때만
           일어난다 — 고객이 봇 대화 목록에 들어오고 자동 탐색이 그 고객을 고르면
           신청자의 이름과 전체 전화번호가 낯선 사람에게 간다. chat_id 가 박혀 있으면
           목적지가 하나로 고정돼 그 경로가 막힌다(server/config.mjs). */
        if (config.telegramChatId) {
          console.log("     알림 봇과 같은 봇이지만 목적지가 고정돼 있어 리드가 샐 수 없다.");
          console.log("     운영자 대화 하나에 리드 알림과 고객 문의가 같이 들어온다.");
        } else {
          console.log("   ✗ 알림 봇과 같은 봇인데 목적지가 자동 탐색이다 — 이 조합은 안 된다.");
          console.log("     고객이 알림 봇 대화 목록에 들어오고, 다음 리드 알림이 신청자의 이름과");
          console.log("     전체 전화번호를 달고 그 고객에게 갈 수 있다.");
          remaining.push("TELEGRAM_CHAT_ID 를 고정하거나, 문의를 다른 봇으로 받는다 (docs/telegram-inquiry.md).");
        }
      }
      if (pageBot && inquiryBotUsername.toLowerCase() !== pageBot.toLowerCase()) {
        console.log(`   ✗ 페이지는 @${pageBot} 을 가리키는데 문의를 읽는 봇은 @${inquiryBotUsername} 이다 — 문의가 도착하지 않는다.`);
        remaining.push(`public/config.js 의 telegramUrl 을 https://t.me/${inquiryBotUsername} 로 맞춘다.`);
      }
      if (!pageBot) {
        /* 비어 있는 것이 기본값이다 — links.js 가 /api/health 에게 물어서 이 봇을 건다.
           손으로 맞출 것이 없으므로 남은 할 일도 아니다. */
        console.log(`   ✓ 페이지는 주소를 적어 두지 않고 서버에 물어본다 — @${inquiryBotUsername} 이 걸린다.`);
      }
    }
  }

  /* --- 4. webhook 비밀값 ---------------------------------------------- */
  console.log("\n4) webhook 비밀값 (공개 주소인 /api/telegram 의 자물쇠)");
  if (secret) {
    console.log("   ✓ 설정됨");
  } else {
    console.log("   ✗ 없음 — /api/telegram 이 503 으로 닫혀 있어 문의가 전달되지 않는다.");
    console.log("     (확인 없이 열면 누구나 가짜 문의 카드를 만들어 넣을 수 있고, 거기 답장하면");
    console.log("      답변이 그 사람에게 간다. 그래서 값이 없으면 아예 열지 않는다.)");
    console.log(`     쓸 수 있는 값: TELEGRAM_WEBHOOK_SECRET=${randomBytes(24).toString("hex")}`);
    remaining.push("위 TELEGRAM_WEBHOOK_SECRET 값을 환경변수와 로컬 .env 에 같이 넣는다.");
  }

  /* --- 5. webhook 등록 + 사장님이 문의 봇에 START 했는가 -------------- */
  console.log("\n5) webhook 등록 상태");
  if (!inquiryBotUsername) {
    console.log("   – 문의 봇 토큰이 없어서 확인하지 못했다.");
  } else {
    const info = await ask(token, "getWebhookInfo");
    if (!info.ok) {
      console.log(`   ✗ 확인 실패 — ${info.error}`);
    } else if (!info.result.url) {
      console.log("   ✗ 등록 안 됨 — 버튼은 살아 있는데 그 끝이 비어 있다.");
      remaining.push("배포 뒤: npm run telegram -- set https://ib-mt5-landing.vercel.app/api/telegram");
    } else {
      console.log(`   ✓ ${info.result.url}`);
      if (info.result.last_error_message) {
        console.log(`   ⚠️ 최근 배달 오류: ${info.result.last_error_message}`);
        remaining.push("배달 오류를 확인한다 (도메인이 바뀌었으면 set 을 다시 돌린다).");
      }
    }

  }

  /* --- 6. 사장님이 문의 봇에 START 를 눌렀는가 ------------------------ */
  /* 안 눌렀으면 문의 카드가 도착하지 못한다 — 텔레그램은 사람이 먼저 말을 건 상대에게만
     봇이 메시지를 보낼 수 있다. sendChatAction 은 화면에 아무것도 남기지 않으면서
     그 가능 여부만 확인해 준다. 실제로 메시지를 보내 보는 것이 유일한 대안인데,
     그러면 점검할 때마다 사장님 대화에 잡음이 쌓인다. */
  console.log("\n6) 사장님이 문의 봇에 START 를 눌렀는가");
  if (!inquiryBotUsername || !config.telegramChatId) {
    console.log("   – 문의 봇 토큰과 chat_id 가 모두 있어야 확인할 수 있다 (2·3번 먼저).");
  } else {
    const probe = await ask(token, "sendChatAction", `?chat_id=${encodeURIComponent(config.telegramChatId)}&action=typing`);
    if (probe.ok) {
      console.log("   ✓ 문의 카드가 사장님에게 도착할 수 있다.");
    } else {
      console.log(`   ✗ 지금은 도착하지 못한다 — ${probe.error}`);
      remaining.push(`텔레그램에서 @${inquiryBotUsername} 을 열고 START 를 누른다.`);
    }
  }

  /* --- 마무리 ---------------------------------------------------------- */
  console.log("");
  if (remaining.length === 0) {
    console.log("✓ 남은 것 없음. 배포 후 /api/health 의 sinks.inquiry.ready 가 true 인지만 확인하면 된다.");
    return;
  }
  console.log(`남은 일 ${remaining.length}가지 (순서대로):`);
  remaining.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  console.log("\n환경변수는 새 배포부터 적용된다. 값을 다 넣은 뒤 재배포하고 이 명령을 다시 돌린다.");
}

if (command === "status") {
  const me = await call("getMe");
  const info = await call("getWebhookInfo");

  console.log(`봇: @${me.username} (${me.first_name})`);
  console.log(`webhook 주소: ${info.url || "(등록 안 됨 — 문의가 아무 데도 전달되지 않습니다)"}`);
  /* 텔레그램은 등록된 secret_token 값을 되돌려주지 않는다(값 자체도, 설정 여부도).
     그래서 우리 쪽 설정 유무만 보고한다 — 값이 서로 어긋났는지는 아래 배달 오류로 드러난다. */
  console.log(
    `우리 쪽 비밀 토큰: ${secret ? "설정됨" : "없음 → /api/telegram 이 503 을 돌려주고 문의가 전달되지 않습니다"}`
  );
  console.log(`대기 중인 업데이트: ${info.pending_update_count}`);
  if (info.last_error_message) {
    console.log(`⚠️ 최근 배달 오류: ${info.last_error_message} (${new Date(info.last_error_date * 1000).toISOString()})`);
  }
  if (!config.telegramChatId) {
    console.log("⚠️ TELEGRAM_CHAT_ID 가 없습니다 — 문의를 전달할 곳이 없어 중계가 동작하지 않습니다.");
  }
  process.exit(0);
}

if (command === "set") {
  if (!arg) die("webhook 주소를 인자로 주세요. 예: node scripts/telegram-setup.mjs set https://<도메인>/api/telegram");
  if (!arg.startsWith("https://")) die("텔레그램은 https 주소만 받습니다.");
  if (!secret) die("TELEGRAM_WEBHOOK_SECRET 이 없습니다. 먼저 긴 무작위 값을 만들어 넣어 주세요 (예: openssl rand -hex 24).");

  await call("setWebhook", {
    url: arg,
    secret_token: secret,
    /* 메시지만 받는다. 우리가 쓰지 않는 종류까지 받으면 운영자 화면에 잡음만 는다. */
    allowed_updates: ["message", "edited_message"],
    /* 등록 전에 쌓여 있던 것은 버린다. 며칠 전 문의에 지금 답장하면 오히려 이상하다. */
    drop_pending_updates: true,
  });
  console.log(`✓ webhook 등록됨 → ${arg}`);
  console.log("  이제 봇에게 아무 말이나 보내 보세요. 운영자 대화에 문의 카드가 올라와야 합니다.");
  process.exit(0);
}

if (command === "delete") {
  await call("deleteWebhook", { drop_pending_updates: false });
  console.log("✓ webhook 해제됨 — 이제 이 봇에 온 문의는 아무도 읽지 않습니다.");
  process.exit(0);
}

if (command === "doctor") {
  await doctor();
  process.exit(remaining.length ? 1 : 0);
}

console.log("사용법: node scripts/telegram-setup.mjs <doctor|status|set <https URL>|delete>");
process.exit(1);
