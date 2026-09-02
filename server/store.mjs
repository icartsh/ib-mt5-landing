import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.mjs";

/**
 * 리드 저장. 순서가 중요하다:
 *   1) 로컬 JSONL 에 먼저 쓴다 — 이게 유실되면 안 되는 원장이다.
 *   2) 그 다음 원격(구글 시트)에 밀어 넣는다 — 실패해도 리드는 이미 살아 있다.
 * 원격 실패로 사용자에게 에러를 보여 주면 리드를 잃는다. 그래서 원격은 best-effort.
 */
export async function saveLead(lead) {
  await mkdir(dirname(config.leadsFile), { recursive: true });
  await appendFile(config.leadsFile, JSON.stringify(lead) + "\n", "utf8");

  const remote = { attempted: false, ok: false, detail: "" };

  if (config.sheetsWebhookUrl) {
    remote.attempted = true;
    try {
      const res = await fetch(config.sheetsWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
        signal: AbortSignal.timeout(8000),
      });
      remote.ok = res.ok;
      remote.detail = `HTTP ${res.status}`;
    } catch (err) {
      remote.detail = String(err?.message || err);
    }
  }

  return { local: true, remote };
}

export async function readLeads(limit = 200) {
  let raw;
  try {
    raw = await readFile(config.leadsFile, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 손상된 줄 하나 때문에 전체 조회가 죽지 않게 한다 */
    }
  }
  return rows.slice(-limit).reverse();
}
