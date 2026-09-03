#!/usr/bin/env node
/*
 * blog-to-html — 발행본 마크다운을 네이버 블로그에 그대로 붙여넣을 수 있는 HTML 로 바꾼다.
 *
 * 왜 필요한가.
 *   네이버 스마트에디터는 마크다운을 해석하지 않는다. 발행본 .md 를 그대로 붙이면
 *   `## 제목` 은 샵 두 개가 찍히고, 표는 `|---|---|` 가 글자로 남고, `**강조**` 는
 *   별표가 그대로 보인다. 이 사고의 성질은 우리가 이미 두 번 겪은 것과 같다 —
 *   원고 파일에는 아무 이상이 없고, 발행 버튼을 누른 뒤에야 독자 화면에서 드러난다.
 *
 * 쓰는 법.
 *   node scripts/blog-to-html.mjs            → dist/blog-html/*.html 생성 + 검사
 *   브라우저로 파일을 열고 Ctrl+A → Ctrl+C → 네이버 글쓰기 화면에 Ctrl+V.
 *   파일 안에는 본문만 들어 있다. 안내 문구를 같이 넣으면 Ctrl+A 에 딸려 들어간다.
 *
 * 본문에서 빠지는 두 줄 (`pasteBody`).
 *   제목(h1) 과 `메타 설명 (검색 결과 노출문)` 라벨은 붙여넣기 본문에 넣지 않는다.
 *   제목은 네이버 제목 칸에 따로 들어가므로 본문에 남으면 같은 제목이 두 번 보이고,
 *   `메타 설명 …` 은 우리 작업용 라벨이라 그대로 발행되면 독자 화면에 편집 메모가 찍힌다.
 *   둘 다 원고 파일에는 있어야 하는 줄이라, 걷어내는 자리는 여기 한 곳뿐이다.
 *   라벨 아래 문장은 남긴다 — 네이버는 본문 첫 문장을 검색 노출문으로 쓴다.
 *
 * 스타일은 전부 인라인이다. <style> 블록은 클립보드를 타고 넘어가지 못하는 경우가 있다.
 *
 * 원고 제약 하나. 인라인 서식은 **한 줄 안에서** 처리한다(문단·인용 모두 줄 단위로 <br> 로 잇는다).
 * 그래서 `**강조**` 를 줄바꿈 너머로 걸치면 짝이 안 맞아 별표가 글자로 남는다.
 * 아래 붙여넣기 검사가 잡아 주지만, 원고를 쓸 때 강조는 한 줄 안에서 열고 닫는다.
 */

import fs from "node:fs";
import path from "node:path";

const SRC = "content/blog";
const OUT = "dist/blog-html";

/* ── 인라인 서식 ─────────────────────────────────────────────── */

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CODE_STYLE =
  "font-family:Consolas,Monaco,'D2Coding',monospace;background:#f2f4f6;" +
  "padding:1px 5px;border-radius:3px;font-size:0.94em;";

