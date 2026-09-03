/**
 * 블로그 원고 가드.
 *
 * `scripts/copy-guard.mjs` 는 우리 사이트(public/)를 본다. 그런데 블로그 6편은 우리 사이트가
 * 아니라 **네이버 블로그에 사람이 붙여넣어 발행**한다(IB-4 `content-standards` §3, utm_source=naver_blog).
 * 즉 발행 순간 우리 코드를 한 줄도 거치지 않는다 — 가드가 없으면 표현 규칙과 슬롯 치환이
 * "사람이 기억하기"에만 걸린다. 원고는 발행 직전에 손대게 되어 있어서 그 방식은 반드시 새어나간다.
 *
 * 그래서 발행본을 저장소에 두고(content/blog/), 붙여넣기 전에 이 검사를 통과시킨다.
 *
 * 판정은 두 단계다. 섞으면 둘 다 무시하게 된다.
 *   위반(FAIL)  — 규칙 위반. 고치기 전에는 발행하지 않는다.
 *   미결(PEND)  — 사장님 결정이 남은 자리. 원고 잘못이 아니라 승인 대기다.
 *
 * 사용: node scripts/content-guard.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";

const BLOG_DIR = fileURLToPath(new URL("../content/blog/", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

if (!existsSync(BLOG_DIR)) {
  console.log("SKIP  content/blog/ 가 없다 — 검사할 원고가 없다.");
  process.exit(0);
}

const files = readdirSync(BLOG_DIR).filter((f) => extname(f) === ".md").sort();

/** HTML 주석은 편집자용 메모다. 독자에게 안 보이므로 검사 대상에서 뺀다. */
const body = (src) => src.replace(/<!--[\s\S]*?-->/g, "");

const violations = [];
const pending = [];
const fail = (m) => violations.push(m);
const pend = (m) => pending.push(m);

/* ---------- 1. 쓰면 안 되는 표현 (IB-4 content-standards §7) ---------- */

const BANNED = [
  [/대여\s*계좌|미니\s*업체|미니\s*계좌/, "제외 세그먼트 용어 — 단어조차 쓰지 않는다 (IB-2 4절 / IB-3 0절)"],
  [/리베이트|캐시백|페이백|환급/, "리베이트·캐시백·페이백·환급 금지 (IB-8 §2)"],
  // 부정형은 오히려 필수 문구다 — "보장되지 않으며"(리스크 고지). 뒤따르는 부정어를 보고 통과시킨다.
  [
    /(원금|수익|손실|수익률)\s*(?:을|를|도)?\s*(?:보장|보전)(?!하지\s*않|되지\s*않|하는\s*개념이\s*아)/,
    "수익·원금 보장 표현 금지 (IB-6 1장)",
  ],
  [/확정\s*수익/, "확정 수익률 표현 금지"],
  [/무조건|100\s*%|절대\s*(안전|손실)/, '"무조건 / 100% / 절대" 표현 금지'],
  [/수수료\s*0\s*원|완전\s*무료|비용\s*없이/, "비용 은폐 주장 금지"],
  [/업계\s*최고|최저\s*수수료|가장\s*저렴|국내\s*최[저고]/, "근거 없는 최상급 금지 (IB-6 1장)"],
  [/수익\s*인증|잔고\s*(캡처|인증)/, "수익 인증·잔고 캡처 금지 (IB-6 1-B)"],
  [/대신\s*매매|시그널대로/, "투자 자문·일임 오인 표현 금지 (IB-6 1-D·1-F)"],
];

/* ---------- 2. 남아 있으면 안 되는 자리표시자 ---------- */

/* 슬롯이 하나라도 남으면 발행 금지 (standards §4-1). 화면에서는 〔N-01〕이 그냥 글자로 보여서
   눈으로는 넘어간다 — 발행하고 나서야 독자 눈에 띈다. */
const SLOTS = [
  [/〔N-\d+〕/g, "숫자 슬롯이 치환되지 않았다 (standards §4-1)"],
  [/〔DATE〕/g, "기준일 슬롯이 치환되지 않았다"],
  [/\{\{[^}]+\}\}/g, "토큰이 치환되지 않았다 (BROKER_NAME / LANDING_URL 등)"],
];

/* 작성자 표기만은 사장님 결정 사항이라 '미결'로 따로 센다 (standards §8-4). */
const AUTHOR_SLOT = /〔작성자\s*표기〕/;

/* ---------- 3. 생략 불가 블록 (standards §2-A) ---------- */

const RISK_LINES = [
  "원금 전액을 초과하는 손실이 발생할 수 있습니다",
  "투자 자문이 아닙니다",
  "과거의 성과가 미래의 수익을 보장하지 않습니다",
  "책임은 투자자 본인에게 있습니다",
  "여유 자금으로만 거래하시기 바랍니다",
  "IB(소개영업자)로서 거래 수수료의 일부를 지급받습니다",
];

const CTA_TEXT = "내 조건으로 비용 계산받기";

/* ---------- 4. UTM 규격 (standards §3) ---------- */

const CAMPAIGNS = new Set(["seed_w1_cost", "seed_w2_onboarding"]);

