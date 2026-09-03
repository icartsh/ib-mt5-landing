#!/usr/bin/env node
/*
 * preview — 발행 결과를 계정 없이 미리 보여준다.
 *
 * 왜 필요한가.
 *   계정을 만들기 전에는 "올리면 어떻게 보이는가"를 확인할 방법이 없다. 그런데
 *   그것을 확인하지 못한 채로 계정을 만들고 붙여넣으면, 잘못된 곳은 **발행 버튼을
 *   누른 뒤에** 드러난다. 이 저장소가 지금까지 세 번 겪은 사고가 전부 그 자리였다.
 *   이 스크립트는 발행 화면을 로컬에서 그려서 그 자리를 앞으로 당긴다.
 *
 * 무엇을 그리는가.
 *   1) 블로그 5편 — 네이버 블로그 글 화면(모바일 폭)으로 렌더한다.
 *      제목·대표이미지·본문·태그가 전부 `docs/publish-checklist.md` 에서 온다.
 *      체크리스트가 시키는 값 그대로 그리므로, 미리보기와 체크리스트는 어긋날 수 없다.
 *   2) 숏폼 1편(sf_001) — 채널 4곳의 게시물 화면. 커버는 mp4 의 0.5초 프레임이다.
 *
 * 일부러 하지 않는 것.
 *   플랫폼 UI 를 픽셀 단위로 흉내내지 않는다. 그건 진짜처럼 보이지만 실제와 다를 때
 *   확인한 셈이 되어 더 위험하다. 대신 **우리가 넣는 값**과 **그 값이 화면 어디에
 *   놓이는가**만 정확히 그린다.
 *
 * 쓰는 법.
 *   node scripts/preview.mjs          → dist/preview/*.html + *.png
 *   SHORTS_OUT=<dir> 로 mp4 위치를 지정할 수 있다(기본: shorts/out → ../shorts-render/out).
 *   mp4 가 없으면 숏폼 커버는 건너뛰고 블로그 미리보기는 그대로 만든다.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";

const OUT = "dist/preview";
const CHECKLIST = "docs/publish-checklist.md";
const PASTE_DIR = "dist/blog-html";
const THUMB_DIR = "dist/blog-thumb";

const BLOG_NAME = "IB 리서치팀";
const PUB_DATE = "2026. 9. 4.";

/* ── 체크리스트 파싱 ─────────────────────────────────────────────
 * 미리보기의 값은 전부 체크리스트에서 읽는다. 여기서 값을 따로 적으면
 * 두 문서가 갈라지고, 갈라진 것은 발행 뒤에야 드러난다.
 */

const md = fs.readFileSync(CHECKLIST, "utf8");

