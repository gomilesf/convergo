#!/usr/bin/env bun
// Ground-truth canary for the hybrid skills' resume re-pin: `codex exec
// resume` does not accept -m and re-resolves model parameters from the
// user's config, silently dropping the first run's pin. The skills
// compensate with `-c model=` / `-c model_reasoning_effort=` on every
// resume — this canary asserts that compensation still holds, and reports
// what an unoverridden resume resolves to. Three real codex calls; rerun
// after every codex CLI upgrade:
//   bun run eval:repin
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const MODEL = "gpt-5.6-sol"
const work = mkdtempSync(path.join(tmpdir(), "cvg-repin-"))

// codex refuses untrusted non-git working directories; run from the repo.
function run(args: string[]): string {
  const r = spawnSync("codex", args, {
    encoding: "utf8",
    cwd: process.cwd(),
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return `${r.stdout ?? ""}${r.stderr ?? ""}`
}
const effortOf = (out: string) => out.match(/reasoning effort: (\S+)/)?.[1] ?? "?"

const first = run(["exec", "-m", MODEL, "-c", 'model_reasoning_effort="low"', "-o", `${work}/a.txt`, "Reply with exactly: A"])
const sid = first.match(/session id: ([0-9a-f-]+)/)?.[1]
if (!sid) {
  console.log(`✘ no session id in first-run header:\n${first.slice(0, 400)}`)
  process.exit(1)
}
if (effortOf(first) !== "low") {
  console.log(`✘ first run resolved effort ${effortOf(first)}, want low — pin form broken`)
  process.exit(1)
}

const bare = run(["exec", "resume", sid, "-o", `${work}/b.txt`, "Reply with exactly: B"])
const pinned = run(["exec", "resume", sid, "-c", `model="${MODEL}"`, "-c", 'model_reasoning_effort="low"', "-o", `${work}/c.txt`, "Reply with exactly: C"])
rmSync(work, { recursive: true, force: true })

console.log(`bare resume resolves effort: ${effortOf(bare)} (config default; informational)`)
if (effortOf(bare) === "low") {
  console.log("note: bare resume kept the pin — codex semantics changed; the skills' -c re-pin may be deletable")
}
if (effortOf(pinned) !== "low") {
  console.log(`✘ re-pinned resume resolved effort ${effortOf(pinned)}, want low — the skills' -c re-pin no longer holds`)
  process.exit(1)
}
console.log("✔ re-pinned resume holds the pinned effort")
