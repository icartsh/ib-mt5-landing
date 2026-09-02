import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

import { config, ROOT } from "./config.mjs";
import { saveLead, readLeads } from "./store.mjs";
import { buildLead, isHoneypotHit, validateLead } from "./lead-core.mjs";
import { deliverLead, summarize } from "./sinks.mjs";
import { handleUpdate } from "./telegram-inquiry.mjs";

const PUBLIC_DIR = join(ROOT, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/* -------------------------------------------------------------------- */
/* 유틸                                                                  */
/* -------------------------------------------------------------------- */

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !config.allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

/* -------------------------------------------------------------------- */
/* 레이트 리밋 — 메모리 기반. 단일 인스턴스 프로토타입 기준.             */
/* -------------------------------------------------------------------- */

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

  // 오래된 IP 항목은 버려서 메모리가 무한히 늘지 않게 한다.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(key);
    }
  }
  return false;
}

/* 검증·조립은 server/lead-core.mjs 가 담당한다 (서버리스 함수와 같은 규칙을 쓰기 위해). */

async function readBody(req, limitBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/* -------------------------------------------------------------------- */
/* 핸들러                                                                */
/* -------------------------------------------------------------------- */

/**
 * 고객 문의 봇 webhook. 판단 로직은 telegram-inquiry.mjs 가 갖고 있고,
 * 여기서는 "진짜 텔레그램이 보낸 것인가" 만 확인한다. api/telegram.js 와 같은 규칙이다 —
 * 비밀값이 없으면 열지 않고, 처리에 실패해도 200 으로 답한다(재전송 폭주 방지).
 */
async function telegramWebhook(req, res) {
  if (!config.telegramWebhookSecret) {
    return sendJson(res, 503, { ok: false, error: "webhook secret unset" });
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== config.telegramWebhookSecret) {
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }

  let update;
  try {
    update = JSON.parse(await readBody(req, 1024 * 1024));
  } catch {
    return sendJson(res, 200, { ok: true, action: "bad_body" });
  }

  try {
    const result = await handleUpdate(update);
    console.log(`[telegram] ${result.action}${result.detail ? ` ${result.detail}` : ""}`);
    return sendJson(res, 200, { ok: true, action: result.action });
  } catch (err) {
    console.error("[telegram] 처리 중 오류", err);
    return sendJson(res, 200, { ok: true, action: "error" });
  }
}

async function handleLead(req, res) {
  const cors = corsHeaders(req);
  const ip = clientIp(req);

  if (rateLimited(ip)) {
    return sendJson(res, 429, { ok: false, error: "잠시 후 다시 시도해 주세요." }, cors);
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { ok: false, error: "요청을 읽지 못했습니다." }, cors);
  }

  // 허니팟: 사람에게 보이지 않는 필드가 채워져 있으면 봇이다.
  // 봇에게는 성공한 것처럼 응답해서 재시도를 유도하지 않는다.
  if (isHoneypotHit(body)) {
    console.log(`[lead] honeypot 차단 ip=${ip}`);
    return sendJson(res, 200, { ok: true, id: "skipped" }, cors);
  }

  const { errors } = validateLead(body);
  if (errors.length) {
    return sendJson(res, 400, { ok: false, error: errors[0], errors }, cors);
  }

  const lead = buildLead(body, {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    userAgent: req.headers["user-agent"] ?? "",
  });

  // 원장이 먼저다. 여기 실패하면 리드를 잃으므로 그때만 사용자에게 에러를 낸다.
  try {
    await saveLead(lead);
  } catch (err) {
    console.error("[lead] 저장 실패", err);
    return sendJson(res, 500, { ok: false, error: "저장에 실패했습니다." }, cors);
  }

  // 시트·알림은 원장 기록 이후. 전부 실패해도 리드는 이미 안전하므로 성공으로 답한다
  // (사용자가 재제출할 이유가 없다).
  const { results } = await deliverLead(lead);

  console.log(`[lead] 저장 완료 id=${lead.id} 채널=${lead.source} ${summarize(results)}`);

  return sendJson(res, 200, { ok: true, id: lead.id }, cors);
}

