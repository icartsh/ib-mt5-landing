/**
 * 배송 가드 — "고쳤다" 와 "나갔다" 사이의 간격을 막는다.
 *
 * 이 저장소에서 같은 사고가 세 번 났다. 세 번 다 파일에는 이상이 없었다.
 *
 *   1) 완성본이 작업 폴더에만 있고 커밋되지 않음
 *   2) 커밋은 됐는데 origin 에 안 올라감 → Vercel 은 origin 을 보고 배포하므로 라이브가 옛것
 *   3) 그 상태로 "고쳤습니다" 라고 보고함
 *
 * 2번이 가장 나쁘다. `npm test` 도 통과하고, `git status` 도 깨끗하고, 로컬에서 열어 보면
 * 고쳐져 있다. **로컬에서 확인할 수 있는 모든 신호가 정상이다.** 실제로 `/signup` 이
 * 존재하지 않는 심볼(US100·GER40)을 11커밋 동안 라이브로 띄우고 있었다.
 *
 * 그래서 이 가드는 "파일이 맞는가" 가 아니라 **"이 변경이 사람에게 닿는 자리까지 갔는가"** 만 본다.
 * 네트워크를 쓰지 않는다 — 판정 기준은 `origin/main` 이고, Vercel 이 그걸 보고 배포하기 때문이다.
 *
 * 검사 대상은 **배송면(shipped surface)** 뿐이다. 원고·문서·렌더러가 미푸시인 것은
 * 사용자에게 보이지 않으므로 실패로 치지 않는다. 안 그러면 커밋마다 빨간불이 뜨고,
 * 빨간불이 일상이 되면 가드는 꺼진다.
 *
 * CI 에서는 건너뛴다. CI 의 HEAD 는 이미 푸시된 커밋이거나 PR 브랜치라
 * "미배송" 이라는 개념 자체가 성립하지 않는다.
 *
 * 사용: node scripts/ship-guard.mjs
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 사람에게 닿는 자리. 여기가 바뀌었는데 origin 에 없으면 라이브는 옛것이다.
 *
 * `scripts` 가 들어 있는 이유: `vercel.json` 의 buildCommand 와 CI 가 이 폴더를 실행한다.
 * 새 검사 규칙을 만들어 놓고 푸시하지 않으면 배포 길목은 옛 검사를 계속 쓴다 —
 * 로컬에서는 잡히는데 배포에서는 안 잡히는, 이 저장소에서 이미 한 번 난 사고다.
 *
 * `content`·`docs`·`shorts` 는 뺀다. 원고가 미푸시인 것은 라이브 화면을 바꾸지 않는다.
 * 실패를 흔하게 만들면 가드가 꺼진다. */
const SHIPPED = ["public", "api", "server", "scripts", "vercel.json", "package.json"];

const BASE = "origin/main";

/** `--strict` 는 "다 됐다" 를 주장하는 자리에서만 켠다 → `npm run ship`. */
const STRICT = process.argv.includes("--strict");

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const skip = (why) => {
  console.log(`SKIP  배송 가드 — ${why}`);
  process.exit(0);
};

if (process.env.CI) skip("CI 에서는 미배송이라는 상태가 없다");

try {
  git("rev-parse", "--git-dir");
} catch {
  skip("git 저장소가 아니다");
}

try {
  git("rev-parse", "--verify", BASE);
} catch {
  skip(`${BASE} 를 찾을 수 없다 (얕은 클론이거나 리모트 미설정)`);
}

const failures = [];

/* ---------- 1. 아직 커밋되지 않은 배송면 (--strict 에서만) ---------- */
/* 사고 1번. 하위 에이전트가 "완성" 을 보고했는데 파일이 작업 폴더에만 있던 자리다.
 *
 * 이건 기본 검사에서 뺀다. 코드를 고치는 동안 작업 폴더는 **당연히** 더럽고,
 * 그 상태로 `npm test` 가 빨간불이면 사람은 검사를 안 돌리게 된다. 꺼진 가드는 없는 가드다.
 * "이제 다 됐다" 를 주장하는 자리(`npm run ship`)에서만 켠다. */
if (STRICT) {
  /* `git status --porcelain` 은 상태 두 글자 + 공백이 앞에 붙는다. 그 접두사를 잘라 내는
     방식은 첫 줄의 선행 공백이 trim 에 먹혀 경로가 한 글자 밀린다 — 실제로 밀렸다.
     경로만 그대로 내놓는 명령 두 개로 대신한다. */
  const dirty = [
    ...git("diff", "--name-only", "HEAD", "--", ...SHIPPED).split("\n"),
    ...git("ls-files", "--others", "--exclude-standard", "--", ...SHIPPED).split("\n"),
  ].filter(Boolean);

  if (dirty.length) {
    failures.push(
      `커밋되지 않은 배송면 ${dirty.length}건 — 이 변경은 라이브에 존재하지 않는다.\n` +
        dirty.map((f) => `        ${f}`).join("\n") +
        `\n        → git add / git commit`
    );
  }
}

/* ---------- 2. 커밋됐지만 origin 에 없는 배송면 ---------- */
/* 사고 2번. Vercel 은 origin/main 을 보고 배포하므로, 여기 안 올라간 것은 안 나간 것이다. */
const unshipped = git("log", "--oneline", `${BASE}..HEAD`, "--", ...SHIPPED)
  .split("\n")
  .filter(Boolean);

if (unshipped.length) {
  failures.push(
    `${BASE} 에 없는 배송면 커밋 ${unshipped.length}건 — 라이브는 아직 옛 화면이다.\n` +
      unshipped.map((l) => `        ${l}`).join("\n") +
      `\n        → git push origin main (푸시가 Vercel 프로덕션 배포를 띄운다)`
  );
}

/* ---------- 결과 ---------- */

if (failures.length) {
  console.error(failures.map((f) => `FAIL  ${f}`).join("\n"));
  console.error(
    `\n배송면에 라이브까지 가지 않은 변경이 있다. ` +
      `**"고쳤습니다" 라고 보고하기 전에 여기를 비운다.**\n` +
      `배송면: ${SHIPPED.join(", ")}`
  );
  process.exit(1);
}

/* 배송면 밖(원고·문서·렌더러)이 밀려 있는 것은 실패가 아니지만, 알려는 준다. */
const otherPending = git("log", "--oneline", `${BASE}..HEAD`).split("\n").filter(Boolean).length;

console.log(
  `PASS  배송 가드${STRICT ? "(strict)" : ""} — 배송면(${SHIPPED.join(", ")})에 ` +
    `${STRICT ? "미커밋·" : ""}미푸시 없음. ` +
    `${BASE} 가 라이브와 같은 것을 가리킨다.` +
    (otherPending ? ` (배송면 밖 미푸시 ${otherPending}건 — 라이브에는 영향 없음)` : "")
);
