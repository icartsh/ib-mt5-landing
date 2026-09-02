import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.mjs";

/**
 * 로컬 JSONL 원장에 리드를 적는다. 이게 유실되면 안 되는 기록이라 가장 먼저 쓴다.
 *
 * 바깥으로 나가는 목적지(구글 시트·텔레그램)는 server/sinks.mjs 가 담당한다.
 * 로컬 서버에서는 그쪽이 전부 실패해도 리드가 이 파일에 남아 있으므로
 * 사용자에게는 성공으로 답한다. (서버리스에는 이 원장이 없어서 규칙이 다르다 —
 * api/lead.js 주석 참고.)
 */
export async function saveLead(lead) {
  await mkdir(dirname(config.leadsFile), { recursive: true });
  await appendFile(config.leadsFile, JSON.stringify(lead) + "\n", "utf8");
  return { local: true };
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