function inline(raw) {
  let s = esc(raw);
  // 코드 → 링크 → 굵게 → 기울임 순서. 코드 안의 별표가 강조로 먹히면 안 된다.
  s = s.replace(/`([^`]+)`/g, `<span style="${CODE_STYLE}">$1</span>`);
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:#1a73e8;">$1</a>',
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return s;
}

/* ── 블록 파서 ───────────────────────────────────────────────── */

const H_STYLE = {
  1: "font-size:1.7em;font-weight:700;margin:0 0 18px;line-height:1.4;",
  2: "font-size:1.28em;font-weight:700;margin:34px 0 14px;line-height:1.45;",
  3: "font-size:1.1em;font-weight:700;margin:26px 0 12px;line-height:1.5;",
};
const P_STYLE = "margin:0 0 16px;line-height:1.8;font-size:16px;";
const TD_STYLE = "border:1px solid #d6dae0;padding:9px 12px;line-height:1.6;";
const TH_STYLE = TD_STYLE + "background:#f7f8fa;font-weight:700;";

function convert(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;

  const isTableSep = (l) => /^\|[\s:|-]+\|$/.test(l.trim()) && l.includes("-");
  const cells = (l) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) {
      i += 1;
      continue;
    }

    /* 코드 블록 — 안쪽은 서식을 먹이지 않는다 */
    if (t.startsWith("```")) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        `<pre style="background:#f2f4f6;border:1px solid #e1e4e8;border-radius:4px;` +
          `padding:14px 16px;margin:0 0 18px;overflow-x:auto;font-family:Consolas,Monaco,'D2Coding',monospace;` +
          `font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(buf.join("\n"))}</pre>`,
      );
      continue;
    }

    /* 표 — 헤더 + 구분선이 붙어 있을 때만 표로 본다 */
    if (t.startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) =>
        c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "left",
      );
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        body.push(cells(lines[i]));
        i += 1;
      }
      const th = head
        .map(
          (c, n) =>
            `<th style="${TH_STYLE}text-align:${aligns[n] || "left"};">${inline(c)}</th>`,
        )
        .join("");
      const tr = body
        .map(
          (r) =>
            "<tr>" +
            r
              .map(
                (c, n) =>
                  `<td style="${TD_STYLE}text-align:${aligns[n] || "left"};">${inline(c)}</td>`,
              )
              .join("") +
            "</tr>",
        )
        .join("");
      out.push(
        `<table style="border-collapse:collapse;width:100%;margin:0 0 20px;font-size:15px;">` +
          `<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`,
      );
      continue;
    }

    /* 가로줄 */
    if (t === "---") {
      out.push(
        `<hr style="border:0;border-top:1px solid #e1e4e8;margin:28px 0;">`,
      );
      i += 1;
      continue;
    }

    /* 제목 */
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      out.push(`<h${lv} style="${H_STYLE[lv]}">${inline(h[2])}</h${lv}>`);
      i += 1;
      continue;
    }

    /* 인용 — 연속된 > 줄을 한 덩어리로 */
    if (t.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(
        `<blockquote style="border-left:3px solid #c9ced6;margin:0 0 18px;padding:2px 0 2px 16px;` +
          `color:#4b5563;line-height:1.8;font-size:15px;">${buf.map(inline).join("<br>")}</blockquote>`,
      );
      continue;
    }

    /* 목록 */
    const listKind = /^[-*]\s+/.test(t) ? "ul" : /^\d+\.\s+/.test(t) ? "ol" : null;
    if (listKind) {
      const buf = [];
      const re = listKind === "ul" ? /^[-*]\s+/ : /^\d+\.\s+/;
      while (i < lines.length && re.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(re, ""));
        i += 1;
      }
      out.push(
        `<${listKind} style="margin:0 0 18px;padding-left:22px;line-height:1.8;font-size:16px;">` +
          buf.map((b) => `<li style="margin-bottom:5px;">${inline(b)}</li>`).join("") +
          `</${listKind}>`,
      );
      continue;
    }

    /* 문단 — 빈 줄이 나올 때까지 묶고 줄바꿈은 <br> 로 살린다 */
    const buf = [];
    while (i < lines.length && lines[i].trim()) {
      const n = lines[i].trim();
      if (
        n === "---" ||
        n.startsWith(">") ||
        n.startsWith("```") ||
        n.startsWith("|") ||
        /^#{1,3}\s/.test(n)
      )
        break;
      buf.push(n);
      i += 1;
    }
    /* 한 줄도 못 먹었으면 i 가 제자리다 — 그대로 두면 무한 루프다.
       위 블록 중 어느 것에도 안 잡히는 줄이 생기면 여기로 떨어진다. */
    if (buf.length === 0) {
      out.push(`<p style="${P_STYLE}">${inline(t)}</p>`);
      i += 1;
      continue;
    }
    out.push(`<p style="${P_STYLE}">${buf.map(inline).join("<br>")}</p>`);
  }

  return out.join("\n");
}

