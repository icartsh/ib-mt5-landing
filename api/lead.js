/**
 * POST /api/lead — 서버리스(Vercel) 리드 접수 엔드포인트.
 *
 * 로컬 서버(server/server.mjs)와 검증·조립 로직을 공유하고(server/lead-core.mjs),
 * 저장/알림도 같은 sink 를 쓴다(server/sinks.mjs). 다른 점은 딱 하나다:
 *
 *   여기에는 로컬 JSONL 원장이 없다. 서버리스 디스크는 호출이 끝나면 사라진다.
 *
 * 그래서 응답 규칙이 로컬과 반대다. 로컬에서는 원장에 썼으면 알림이 실패해도
 * 성공으로 답했지만, 여기서는 리드를 다시 읽을 수 있는 곳(텔레그램/시트) 중
 * 최소 한 곳이 성공해야만 성공으로 답한다. 아무 데도 안 남았는데 "접수되었습니다"
 * 라고 답하면 그 사람은 오지 않는 전화를 기다리게 된다.
 */
import { randomUUID } from "node:crypto";

import { config } from "../server/config.mjs";
import { buildLead, isHoneypotHit, validateLead } from "../server/lead-core.mjs";
import { deliverLead, summarize } from "../server/sinks.mjs";

/* 웜 인스턴스 한정 레이트리밋. 인스턴스가 여러 개면 그만큼 느슨해지지만,
   단순 반복 제출은 대부분 같은 인스턴스로 떨어져서 실효가 있다. */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const { windowMs, max } = config.rateLimit;

  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);

  if (hits.size > 2000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(key);
    }
  }
  return false;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
  }
}

async function readBody(req) {
  // Vercel 은 보통 JSON 을 미리 파싱해 준다. 안 해 준 경우를 대비해 직접도 읽는다.
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error("payload too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: "잠시 후 다시 시도해 주세요." });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: "요청을 읽지 못했습니다." });
  }

  // 봇에게는 성공한 척 응답한다. 실패를 알려주면 형태를 바꿔 가며 다시 온다.
  if (isHoneypotHit(body)) {
    console.log(`[lead] honeypot 차단 ip=${ip}`);
    return res.status(200).json({ ok: true, id: "skipped" });
  }

  const { errors } = validateLead(body);
  if (errors.length) {
    return res.status(400).json({ ok: false, error: errors[0], errors });
  }

  const lead = buildLead(body, {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    userAgent: req.headers["user-agent"] || "",
  });

  const { results, durableConfigured, durableOk } = await deliverLead(lead);

  if (!durableOk) {
    // 리드를 담을 곳이 하나도 없었다. 사용자에게 사실대로 말하고 재시도를 받는다.
    console.error(
      `[lead] 저장 실패 — durable sink 없음/전부 실패 id=${lead.id} ${summarize(results)}`
    );
    return res.status(503).json({
      ok: false,
      /* 설정이 아예 없는 상태는 재시도로 풀리지 않는다. 그 경우에 "잠시 후 다시
         시도해 주세요" 라고 하면, 몇 번을 눌러도 같은 화면을 보는 사람을 붙잡아
         두는 것밖에 안 된다. 다시 오게 만드는 쪽이 정직하고 리드도 덜 잃는다. */
      error: durableConfigured
        ? "일시적인 문제로 접수하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : "접수 설정이 완료되지 않았습니다. 지금은 신청을 받을 수 없습니다.",
    });
  }

  console.log(`[lead] 접수 id=${lead.id} 채널=${lead.source} ${summarize(results)}`);
  return res.status(200).json({ ok: true, id: lead.id });
}