function sections(source, level) {
  const mark = "#".repeat(level) + " ";
  const out = [];
  let cur = null;
  for (const line of source.split("\n")) {
    if (line.startsWith(mark)) {
      if (cur) out.push(cur);
      cur = { heading: line.slice(mark.length).trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) out.push(cur);
  return out;
}

function cell(body, label) {
  const re = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|([^|]*)\\|`);
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

function backticked(s) {
  const m = s.match(/`([^`]+)`/);
  return m ? m[1] : "";
}

/** `**라벨**` 다음에 오는 첫 번째 코드블록을 짝지어 모은다. */
function labelledBlocks(body) {
  const lines = body.split("\n");
  const out = [];
  let label = null;
  for (let i = 0; i < lines.length; i++) {
    const lm = lines[i].match(/^\*\*(.+?)\*\*/);
    if (lm) {
      label = lm[1].trim();
      continue;
    }
    if (lines[i].startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      out.push({ label: label || "", text: buf.join("\n").trim() });
      label = null;
    }
  }
  return out;
}

const blogPosts = sections(md, 3)
  // 2-0 은 공통 안내라 표가 없다. 표(본문 파일)가 있는 절만 글이다.
  .filter((s) => /^2-\d+\.\s/.test(s.heading) && /\*\*본문 파일\*\*/.test(s.lines.join("\n")))
  .map((s) => {
    const body = s.lines.join("\n");
    const blocks = labelledBlocks(body);
    const tags = blocks.find((b) => b.label.startsWith("태그"));
    const extra = blocks.find((b) => b.label.startsWith("추가 한 줄"));
    const thumbCell = cell(body, "대표 이미지");
    return {
      id: s.heading.match(/^2-\d+\.\s+(B\d+)/)?.[1] || s.heading,
      heading: s.heading,
      title: backticked(cell(body, "제목")),
      pasteFile: backticked(cell(body, "본문 파일")),
      thumb: backticked(thumbCell),
      thumbCaption: (thumbCell.match(/\(([^)]*)\)\s*$/) || [, ""])[1],
      tags: tags ? tags.text : "",
      extraLine: extra ? extra.text : "",
    };
  });

const shortsSection = sections(md, 3).find((s) => /^3-1\.\s/.test(s.heading));
const shortsPosts = shortsSection
  ? sections(shortsSection.lines.join("\n"), 4).map((s) => {
      const body = s.lines.join("\n");
      const mp4 = backticked(s.heading);
      return {
        channel: s.heading.replace(/^[①②③④]\s*/, "").split(" — ")[0].trim(),
        heading: s.heading.replace(/^[①②③④]\s*/, "").replace(/`/g, ""),
        mp4,
        blocks: labelledBlocks(body),
      };
    })
  : [];

/* ── 붙여넣기 HTML 에서 본문만 꺼낸다 ───────────────────────────── */

/*
 * 체크리스트의 `본문 파일` 은 사장님이 내려받으시는 **첨부 이름**이고,
 * 로컬 원본은 `dist/blog-html/bNN-*.html` 이다. 둘을 잇는 것은 글 번호뿐이라
 * 번호로 찾는다. 이름을 이중으로 적어 두면 한쪽만 바뀌었을 때 조용히 어긋난다.
 */
function resolvePaste(id) {
  const n = "b" + String(id.replace(/\D/g, "")).padStart(2, "0"); // B5 → b05
  const hit = fs.readdirSync(PASTE_DIR).find((f) => f.startsWith(n + "-"));
  if (!hit) throw new Error(`${id} 붙여넣기 파일을 ${PASTE_DIR} 에서 못 찾음`);
  return hit;
}

function pasteBody(file) {
  const raw = fs.readFileSync(path.join(PASTE_DIR, file), "utf8");
  const open = raw.indexOf(">", raw.indexOf("<div style=\"max-width:720px"));
  const close = raw.lastIndexOf("</div></body>");
  if (open < 0 || close < 0) throw new Error(`본문을 못 찾음: ${file}`);
  return raw.slice(open + 1, close).trim();
}

/* ── 숏폼 커버 프레임 ───────────────────────────────────────────── */

const FFMPEG = (() => {
  for (const p of [
    "shorts-render/node_modules/ffmpeg-static/ffmpeg",
    "../shorts-render/node_modules/ffmpeg-static/ffmpeg",
    "node_modules/ffmpeg-static/ffmpeg",
  ]) {
    if (fs.existsSync(p)) return path.resolve(p);
  }
  return null;
})();

const SHORTS_DIRS = [
  process.env.SHORTS_OUT,
  "shorts/out",
  "../shorts-render/out",
].filter(Boolean);

function coverFrame(mp4) {
  if (!FFMPEG || !mp4) return null;
  const src = SHORTS_DIRS.map((d) => path.join(d, mp4)).find((p) => fs.existsSync(p));
  if (!src) return null;
  const out = path.join(OUT, "cover-" + mp4.replace(/\.mp4$/, ".png"));
  execFileSync(FFMPEG, ["-y", "-ss", "0.5", "-i", src, "-frames:v", "1", out], {
    stdio: "ignore",
  });
  return path.basename(out);
}

/* ── HTML 조각 ─────────────────────────────────────────────────── */

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SANS =
  "-apple-system,'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif";

function blogPage(post) {
  const tagChips = post.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map(
      (t) =>
        `<span style="display:inline-block;background:#f2f4f6;color:#4b5563;border-radius:12px;padding:4px 10px;font-size:12px;margin:0 5px 6px 0;">#${esc(t)}</span>`,
    )
    .join("");

  const extra = post.extraLine
    ? `<div style="border:1px dashed #c9ced6;border-radius:6px;padding:10px 12px;margin:0 0 16px;color:#6b7280;font-size:13px;line-height:1.7;">
         <b style="color:#b45309;">발행할 때 손으로 넣는 줄 — 자리는 본문 맨 아래 CTA 위</b><br>${esc(post.extraLine)}
       </div>`
    : "";

  return `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#e9ecef;font-family:${SANS};">
<div style="max-width:420px;margin:0 auto;background:#fff;min-height:100vh;">

  <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #eef0f2;">
    <div style="width:28px;height:28px;border-radius:50%;background:#03c75a;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">IB</div>
    <div style="font-size:13px;color:#1f2328;font-weight:600;">${esc(BLOG_NAME)}</div>
    <div style="margin-left:auto;font-size:12px;color:#03c75a;border:1px solid #03c75a;border-radius:4px;padding:3px 8px;">+ 이웃추가</div>
  </div>

  <div style="padding:20px 20px 0;">
    <h1 style="font-size:21px;line-height:1.45;font-weight:700;color:#1f2328;margin:0 0 10px;">${esc(post.title)}</h1>
    <div style="font-size:12px;color:#8b95a1;margin:0 0 16px;">${esc(BLOG_NAME)} · ${esc(PUB_DATE)}</div>
    <img src="../blog-thumb/${esc(post.thumb)}" style="width:100%;display:block;border-radius:4px;margin:0 0 20px;">
  </div>

  <div style="padding:0 20px;color:#1f2328;">
    ${pasteBody(resolvePaste(post.id))}
    ${extra}
  </div>

  <div style="padding:4px 20px 18px;">${tagChips}</div>

  <div style="border-top:1px solid #eef0f2;padding:12px 20px 40px;font-size:13px;color:#8b95a1;">
    ♡ 공감 0 &nbsp;·&nbsp; 💬 댓글 0
  </div>
</div>
</body>`;
}

function shortsPage(posts) {
  const cards = posts
    .map((p) => {
      const cover = p.cover
        ? `<img src="${esc(p.cover)}" style="width:100%;display:block;">`
        : `<div style="aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;color:#8b95a1;font-size:12px;">커버 없음<br>(mp4 미발견)</div>`;
      const blocks = p.blocks
        .map(
          (b) => `
        <div style="margin:0 0 14px;">
          <div style="font-size:11px;font-weight:700;color:#8b95a1;letter-spacing:.04em;margin:0 0 6px;">${esc(b.label)}</div>
          <div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.75;color:#1f2328;background:#f7f8f9;border-radius:8px;padding:12px 14px;">${esc(b.text)}</div>
        </div>`,
        )
        .join("");
      return `
    <div style="background:#fff;border-radius:12px;padding:18px;margin:0 0 18px;display:flex;gap:18px;align-items:flex-start;">
      <div style="width:190px;flex:0 0 190px;border-radius:10px;overflow:hidden;background:#111;">${cover}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:15px;font-weight:700;color:#1f2328;margin:0 0 4px;">${esc(p.heading)}</div>
        <div style="font-size:12px;color:#b45309;margin:0 0 14px;">링크가 클릭되는 자리 — ${esc(p.linkNote)}</div>
        ${blocks}
      </div>
    </div>`;
    })
    .join("");

  return `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#e9ecef;font-family:${SANS};">
<div style="max-width:900px;margin:0 auto;padding:24px 20px 40px;">
  <div style="font-size:19px;font-weight:700;color:#1f2328;margin:0 0 4px;">숏폼 1편(sf_001 증거금) — 채널별 게시물 미리보기</div>
  <div style="font-size:13px;color:#6b7280;margin:0 0 20px;">커버는 실제 mp4 의 0.5초 프레임이다. 본문은 체크리스트에 적힌 값 그대로다.</div>
  ${cards}
</div>
</body>`;
}

const LINK_NOTE = {
  "YouTube Shorts": "설명란 · 고정 댓글 (캡션 링크 클릭됨)",
  "Instagram Reels": "프로필 bio 링크만 (캡션 링크 클릭 안 됨)",
  TikTok: "프로필 bio 링크만 (캡션 링크 클릭 안 됨)",
  Threads: "본문 (클릭됨)",
};

/* ── 헤드리스 크롬 (CDP) ───────────────────────────────────────── */

class Chrome {
  static async launch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-chrome-"));
    const port = 9000 + Math.floor(process.pid % 900);
    const proc = spawn(
      "google-chrome",
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${dir}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    let ver = null;
    for (let i = 0; i < 100; i++) {
      try {
        ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!ver) throw new Error("크롬이 뜨지 않았다");
    const c = new Chrome();
    c.proc = proc;
    c.dir = dir;
    c.ws = new WebSocket(ver.webSocketDebuggerUrl);
    c.id = 0;
    c.pending = new Map();
    c.waiters = [];
    await new Promise((res, rej) => {
      c.ws.addEventListener("open", res, { once: true });
      c.ws.addEventListener("error", rej, { once: true });
    });
    c.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        c.waiters = c.waiters.filter((w) => {
          if (w.method !== msg.method) return true;
          w.res(msg.params);
          return false;
        });
      }
    });
    const { targetId } = await c.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await c.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    c.session = sessionId;
    await c.send("Page.enable");
    return c;
  }

  send(method, params = {}) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (this.session && !method.startsWith("Target.")) msg.sessionId = this.session;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify(msg));
    });
  }

  once(method) {
    return new Promise((res) => this.waiters.push({ method, res }));
  }

  async shot(fileUrl, width, outPath) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url: fileUrl });
    await loaded;
    await new Promise((r) => setTimeout(r, 400));
    const { cssContentSize } = await this.send("Page.getLayoutMetrics");
    const height = Math.ceil(cssContentSize.height);
    // 크롬 텍스처 한계(약 16384px)를 넘으면 조용히 잘린 이미지가 나온다.
    const scale = height * 2 <= 15000 ? 2 : 1;
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale },
    });
    fs.writeFileSync(outPath, Buffer.from(data, "base64"));
    return { height, scale };
  }

  close() {
    try {
      this.ws.close();
    } catch {}
    this.proc.kill();
    // 크롬이 아직 프로필에 쓰고 있으면 rm 이 ENOTEMPTY 로 죽는다.
    // 임시 폴더 청소는 이 스크립트의 결과물이 아니므로 실패해도 넘어간다.
    try {
      fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

/* ── 실행 ──────────────────────────────────────────────────────── */

fs.mkdirSync(OUT, { recursive: true });

for (const p of blogPosts) {
  fs.writeFileSync(path.join(OUT, `blog-${p.id.toLowerCase()}.html`), blogPage(p));
}

for (const p of shortsPosts) {
  p.cover = coverFrame(p.mp4);
  p.linkNote = LINK_NOTE[p.channel] || "체크리스트 3-0 참조";
}
if (shortsPosts.length) {
  fs.writeFileSync(path.join(OUT, "shorts-sf001.html"), shortsPage(shortsPosts));
}

const chrome = await Chrome.launch();
try {
  for (const p of blogPosts) {
    const file = `blog-${p.id.toLowerCase()}`;
    const r = await chrome.shot(
      "file://" + path.resolve(OUT, file + ".html"),
      420,
      path.join(OUT, file + ".png"),
    );
    console.log(
      `  ${file}.png  ${420}x${r.height}  x${r.scale}  ${p.title.slice(0, 30)}…`,
    );
  }
  if (shortsPosts.length) {
    const r = await chrome.shot(
      "file://" + path.resolve(OUT, "shorts-sf001.html"),
      900,
      path.join(OUT, "shorts-sf001.png"),
    );
    const missing = shortsPosts.filter((p) => !p.cover).length;
    console.log(
      `  shorts-sf001.png  900x${r.height}  x${r.scale}` +
        (missing ? `  (커버 없음 ${missing}건 — mp4 미발견)` : ""),
    );
  }
} finally {
  chrome.close();
}

console.log(`preview: 블로그 ${blogPosts.length}편 / 숏폼 ${shortsPosts.length}건 → ${OUT}`);
