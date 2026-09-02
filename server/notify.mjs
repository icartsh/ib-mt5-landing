import { config } from "./config.mjs";

function maskContact(contact) {
  // 알림 채널(단톡/슬랙)에 전화번호 전체를 뿌리지 않는다. 뒤 4자리만 보여 준다.
  const digits = String(contact || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-****-${digits.slice(-4)}`;
}

function buildLines(lead) {
  const utm = lead.attribution?.utm || {};
  const channel =
    [utm.utm_source, utm.utm_medium, utm.utm_campaign].filter(Boolean).join(" / ") || "직접 유입";

  return [
    "🔔 새 상담 신청",
    `이름: ${lead.name}`,
    `연락처: ${maskContact(lead.contact)}  (전체 번호는 리드 목록에서 확인)`,
    `거래 경험: ${lead.experience}`,
    `유입 경로(응답): ${lead.source}`,
    `유입 채널(utm): ${channel}`,
    `접수 시각: ${lead.receivedAt}`,
    `리드 ID: ${lead.id}`,
  ];
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return true;
}

/**
 * 알림 전송. 채널이 설정돼 있지 않으면 조용히 skip 하고 그 사실을 돌려준다.
 * 알림 실패가 리드 저장을 되돌리지는 않는다 — 호출부에서 결과만 기록한다.
 */
export async function notifyLead(lead) {
  const text = buildLines(lead).join("\n");
  const kind = config.notifyKind;

  try {
    switch (kind) {
      case "slack":
        if (!config.notifyWebhookUrl) return { attempted: false, ok: false, kind, detail: "URL 미설정" };
        await post(config.notifyWebhookUrl, { text });
        break;

      case "discord":
        if (!config.notifyWebhookUrl) return { attempted: false, ok: false, kind, detail: "URL 미설정" };
        await post(config.notifyWebhookUrl, { content: text });
        break;

      case "telegram":
        if (!config.telegramBotToken || !config.telegramChatId) {
          return { attempted: false, ok: false, kind, detail: "봇 토큰/채팅 ID 미설정" };
        }
        await post(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
          chat_id: config.telegramChatId,
          text,
        });
        break;

      case "generic":
        if (!config.notifyWebhookUrl) return { attempted: false, ok: false, kind, detail: "URL 미설정" };
        await post(config.notifyWebhookUrl, { text, lead });
        break;

      case "none":
      default:
        return { attempted: false, ok: false, kind: "none", detail: "알림 채널 미설정" };
    }
    return { attempted: true, ok: true, kind, detail: "sent" };
  } catch (err) {
    return { attempted: true, ok: false, kind, detail: String(err?.message || err) };
  }
}
