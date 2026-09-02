/**
 * 알림 채널 대역 수신기.
 *
 * 실제 슬랙/디스코드 웹훅 URL 을 아직 못 받은 상태에서도 "알림이 실제로 나가는가"를
 * 끝까지 검증하기 위한 것이다. 슬랙 incoming webhook 과 같은 규약(POST JSON)을 받고,
 * 받은 내용을 그대로 파일과 콘솔에 찍는다.
 *
 * 사용: node scripts/mock-webhook.mjs [port]
 * 그 다음 .env 에  NOTIFY_KIND=slack  NOTIFY_WEBHOOK_URL=http://127.0.0.1:9911/hook
 */
import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "data", "notifications.log");
const port = Number(process.argv[2] || 9911);

mkdirSync(dirname(LOG), { recursive: true });

createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("method not allowed");
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let text = raw;
  try {
    const parsed = JSON.parse(raw);
    text = parsed.text ?? parsed.content ?? raw;
  } catch {
    /* JSON 이 아니면 원문 그대로 남긴다 */
  }

  const entry =
    `\n===== 알림 수신 ${new Date().toISOString()} (${req.url}) =====\n${text}\n`;
  appendFileSync(LOG, entry, "utf8");
  process.stdout.write(entry);

  res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
}).listen(port, "127.0.0.1", () => {
  console.log(`알림 대역 수신기 실행 중 → http://127.0.0.1:${port}/hook`);
  console.log(`수신 기록: ${LOG}`);
});