async function handleAdmin(req, res, url) {
  if (!config.adminToken) {
    res.writeHead(404).end("not found");
    return;
  }
  if (url.searchParams.get("token") !== config.adminToken) {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("unauthorized");
    return;
  }

  const leads = await readLeads(200);
  const rows = leads
    .map((l) => {
      const utm = l.attribution?.utm ?? {};
      const channel = [utm.utm_source, utm.utm_medium, utm.utm_campaign]
        .filter(Boolean)
        .join(" / ");
      return `<tr>
        <td class="mono">${escapeHtml(l.receivedAt)}</td>
        <td>${escapeHtml(l.name)}</td>
        <td class="mono">${escapeHtml(l.contact)}</td>
        <td>${escapeHtml(l.experience)}</td>
        <td>${escapeHtml(l.source)}</td>
        <td class="mono">${escapeHtml(channel || "직접 유입")}</td>
        <td class="mono id">${escapeHtml(l.id)}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>리드 목록 (${leads.length})</title>
<style>
 body{font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;margin:0;padding:24px;background:#f5f7f9;color:#10151c}
 h1{font-size:20px;margin:0 0 4px} p.meta{margin:0 0 18px;color:#6b7683;font-size:13px}
 table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
 th,td{padding:10px 12px;text-align:left;font-size:13.5px;border-bottom:1px solid #eef1f4;white-space:nowrap}
 th{background:#14263f;color:#fff;font-size:12.5px;letter-spacing:.02em}
 tr:last-child td{border-bottom:0}
 .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:#39434f}
 .id{color:#9aa4b0}
 .empty{padding:28px;text-align:center;color:#6b7683;background:#fff;border-radius:10px}
 .wrapper{overflow-x:auto}
</style></head><body>
<h1>리드 목록</h1>
<p class="meta">총 ${leads.length}건 · 최신순 · 저장소: ${escapeHtml(config.leadsFile)}</p>
${
  leads.length
    ? `<div class="wrapper"><table>
<thead><tr><th>접수 시각(UTC)</th><th>이름</th><th>연락처</th><th>거래 경험</th><th>유입 경로</th><th>utm 채널</th><th>리드 ID</th></tr></thead>
<tbody>${rows}</tbody></table></div>`
    : `<div class="empty">아직 접수된 리드가 없습니다.</div>`
}
</body></html>`;

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  // 경로 탈출 방지: 정규화 후 반드시 public 아래여야 한다.
  let filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  /* Vercel 의 cleanUrls 와 동작을 맞춘다 — 배포에서는 `/broker` 가 broker.html 로 뜬다.
     로컬만 404 가 나면 링크를 확인할 방법이 없어서, 결국 배포한 뒤에 눌러보게 된다. */
  if (!extname(filePath)) {
    try {
      const info = await stat(`${filePath}.html`);
      if (info.isFile()) filePath = `${filePath}.html`;
    } catch {
      /* 확장자 없는 경로에 대응하는 html 이 없으면 원래 경로 그대로 404 를 낸다 */
    }
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");

    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": info.size,
      // config.js 는 배포마다 값이 달라지므로 캐시하지 않는다.
      "Cache-Control": ext === ".html" || filePath.endsWith("config.js") ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
  }
}

/* -------------------------------------------------------------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "OPTIONS" && url.pathname === "/api/lead") {
      res.writeHead(204, corsHeaders(req)).end();
      return;
    }
    if (url.pathname === "/api/lead") {
      if (req.method !== "POST") {
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }
      return await handleLead(req, res);
    }
    /* 고객 문의 봇 webhook. 로컬에서도 같은 경로로 받게 해 두면 ngrok 등으로 붙여
       실제 봇으로 손검증할 수 있다. 서버리스 배포에서는 api/telegram.js 가 같은 일을 한다. */
    if (url.pathname === "/api/telegram") {
      if (req.method !== "POST") {
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }
      return await telegramWebhook(req, res);
    }
    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        notifyKind: config.notifyKind,
        sheetsConfigured: Boolean(config.sheetsWebhookUrl),
      });
    }
    if (url.pathname === "/admin" || url.pathname === "/admin/leads") {
      return await handleAdmin(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error("[server] 처리 중 오류", err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server error" });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`IB 랜딩 서버 실행 중 → http://${config.host}:${config.port}`);
  console.log(`  리드 저장: ${config.leadsFile}`);
  console.log(`  구글 시트: ${config.sheetsWebhookUrl ? "설정됨" : "미설정"}`);
  console.log(`  알림 채널: ${config.notifyKind}`);
  console.log(`  리드 확인 화면: ${config.adminToken ? `/admin?token=…` : "미설정(ADMIN_TOKEN 없음)"}`);
});
