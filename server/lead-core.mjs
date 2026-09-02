/**
 * 런타임에 의존하지 않는 리드 처리 로직.
 *
 * 로컬 Node 서버(server/server.mjs)와 서버리스 함수(api/lead.js)가 이 파일을
 * 공유한다. 검증 규칙이 두 벌로 갈라지면 한쪽만 고치는 사고가 반드시 난다.
 * 여기에는 fs·http·process 를 쓰지 않는다 — 어디서든 그대로 돈다.
 */

const EXPERIENCES = new Set(["입문", "경험 있음"]);
const SOURCES = new Set([
  "네이버 블로그", "인스타그램", "유튜브", "네이버 검색", "지인 소개", "기타",
]);

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export const CONSENT_TEXT =
  "개인정보 수집·이용 동의 (이름·연락처·거래 경험·유입 경로 / 상담 연락 목적 / 상담 종료 후 6개월)";

/** 클라이언트 검증은 신뢰하지 않는다. 서버에서 다시 본다. */
export function validateLead(body) {
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

export function pickUtm(attribution) {
  const utm = attribution?.utm ?? {};
  const out = {};
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (typeof value === "string" && value) out[key] = value.slice(0, 120);
  }
  return out;
}

/** 허니팟: 사람에게 보이지 않는 필드가 채워져 있으면 봇이다. */
export function isHoneypotHit(body) {
  return Boolean(String(body?.company ?? "").trim());
}

export function buildLead(body, { id, receivedAt, userAgent = "" }) {
  const { clean } = validateLead(body);
  return {
    id,
    receivedAt,
    ...clean,
    consent: true,
    consentText: CONSENT_TEXT,
    attribution: {
      utm: pickUtm(body?.attribution),
      referrer: String(body?.attribution?.referrer ?? "").slice(0, 300),
      landingPath: String(body?.attribution?.landingPath ?? "").slice(0, 300),
    },
    page: String(body?.page ?? "").slice(0, 500),
    userAgent: String(userAgent ?? "").slice(0, 300),
  };
}

export function channelOf(lead) {
  const utm = lead.attribution?.utm || {};
  return (
    [utm.utm_source, utm.utm_medium, utm.utm_campaign].filter(Boolean).join(" / ") || "직접 유입"
  );
}

function maskContact(contact) {
  const digits = String(contact || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-****-${digits.slice(-4)}`;
}

/**
 * 알림 본문.
 *
 * `full: true` 는 연락처 전체를 담는다. 판단 기준은 "그 채널이 개인 채널인가"다:
 *   - 텔레그램 봇 → 운영자 1:1 대화. 게다가 서버리스 배포에서는 이 메시지가
 *     리드를 다시 읽을 수 있는 유일한 기록이다. 번호를 가리면 전화를 못 건다.
 *   - 슬랙·디스코드 웹훅 → 여러 사람이 보는 채널일 수 있다. 뒤 4자리만 보낸다.
 */
export function buildNotifyText(lead, { full = false } = {}) {
  return [
    "🔔 새 상담 신청",
    `이름: ${lead.name}`,
    full
      ? `연락처: ${lead.contact}`
      : `연락처: ${maskContact(lead.contact)}  (전체 번호는 리드 목록에서 확인)`,
    `거래 경험: ${lead.experience}`,
    `유입 경로(응답): ${lead.source}`,
    `유입 채널(utm): ${channelOf(lead)}`,
    `접수 시각: ${lead.receivedAt}`,
    `리드 ID: ${lead.id}`,
  ].join("\n");
}

export { maskContact };
