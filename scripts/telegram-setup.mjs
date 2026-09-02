/**
 * 고객 문의 봇의 webhook 을 등록/조회/해제한다. (IB-10)
 *
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
import { config } from "../server/config.mjs";

const API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
const token = config.telegramInquiryBotToken;
const secret = config.telegramWebhookSecret;

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!token) die("TELEGRAM_INQUIRY_BOT_TOKEN 이 없습니다. .env 또는 배포 환경변수에 넣어 주세요.");

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

const [command, arg] = process.argv.slice(2);

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

console.log("사용법: node scripts/telegram-setup.mjs <status|set <https URL>|delete>");
process.exit(1);
