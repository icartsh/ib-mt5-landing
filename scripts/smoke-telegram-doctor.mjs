/**
 * `npm run telegram -- doctor` 검사.
 *
 * 가짜 텔레그램 API 를 띄우고 doctor 를 자식 프로세스로 돌려서, 설정 상태별로
 * **맞는 결론**을 내는지 본다. 특히 확인하고 싶은 것:
 *
 *   1. 두 봇이 같은 봇일 때 그것을 잡아내는가 (놓치면 신청자 전화번호가 고객에게 간다)
 *   2. 다 갖춰졌을 때 "남은 것 없음"(exit 0)이라고 말하는가 — 잘못 말하면 사장님이
 *      켜졌다고 믿고 광고를 태운다
 *   3. 페이지가 가리키는 봇과 토큰의 봇이 다를 때 잡아내는가
 *
 * 사용: node scripts/smoke-telegram-doctor.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8896;
const OWNER = "555000111";

/* 토큰 → 그 봇이 어떻게 행동하는지. 실제 텔레그램의 응답 형태만 흉내낸다. */
const BOTS = {
  "alert-token": { username: "icartsh_answer_bot" },
  "inquiry-token": { username: "icartsh_ib_bot" },
  "other-token": { username: "somebody_else_bot" },
};

let updates = [];        // 알림 봇 getUpdates 가 돌려줄 것
let webhookUrl = "";     // 문의 봇 getWebhookInfo 가 돌려줄 것
let ownerStarted = true; // 사장님이 문의 봇에 START 를 눌렀는가

const api = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const [, tokenPart, method] = url.pathname.split("/");
  const token = (tokenPart || "").replace(/^bot/, "");
  const bot = BOTS[token];

  const reply = (body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (!bot) return reply({ ok: false, error_code: 401, description: "Unauthorized" }, 401);

  if (method === "getMe") return reply({ ok: true, result: { username: bot.username, first_name: bot.username } });
  if (method === "getUpdates") return reply({ ok: true, result: updates });
  if (method === "getWebhookInfo") return reply({ ok: true, result: { url: webhookUrl, pending_update_count: 0 } });
  if (method === "sendChatAction") {
    if (!ownerStarted) {
      return reply(
        { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" },
        403
      );
    }
    return reply({ ok: true, result: true });
  }
  return reply({ ok: false, error_code: 404, description: `no such method: ${method}` }, 404);
});

await new Promise((r) => api.listen(PORT, "127.0.0.1", r));

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

/** doctor 를 깨끗한 환경에서 돌린다. .env 가 끼어들지 않도록 값을 전부 명시한다. */
function runDoctor(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, "scripts", "telegram-setup.mjs"), "doctor"], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        TELEGRAM_API_BASE: `http://127.0.0.1:${PORT}`,
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_CHAT_ID: "",
        TELEGRAM_INQUIRY_BOT_TOKEN: "",
        TELEGRAM_WEBHOOK_SECRET: "",
        ...env,
      },
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const READY = {
  TELEGRAM_BOT_TOKEN: "alert-token",
  TELEGRAM_CHAT_ID: OWNER,
  TELEGRAM_INQUIRY_BOT_TOKEN: "inquiry-token",
  TELEGRAM_WEBHOOK_SECRET: "secret-value",
};

console.log("\ndoctor — 다 갖춰진 상태");
webhookUrl = "https://ib-mt5-landing.vercel.app/api/telegram";
ownerStarted = true;
{
  const { code, out } = await runDoctor(READY);
  check("남은 것 없음으로 끝난다", code === 0, `exit=${code}`);
  check("문의 봇을 @icartsh_ib_bot 으로 읽는다", out.includes("@icartsh_ib_bot"));
  check("START 확인을 통과한다", out.includes("도착할 수 있다"));
}

console.log("\ndoctor — 두 봇이 같은 봇 (리드 유출 경로)");
{
  const { code, out } = await runDoctor({ ...READY, TELEGRAM_INQUIRY_BOT_TOKEN: "alert-token" });
  check("실패로 끝난다", code === 1, `exit=${code}`);
  check("같은 봇이라고 말한다", out.includes("알림 봇과 같은 봇"));
  check("전화번호가 샐 수 있다고 경고한다", out.includes("전체 전화번호"));
}

console.log("\ndoctor — 페이지가 가리키는 봇과 토큰의 봇이 다름");
{
  const { code, out } = await runDoctor({ ...READY, TELEGRAM_INQUIRY_BOT_TOKEN: "other-token" });
  check("실패로 끝난다", code === 1, `exit=${code}`);
  check("불일치를 짚는다", out.includes("문의가 도착하지 않는다"));
}

console.log("\ndoctor — 사장님이 문의 봇에 START 를 안 누름");
ownerStarted = false;
{
  const { code, out } = await runDoctor(READY);
  check("실패로 끝난다", code === 1, `exit=${code}`);
  check("START 를 누르라고 안내한다", out.includes("START 를 누른다"));
}
ownerStarted = true;

console.log("\ndoctor — chat_id 미고정, 알림 봇 대화가 하나");
updates = [{ message: { chat: { id: OWNER, first_name: "사장님" } } }];
{
  const { code, out } = await runDoctor({ ...READY, TELEGRAM_CHAT_ID: "" });
  check("실패로 끝난다(고정하라고 남긴다)", code === 1, `exit=${code}`);
  check("찾은 chat_id 를 그대로 알려 준다", out.includes(`TELEGRAM_CHAT_ID=${OWNER}`));
}

console.log("\ndoctor — chat_id 미고정, 대화가 둘 (접수 멈춘 상태)");
updates = [
  { message: { chat: { id: OWNER, first_name: "사장님" } } },
  { message: { chat: { id: "999888777", username: "customer" } } },
];
{
  const { code, out } = await runDoctor({ ...READY, TELEGRAM_CHAT_ID: "" });
  check("실패로 끝난다", code === 1, `exit=${code}`);
  check("후보가 둘이라 접수가 멈췄다고 말한다", out.includes("후보가 2개") && out.includes("접수가 멈춰"));
  check("두 후보를 다 보여 준다", out.includes(OWNER) && out.includes("999888777"));
}

console.log("\ndoctor — 토큰이 무효");
{
  const { code, out } = await runDoctor({ ...READY, TELEGRAM_BOT_TOKEN: "nope-token" });
  check("실패로 끝난다", code === 1, `exit=${code}`);
  check("토큰 문제라고 말한다", out.includes("토큰이 동작하지 않는다"));
}

/* ------------------------------------------------------------------ */

api.close();

console.log(`\n${pass}건 통과, ${failures.length}건 실패`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