for (const f of files) {
  const t = body(readFileSync(join(BLOG_DIR, f), "utf8"));

  for (const [re, why] of BANNED) {
    const hit = t.match(re);
    if (hit) fail(`[금지표현] ${f}: "${hit[0].trim()}" — ${why}`);
  }

  for (const [re, why] of SLOTS) {
    const hits = t.match(re);
    if (hits) fail(`[슬롯] ${f}: ${[...new Set(hits)].join(", ")} — ${why}`);
  }

  if (AUTHOR_SLOT.test(t)) pend(`[작성자] ${f}: 작성자 표기가 정해지지 않았다 — 사장님 결정 대기 (standards §8-4).`);

  for (const line of RISK_LINES) {
    if (!t.includes(line)) fail(`[리스크고지] ${f}: 고지 문장 누락 — "${line}" (standards §2-A, 생략 불가)`);
  }

  /* 배치 순서: 본문 → 리스크 고지 → CTA (standards §1).
     고지가 CTA 아래로 내려가면 스크롤에서 잘려 안 읽힌다. IB-6 2장이 순서를 못박은 이유다. */
  const riskAt = t.indexOf("⚠️ 투자 위험 고지");
  const ctaAt = t.lastIndexOf(CTA_TEXT);
  if (riskAt < 0) fail(`[리스크고지] ${f}: "⚠️ 투자 위험 고지" 블록 제목이 없다.`);
  else if (ctaAt < 0) fail(`[CTA] ${f}: CTA 문구가 없다 — "${CTA_TEXT}"`);
  else if (ctaAt < riskAt) fail(`[배치] ${f}: CTA 가 리스크 고지보다 위에 있다. 순서는 본문 → 고지 → CTA (IB-6 2장).`);

  /* 숫자를 쓰면 출처와 기준일을 붙인다 (IB-6 체크리스트 5). 기준일 없는 숫자는
     시간이 지나면 그냥 틀린 정보가 된다 — 세율·공제는 개정되는 값이다. */
  if (!/\(출처:/.test(t)) fail(`[출처] ${f}: "(출처: …)" 표기가 하나도 없다.`);
  if (!/\d{4}-\d{2}-\d{2}\s*(확인|기준)/.test(t)) fail(`[기준일] ${f}: "YYYY-MM-DD 확인/기준" 표기가 없다.`);

  /* UTM. 4종이 다 붙어야 IB-5 대시보드에서 "어느 글이 리드를 만들었나"가 갈린다. */
  const links = [...t.matchAll(/https:\/\/[^\s)\]]+/g)].map((m) => m[0]);
  const cta = links.find((u) => u.includes("utm_"));
  if (!cta) {
    fail(`[UTM] ${f}: utm 이 붙은 CTA 링크가 없다 (standards §3).`);
  } else {
    const q = new URL(cta).searchParams;
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      if (!q.get(k)) fail(`[UTM] ${f}: ${k} 누락 — ${cta}`);
    }
    if (q.get("utm_campaign") && !CAMPAIGNS.has(q.get("utm_campaign"))) {
      fail(`[UTM] ${f}: utm_campaign "${q.get("utm_campaign")}" 은 규격 밖이다 (${[...CAMPAIGNS].join(" / ")}).`);
    }
    if (q.get("utm_content") && !/^b0[1-9]$/.test(q.get("utm_content"))) {
      fail(`[UTM] ${f}: utm_content "${q.get("utm_content")}" 은 블로그 규격(b01~b06)이 아니다.`);
    }
  }

  /* 우리 사이트로 보내는 링크가 실제로 존재하는 경로인가.
     standards §3 이 예시로 쓴 `/apply` 는 배포본에 없다(404). 규격을 그대로 믿고 링크를 만들면
     발행 첫날 유입이 통째로 빠진다 — 그리고 그건 유입이 0인 것과 화면상 구별되지 않는다. */
  for (const url of links) {
    let u;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (!/(^|\.)ib-mt5-landing\.vercel\.app$/.test(u.hostname)) continue;

    const bare = u.pathname.replace(/^\/+/, "").replace(/\/$/, "");
    if (!bare) continue; // 루트
    const candidates = extname(bare) ? [bare] : [`${bare}.html`, `${bare}/index.html`];
    if (!candidates.some((c) => existsSync(join(PUBLIC_DIR, c)))) {
      fail(`[링크] ${f}: "${u.pathname}" 가 public/ 에 없다 — 발행하면 404 로 빠진다.`);
    }
  }
}

/* ---------- 결과 ---------- */

if (violations.length) {
  console.error(violations.map((v) => `FAIL  ${v}`).join("\n"));
}
if (pending.length) {
  console.error(pending.map((p) => `PEND  ${p}`).join("\n"));
}

if (violations.length) {
  console.error(`\n위반 ${violations.length}건 — 고치기 전에는 발행하지 않는다.`);
  process.exit(1);
}

console.log(
  `PASS  원고 ${files.length}편(${files.join(", ")}) — ` +
    `금지표현 없음 / 슬롯 잔여 없음 / 리스크·이해관계 고지 6줄 / 고지→CTA 순서 / ` +
    `출처·기준일 표기 / UTM 4종 규격 / 랜딩 링크 실재` +
    (pending.length ? `\n미결 ${pending.length}건 — 승인 대기이며 원고 잘못이 아니다.` : "")
);
