/**
 * 랜딩 문구 가드.
 *
 * IB-2 브리프 6절 / IB-6 가이드라인 / IB-8 `rebate-copy` 의 표현 제약을
 * 사람이 기억하는 대신 기계가 막는다. 카피는 여러 사람이 손대므로
 * "README 에 적어 뒀다" 로는 지켜지지 않는다.
 *
 * 사용: node scripts/copy-guard.mjs
 */
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

/** 주석은 사용자에게 보이지 않으므로 검사 대상에서 뺀다 (내부 메모까지 막으면 가드를 끄게 된다). */
const visible = html.replace(/<!--[\s\S]*?-->/g, "");

const failures = [];
const fail = (msg) => failures.push(msg);

/* ---------- 1. 쓰면 안 되는 표현 ---------- */

const BANNED = [
  // IB-8 §2 — 단어 자체 금지 (브로커 표기 허용 여부 확인 전)
  [/리베이트|캐시백|페이백|환급/, "리베이트·캐시백·페이백·환급 — 단어 자체가 금지 (IB-8 §2)"],
  // 미확정 수치를 약속하는 형태
  [/랏\s*당|1\s*랏|계약당\s*[0-9$₩]|[0-9]+\s*%\s*(환급|할인|절감)/, "미확정 리베이트 수치 약속 (IB-8 §2)"],
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
];

for (const [re, why] of BANNED) {
  for (const [label, text] of [["index.html", visible], ["app.js", appJs]]) {
    const hit = text.match(re);
    if (hit) fail(`[금지표현] ${label}: "${hit[0]}" — ${why}`);
  }
}

/* ---------- 2. 확정 문구가 허용된 자리에만 있는가 ---------- */

const CONFIRMED = "거래 수수료 구조를 미리 계산해 안내해 드립니다";

const occurrences = visible.split(CONFIRMED).length - 1;
if (occurrences === 0) {
  fail(`[확정문구] IB-8 확정 문구가 사라졌다. 근거 블록 마지막 항목에 있어야 한다.`);
} else if (occurrences > 1) {
  fail(`[확정문구] ${occurrences}곳에 중복됐다. 근거 블록 안 한 곳에만 둔다.`);
} else {
  // 근거 블록(#why) 안에 있어야 하고, 헤드라인·CTA 영역에는 없어야 한다.
  const at = visible.indexOf(CONFIRMED);
  const whyStart = visible.indexOf('id="why"');
  const whyEnd = visible.indexOf("<section", whyStart + 1);
  if (whyStart < 0 || !(at > whyStart && at < whyEnd)) {
    fail(`[확정문구] 근거 블록(#why) 밖에 있다. 헤드라인·서브카피·CTA 주변은 금지 위치다 (IB-8).`);
  }
  const heroEnd = visible.indexOf("</header>");
  if (heroEnd > 0 && at < heroEnd) {
    fail(`[확정문구] 헤드라인 영역(hero) 안에 있다 — 금지 위치.`);
  }
}

/* ---------- 3. 생략 불가 항목 ---------- */

if (!/원금 전액을 초과하는 손실/.test(visible)) {
  fail("[리스크고지] 푸터 리스크 고지 문구가 없다. 생략 불가 항목이다.");
}

/* ---------- 4. 개인정보 최소 수집 ---------- */

const fields = [...visible.matchAll(/<(?:input|select)\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
const collected = fields.filter((n) => !["consent", "company"].includes(n)); // 동의·허니팟은 수집 항목이 아니다
const ALLOWED = ["name", "contact", "experience", "source"];
const extra = [...new Set(collected)].filter((n) => !ALLOWED.includes(n));
if (extra.length) {
  fail(`[개인정보] 허용된 4개 항목 외 수집 필드: ${extra.join(", ")} — 필요 이상 수집 금지`);
}

/* ---------- 결과 ---------- */

if (failures.length) {
  console.error(failures.map((f) => `FAIL  ${f}`).join("\n"));
  console.error(`\n${failures.length}건 위반`);
  process.exit(1);
}
console.log("PASS  금지표현 없음 / 확정 문구 위치 정상 / 리스크 고지 존재 / 수집 항목 4개");
