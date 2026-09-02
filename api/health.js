/**
 * GET /api/health — "지금 링크를 뿌려도 되는가" 를 리드 없이 확인한다.
 *
 * 이 엔드포인트가 생기기 전의 배포 게이트는 진짜 신청을 한 건 넣어 보는 것이었다.
 * 그 방식은 확인할 때마다 운영자 휴대폰에 가짜 리드를 하나씩 남기고, 나중에
 * 진짜 신청과 섞인다. 게다가 접수가 막혀 있을 때 그 이유(토큰이 없는 것인지,
 * /start 를 안 보낸 것인지)를 알려주지 않는다 — 신청자에게 나가는 문구는
 * 일부러 그 둘을 같게 만들어 두었기 때문이다. 운영자에게는 그 구분이 필요하다.
 *
 * 비밀값은 내보내지 않는다. 토큰도, chat_id 도 아닌 "붙었는가 / 안 붙었는가" 만
 * 답한다.
 */
import { probeSinks } from "../server/sinks.mjs";

/* 이 응답은 바깥(텔레그램 getUpdates)을 한 번 친다. 상태가 초 단위로 바뀌지는
   않으므로 잠깐 캐시해서, 이 주소를 반복 호출해도 텔레그램을 때리지 않게 한다. */
const CACHE_MS = 5000;
let cached = { at: 0, body: null };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const now = Date.now();
  if (cached.body && now - cached.at < CACHE_MS) {
    return res.status(200).json(cached.body);
  }

  const { telegram, sheets, accepting } = await probeSinks();

  const body = {
    ok: true,
    /* 신청이 실제로 접수될 수 있는 상태인지. 이 값이 false 인 동안 채널에
       링크를 뿌리면 유입만 생기고 리드는 한 건도 안 남는다. */
    accepting,
    sinks: {
      telegram: { configured: telegram.configured, ready: telegram.ready, detail: telegram.detail },
      sheets: { configured: sheets.configured, ready: sheets.ready, detail: sheets.detail },
    },
    nextAction: accepting
      ? "배포 게이트 통과 — utm 링크를 뿌려도 된다."
      : telegram.configured && !telegram.ready
        ? "텔레그램에서 봇에게 /start 를 한 번 보내면 접수가 열린다."
        : "접수 채널(텔레그램 봇 토큰 또는 구글 시트 URL)이 설정되지 않았다.",
  };

  cached = { at: now, body };
  return res.status(200).json(body);
}

/** 검사에서 상태를 바꿔 가며 확인할 수 있게 캐시를 비우는 통로. */
export const __testing = { resetCache: () => { cached = { at: 0, body: null }; } };