/* ── 붙여넣기 사고 검사 ───────────────────────────────────────── */

/* HTML 태그를 걷어낸 '독자가 실제로 보는 글자'만 남긴다. */
function visibleText(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/* 붙여넣기 본문에서 걷어내는 두 줄. 위 머리말의 `pasteBody` 항목 참조. */
function pasteBody(body) {
  return body
    .replace(/^#\s+.*\r?\n/, "")
    .replace(/^>\s*\*\*메타 설명[^\n]*\r?\n/m, "");
}

const LEAKS = [
  [/^\s*#{1,6}\s/m, "제목 기호(#)가 글자로 남았다"],
  [/\|\s*-{3,}/, "표 구분선(|---|)이 글자로 남았다"],
  [/\*\*/, "굵게 기호(**)가 글자로 남았다"],
  [/(^|\s)\|.*\|(\s|$)/m, "표 파이프(|)가 글자로 남았다"],
  [/\[[^\]]+\]\(https?:/, "링크 문법이 글자로 남았다"],
];

/* ── 실행 ─────────────────────────────────────────────────────── */

fs.mkdirSync(OUT, { recursive: true });

const files = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith(".md"))
  .sort();

const problems = [];
const made = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(SRC, f), "utf8");
  /* 저장소 안 메모용 주석은 발행본이 아니다. 첫 제목 앞은 전부 버린다. */
  const body = raw.replace(/^[\s\S]*?(?=^# )/m, "");
  const title = (body.match(/^#\s+(.*)$/m) || [, f])[1];
  const article = convert(pasteBody(body));

  const leftover = visibleText(article);
  for (const [re, msg] of LEAKS) {
    /* 코드 블록 안의 기호는 원래 그렇게 보여야 하는 것이라 제외한다. */
    const outsideCode = visibleText(
      article.replace(/<pre[\s\S]*?<\/pre>/g, ""),
    );
    if (re.test(outsideCode)) problems.push(`${f}: ${msg}`);
  }
  if (article.includes("〔작성자")) problems.push(`${f}: 작성자 표기가 비어 있다`);
  if (!leftover.trim()) problems.push(`${f}: 본문이 비었다`);
  /* 아래 둘은 붙여도 화면이 깨지지 않는다 — 그래서 발행하고 나서야 보인다. */
  if (/<h1[\s>]/.test(article))
    problems.push(`${f}: 제목이 본문에 남았다 — 네이버 제목 칸과 겹쳐 두 번 보인다`);
  if (/메타 설명/.test(leftover))
    problems.push(`${f}: 작업용 라벨 '메타 설명' 이 본문에 남았다 — 독자 화면에 편집 메모가 찍힌다`);

  const html =
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">` +
    `<title>${esc(title)}</title></head>` +
    `<body style="margin:0;padding:32px 20px;">` +
    `<div style="max-width:720px;margin:0 auto;font-family:'맑은 고딕','Malgun Gothic',` +
    `-apple-system,'Apple SD Gothic Neo',sans-serif;color:#1f2328;">\n${article}\n</div>` +
    `</body></html>\n`;

  const name = f.replace(/\.md$/, ".html");
  fs.writeFileSync(path.join(OUT, name), html, "utf8");
  made.push(`${name}  (${Buffer.byteLength(html)} bytes)`);
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL  ${p}`).join("\n"));
  console.error(`\n붙여넣기 사고 ${problems.length}건 — 발행하면 독자 화면에 기호가 찍힌다.`);
  process.exit(1);
}

console.log(made.map((m) => `  ${m}`).join("\n"));
console.log(
  `\nPASS  ${made.length}편 변환 — 제목·표·강조·링크 기호가 글자로 남은 곳 없음.` +
    `\n      브라우저로 열고 Ctrl+A → Ctrl+C → 네이버 글쓰기에 Ctrl+V.`,
);
