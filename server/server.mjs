import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

import { config, ROOT } from "./config.mjs";
import { saveLead, readLeads } from "./store.mjs";
import { notifyLead } from "./notify.mjs";

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

/* -------------------------------------------------------------------- */
/* 검증 — 클라이언트 검증을 신뢰하지 않고 서버에서 다시 본다.            */
/* -------------------------------------------------------------------- */

const EXPERIENCES = new Set(["입문", "경험 있음"]);
const SOURCES = new Set([
  "네이버 블로그", "인스타그램", "유튜브", "네이버 검색", "지인 소개", "기타",
]);

function validateLead(body) {
  const errors = [];
  const name = String(body?.name ?? "").trim();
  const contact = String(body?.contact ?? "").trim();
  const experience = String(body?.experience ?? "").trim();
  const source = String(body?.source ?? "").trim();

  if (name.length < 2 || name.length > 40) errors.push("이름을 확인해 주세요.");

  const digits = contact.replace(/[\s.\-()]/g, "");
  if (!/^\+?\d{9,15}$/.test(digits)) errors.push("연락처 형식을 확인해 주세요.");

  if (!EXPERIENCES.has(experience)) errors.push("거래 경험 수준을 선택해 주세요.");
  if (!SOURCES.has(source)) errors.push("유입 경로를 선택해 주세요.");
  if (body?.consent !== true) errors.push("개인정보 수집·이용 동의가 필요합니다.");

  return { errors, clean: { name, contact, contactNormalized: digits, experience, source } };
}

function pickUtm(attribution) {
  const utm = attribution?.utm ?? {};
  const out = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const value = utm[key];
    if (typeof value === "string" && value) out[key] = value.slice(0, 120);
  }
  return out;
}

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
  if (String(body?.company ?? "").trim()) {
    console.log(`[lead] honeypot 차단 ip=${ip}`);
    return sendJson(res, 200, { ok: true, id: "skipped" }, cors);
  }

  const { errors, clean } = validateLead(body);
  if (errors.length) {
    return sendJson(res, 400, { ok: false, error: errors[0], errors }, cors);
  }

  const lead = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    ...clean,
    consent: true,
    consentText: "개인정보 수집·이용 동의 (이름·연락처·거래 경험·유입 경로 / 상담 연락 목적 / 상담 종료 후 6개월)",
    attribution: {
      utm: pickUtm(body?.attribution),
      referrer: String(body?.attribution?.referrer ?? "").slice(0, 300),
      landingPath: String(body?.attribution?.landingPath ?? "").slice(0, 300),
    },
    page: String(body?.page ?? "").slice(0, 500),
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
  };

  let stored;
  try {
    stored = await saveLead(lead);
  } catch (err) {
    console.error("[lead] 저장 실패", err);
    return sendJson(res, 500, { ok: false, error: "저장에 실패했습니다." }, cors);
  }

  // 알림은 저장 성공 이후. 알림이 실패해도 사용자에게는 성공으로 응답한다
  // (리드는 이미 안전하게 남았고, 사용자가 재제출할 이유가 없다).
  const notified = await notifyLead(lead);

  console.log(
    `[lead] 저장 완료 id=${lead.id} utm=${JSON.stringify(lead.attribution.utm)} ` +
      `sheets=${stored.remote.attempted ? stored.remote.ok : "skip"} ` +
      `notify=${notified.attempted ? `${notified.kind}:${notified.ok}` : "skip"}` +
      `${notified.attempted && !notified.ok ? ` (${notified.detail})` : ""}`
  );

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
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
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
