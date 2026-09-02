/**
 * 랜딩 문구 가드.
 *
 * IB-2 브리프 6절 / IB-6 가이드라인 / IB-8 `rebate-copy` 의 표현 제약을
 * 사람이 기억하는 대신 기계가 막는다. 카피는 여러 사람이 손대므로
 * "README 에 적어 뒀다" 로는 지켜지지 않는다.
 *
 * IB-10 에서 페이지가 3개(index / broker / signup)로 늘었다. 그래서 이 가드는
 * 파일 이름을 하드코딩하지 않고 **public 아래 모든 html·js 를 스스로 찾아서** 검사한다.
 * 페이지를 새로 만들면 검사 대상에 자동으로 들어온다 — 가드에 등록하는 걸 잊는 사고를 없앤다.
 *
 * 사용: node scripts/copy-guard.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const files = readdirSync(PUBLIC_DIR)
  .filter((f) => [".html", ".js"].includes(extname(f)))
  .sort();

const pages = files.filter((f) => extname(f) === ".html");

const read = (f) => readFileSync(join(PUBLIC_DIR, f), "utf8");

/** 주석은 사용자에게 보이지 않으므로 검사 대상에서 뺀다 (내부 메모까지 막으면 가드를 끄게 된다). */
const stripComments = (src, isHtml) =>
  isHtml ? src.replace(/<!--[\s\S]*?-->/g, "") : src.replace(/\/\*[\s\S]*?\*\//g, "");

/** 표현 검사는 **사람이 읽는 글자**에만 건다. 태그와 속성은 문구가 아니다. */
const visibleText = (src) =>
  stripComments(src, true)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ");

const source = new Map(files.map((f) => [f, stripComments(read(f), extname(f) === ".html")]));
const text = new Map(
  files.map((f) => [f, extname(f) === ".html" ? visibleText(read(f)) : stripComments(read(f), false)])
);

const failures = [];
const fail = (msg) => failures.push(msg);

/* ---------- 1. 쓰면 안 되는 표현 ---------- */

const BANNED = [
  // IB-8 §2 — 단어 자체 금지 (브로커 표기 허용 여부 확인 전)
  [/리베이트|캐시백|페이백|환급/, "리베이트·캐시백·페이백·환급 — 단어 자체가 금지 (IB-8 §2)"],
  // 수익·원금 보장류.
  // 부정형은 오히려 필수 문구다 — "미래 수익을 보장하지 않으며"(리스크 고지),
  // "손실을 보전하는 개념이 아닙니다"(분기 A 병기 문구). 뒤따르는 부정어를 보고 통과시킨다.
  [
    /(원금|수익|손실)\s*(?:을|를)?\s*(?:보장|보전)(?!하지\s*않|되지\s*않|하는\s*개념이\s*아)/,
    "수익·원금 보장 표현 금지",
  ],
  [/확정\s*수익/, "확정 수익률 표현 금지"],
  [/무조건|100\s*%|절대\s*(안전|손실)/, "\"무조건 / 100% / 절대\" 표현 금지"],
  // 비용 은폐·최상급
  [/수수료\s*0\s*원|완전\s*무료|비용\s*없이/, "스프레드·스왑을 가리는 무료 주장 금지"],
  [/업계\s*최고|최저\s*수수료|국내\s*최[저고]/, "근거 없는 최상급 금지"],
  // 남겨두면 안 되는 자리표시자
  [/TBD|\{\{|XXX|OOO원|\bO원\b/, "수치 placeholder 를 남기지 않는다 (IB-8: 빈 칸을 만들지 말 것)"],
  /* 거래량 단위에 붙는 금액 약속.
     "1로트 기준 $1" 같은 **브로커가 공시한 비용 사양**은 사실이므로 막지 않는다.
     막아야 하는 건 그 단위에 **우리가 무언가를 돌려준다는 약속**이다 (IB-8 §2). */
  [
    /(랏\s*당|1\s*랏|계약\s*당|로트\s*당|로트\s*기준)[^\n]{0,30}(지급해|돌려|되돌려|절감|할인)/,
    "거래량 단위당 지급·절감 약속 금지 — 확정되지 않은 조건이다 (IB-8 §2)",
  ],
];

for (const [re, why] of BANNED) {
  for (const f of files) {
    const hit = text.get(f).match(re);
    if (hit) fail(`[금지표현] ${f}: "${hit[0].trim()}" — ${why}`);
  }
}

/* ---------- 2. 확정 문구가 허용된 자리에만 있는가 ---------- */

const CONFIRMED = "거래 수수료 구조를 미리 계산해 안내해 드립니다";

const totalOccurrences = files.reduce(
  (n, f) => n + (text.get(f).split(CONFIRMED).length - 1),
  0
);

if (totalOccurrences === 0) {
  fail(`[확정문구] IB-8 확정 문구가 사라졌다. index.html 근거 블록 마지막 항목에 있어야 한다.`);
} else if (totalOccurrences > 1) {
  fail(`[확정문구] ${totalOccurrences}곳에 중복됐다. 근거 블록 안 한 곳에만 둔다 (IB-8 배치 규칙).`);
} else {
  // 근거 블록(#why) 안에 있어야 하고, 헤드라인·CTA 영역에는 없어야 한다.
  const html = source.get("index.html");
  const at = html.indexOf(CONFIRMED);
  const whyStart = html.indexOf('id="why"');
  const whyEnd = html.indexOf("<section", whyStart + 1);
  if (at < 0) {
    fail(`[확정문구] index.html 이 아닌 페이지에 있다. 근거 블록(#why)이 유일한 자리다 (IB-8).`);
  } else {
    if (whyStart < 0 || !(at > whyStart && at < whyEnd)) {
      fail(`[확정문구] 근거 블록(#why) 밖에 있다. 헤드라인·서브카피·CTA 주변은 금지 위치다 (IB-8).`);
    }
    const heroEnd = html.indexOf("</header>");
    if (heroEnd > 0 && at < heroEnd) {
      fail(`[확정문구] 헤드라인 영역(hero) 안에 있다 — 금지 위치.`);
    }
  }
}

/* ---------- 3. 생략 불가 항목 — 모든 페이지에 ---------- */

for (const f of pages) {
  const t = text.get(f);

  if (!/원금 전액을 초과하는 손실/.test(t)) {
    fail(`[리스크고지] ${f}: 푸터 리스크 고지 문구가 없다. 생략 불가 항목이다 (IB-6 2-A).`);
  }

  /* IB 이해관계 고지. 숨기면 표시광고법 §3 기만 유형에 해당할 수 있다 (IB-6 2-A 마지막 줄).
     페이지를 새로 만들 때 가장 빠뜨리기 쉬운 항목이라 기계가 본다. */
  if (!/IB\(소개영업자\)로서 거래 수수료의 일부를 지급받습니다/.test(t)) {
    fail(`[이해관계고지] ${f}: IB 수수료 수취 고지가 없다. 모든 페이지에 들어간다 (IB-6 2-A).`);
  }
}

/* ---------- 4. 브로커 수치에는 출처·기준일이 붙는가 ---------- */

/* IB-6 체크리스트 5번: 숫자에는 출처와 기준일을 붙인다.
   브로커 조건은 언제든 바뀌므로, 기준일 없는 숫자는 시간이 지나면 그냥 거짓말이 된다.
   사실 대장은 docs/mim-broker-facts.md 한 곳이다 — 페이지에서 숫자를 새로 만들지 않는다. */
const BROKER_FIGURE = /GB24203684|1:500|1:200|핍부터/;
const HAS_ASOF = /확인일[^\n]{0,12}\d{4}-\d{2}-\d{2}/;

for (const f of pages) {
  const t = text.get(f);
  if (BROKER_FIGURE.test(t) && !HAS_ASOF.test(t)) {
    fail(`[출처] ${f}: 브로커 수치를 쓰면서 "확인일 YYYY-MM-DD" 표기가 없다 (IB-6 체크리스트 5).`);
  }
}

/* ---------- 5. 개인정보 최소 수집 ---------- */

for (const f of pages) {
  const html = source.get(f);
  const fields = [...html.matchAll(/<(?:input|select)\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  const collected = fields.filter((n) => !["consent", "company"].includes(n)); // 동의·허니팟은 수집 항목이 아니다
  const ALLOWED = ["name", "contact", "experience", "source"];
  const extra = [...new Set(collected)].filter((n) => !ALLOWED.includes(n));
  if (extra.length) {
    fail(`[개인정보] ${f}: 허용된 4개 항목 외 수집 필드: ${extra.join(", ")} — 필요 이상 수집 금지`);
  }
}

/* ---------- 6. 내부 링크가 살아 있는가 ---------- */

/* vercel.json 의 cleanUrls 때문에 링크는 확장자 없이(`./broker`) 쓴다.
   그래서 오타가 나도 화면에서는 멀쩡해 보이고, 눌러야만 404 가 드러난다.
   광고를 태운 뒤에 알게 되는 종류의 사고라서 배포 전에 막는다. */
for (const f of pages) {
  const html = source.get(f);
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);

  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|#)/.test(ref)) continue;

    const bare = ref.replace(/^\.\//, "").split(/[?#]/)[0];
    if (!bare) continue; // "./#apply" 같은 자기 페이지 앵커

    const candidates = extname(bare) ? [bare] : [`${bare}.html`, `${bare}/index.html`];
    if (!candidates.some((c) => existsSync(join(PUBLIC_DIR, c)))) {
      fail(`[링크] ${f}: "${ref}" 가 가리키는 파일이 public/ 에 없다.`);
    }
  }
}

/* ---------- 7. vercel.json — 배포가 아예 거절되지 않는가 ---------- */

/* JSON 에는 주석이 없어서 "//" 키로 메모를 달았다가 배포가 통째로 막혔다.
   Vercel 은 스키마에 없는 속성을 거절한다:
     Invalid request: should NOT have additional property //
   빌드 로그가 아니라 Import 화면에서 튕기기 때문에 사장님이 먼저 마주쳤다.
   메모는 README 에 적고, 여기서는 그 키가 다시 생기지 않게 막는다. */
{
  const raw = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`[vercel.json] JSON 파싱 실패 — ${err.message}`);
    parsed = null;
  }

  if (parsed) {
    const commentKeys = [];
    (function walk(node, path) {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (k === "//" || k.startsWith("//")) commentKeys.push(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    })(parsed, "$");

    if (commentKeys.length) {
      fail(
        `[vercel.json] 주석 키 ${commentKeys.join(", ")} — Vercel 이 배포를 거절한다. ` +
          `설명은 README 에 적을 것.`
      );
    }

    /* 스키마에 있는 속성만 쓴다. 오타 하나로 Import 가 막히는 것을 미리 잡는다. */
    const ALLOWED_TOP = new Set([
      "$schema", "buildCommand", "bunVersion", "cleanUrls", "crons", "devCommand",
      "fluid", "framework", "functions", "headers", "ignoreCommand", "images",
      "installCommand", "outputDirectory", "public", "redirects", "bulkRedirectsPath",
      "regions", "functionFailoverRegions", "rewrites", "trailingSlash",
    ]);
    const unknown = Object.keys(parsed).filter((k) => !ALLOWED_TOP.has(k));
    if (unknown.length) {
      fail(`[vercel.json] 스키마에 없는 최상위 속성: ${unknown.join(", ")} — Vercel 이 거절한다.`);
    }
  }
}

/* ---------- 결과 ---------- */

if (failures.length) {
  console.error(failures.map((f) => `FAIL  ${f}`).join("\n"));
  console.error(`\n${failures.length}건 위반`);
  process.exit(1);
}
console.log(
  `PASS  ${pages.length}개 페이지(${pages.join(", ")}) — ` +
    `금지표현 없음 / 확정 문구 위치 정상 / 리스크·이해관계 고지 존재 / 수치 출처 표기 / 내부 링크 정상 / 수집 항목 4개`
);
