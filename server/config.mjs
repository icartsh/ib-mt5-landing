import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * .env 를 아주 얕게 읽는다. 의존성 없이 돌리기 위한 최소 구현이라
 * 따옴표 제거와 주석 무시까지만 지원한다.
 */
function loadDotEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 실제 환경변수가 이미 있으면 그쪽이 이긴다 (배포 환경 우선).
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "127.0.0.1",

  /** 로컬 원장(ledger). 어떤 원격 저장소를 쓰든 항상 여기에도 남긴다. */
  leadsFile: process.env.LEADS_FILE || join(ROOT, "data", "leads.jsonl"),

  /**
   * Google Apps Script 웹앱 URL (시트 저장용). 비어 있으면 시트 저장을 건너뛴다.
   * 스크립트 원본은 docs/google-sheets-webhook.gs 참고.
   */
  sheetsWebhookUrl: process.env.SHEETS_WEBHOOK_URL || "",

  /** 알림 채널: slack | discord | telegram | generic | none */
  notifyKind: (process.env.NOTIFY_KIND || "none").toLowerCase(),
  notifyWebhookUrl: process.env.NOTIFY_WEBHOOK_URL || "",
  /**
   * 리드 알림을 보내는 봇. **이 봇 주소는 어디에도 공개하지 않는다** —
   * 공개하면 고객이 이 봇 대화 목록에 들어오고, chat_id 자동 탐색이 그 고객을 고를 수 있다.
   * 고객 문의는 아래 telegramInquiryBotToken 쪽 봇이 따로 받는다.
   */
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",

  /**
   * 알림이 도착할 운영자 chat_id. 비워 두면 알림 봇의 최근 대화에서 찾아내지만,
   * 그 자동 탐색은 대화가 정확히 하나일 때만 동작한다(sinks.mjs 참고).
   * 문의 중계(telegram-inquiry.mjs)는 이 값이 **반드시** 있어야 한다.
   */
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",

  /** 고객 문의를 받는 별도 봇. 이 주소만 페이지에 건다. 비어 있으면 중계가 꺼진다. */
  telegramInquiryBotToken: process.env.TELEGRAM_INQUIRY_BOT_TOKEN || "",

  /** setWebhook 의 secret_token. 없으면 /api/telegram 은 아예 열리지 않는다. */
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",

  /** /admin 리드 확인 화면 접근 토큰. 비어 있으면 화면 자체를 열지 않는다. */
  adminToken: process.env.ADMIN_TOKEN || "",

  /** 브라우저에서 다른 도메인의 페이지가 이 API 를 부를 때 허용할 오리진 (쉼표 구분) */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /** 같은 IP 에서 windowMs 동안 허용할 제출 횟수 */
  rateLimit: {
    windowMs: Number(process.env.RATE_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.RATE_MAX || 5),
  },
};
