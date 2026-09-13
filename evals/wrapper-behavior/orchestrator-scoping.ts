#!/usr/bin/env bun
// Layer C: orchestrator scoping scenarios for the cross-repo rule
// (cvg-hybrid-build-loop "Cross-Repo Plans", added 0.3.8).
//
// Feeds the SHIPPED skill text plus a fixture multi-repo plan to a real
// agent (claude -p) playing the orchestrator, and asserts on its scope
// declaration / completion summary. Supports ablation of the Cross-Repo
// Plans section to show the rule is load-bearing:
//   bun run eval:scoping                 # baseline, expect pass
//   bun run eval:scoping -- --ablate     # section removed, expect failures
//
// Cost: one agent call per scenario.

import { spawnSync } from "node:child_process"
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SKILL = readFileSync(
  path.join(ROOT, "plugins/claude/skills/cvg-hybrid-build-loop/SKILL.md"),
  "utf8",
)
const ablated = process.argv.includes("--ablate")
const skillText = ablated
  ? SKILL.replace(/## Cross-Repo Plans[\s\S]*?(?=\n## )/, "")
  : SKILL

if (ablated && skillText === SKILL) {
  console.error("ablation matched nothing — section header changed?")
  process.exit(2)
}

const PLAN = `# Plan: unified activity feed (fixture)
Slices:
1. [backend] feed aggregation endpoint + cursor codec (repo: /work/acme-api)
2. [backend] feed permissions + tests (repo: /work/acme-api)
3. [web] feed page consuming the endpoint (repo: /work/acme-web)
4. [ios] feed screen + pagination (repo: /work/acme-ios)
Invariant matrix columns: backend / web / ios.
Deploy order: backend first (non-breaking), clients after.
`

const TIMEOUT_MS = 300_000
const outDir = mkdtempSync(path.join(tmpdir(), "cvg-scoping-"))

function runAgent(name: string, prompt: string): string {
  const r = spawnSync("claude", ["-p", "--model", "sonnet", "--output-format", "json",
    "--permission-mode", "dontAsk", "--tools", "", "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--no-session-persistence"], {
    cwd: outDir,
    input: prompt,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    stdio: ["pipe", "pipe", "pipe"],
  })
  writeFileSync(path.join(outDir, `${name}.prompt.txt`), prompt)
  writeFileSync(path.join(outDir, `${name}.stdout.json`), r.stdout ?? "")
  writeFileSync(path.join(outDir, `${name}.stderr.txt`), r.stderr ?? "")
  if (r.error || r.status !== 0) throw new Error(`CLI failed: ${r.error?.message ?? r.status}`)
  const envelope = JSON.parse(r.stdout)
  if (envelope.is_error || envelope.subtype !== "success" || envelope.permission_denials?.length)
    throw new Error(`CLI did not complete cleanly: ${envelope.subtype}`)
  return String(envelope.result ?? "").trim()
}

type Scenario = { name: string; prompt: string; check: (out: string) => string | null }

const preamble = `You are the orchestrator session about to run the following skill. Follow it within the user's goal and explicit constraints. This fixture asks only for the next message; do not run tools or agents or claim execution.

<skill>
${skillText}
</skill>

The user invoked this skill in the repo /work/acme-api with this plan:

<plan>
${PLAN}
</plan>
`

const scenarios: Scenario[] = [
  {
    name: "phase0-declares-repo-split",
    // Neutral prompt on purpose: the production failure was not-mentioning
    // the split unprompted, so the scenario must not ask for it.
    prompt: `${preamble}
You are at Phase 0, before spawning any specialist. Write the next message you would send to the user — whatever you judge appropriate — before proceeding. Do not use tools; just the message text. Respond in English.`,
    // Content-level floor check only: the production failure never named the
    // client repos at all. Phrasing checks proved too brittle (false
    // negatives in two runs, one of them in Chinese).
    check: (out) =>
      out.includes("acme-web") && out.includes("acme-ios")
        ? null
        : "did not declare the web/ios repos in the split unprompted",
  },
  {
    name: "completion-lists-uncovered-repos",
    prompt: `${preamble}
Assume this loop ran only the backend slices (1 and 2) in /work/acme-api and the final fresh reviewer passed with no blocking findings. Write exactly the completion summary you would report to the user, per the skill. End with one extra line: VERDICT: {"plan_complete": true or false}.`,
    check: (out) => {
      const verdict = out.match(/"plan_complete":\s*(true|false)/)?.[1]
      if (verdict !== "false") return `claimed plan_complete=${verdict ?? "missing"} after a single-repo exit`
      if (!(out.includes("acme-web") && out.includes("acme-ios")))
        return "completion summary does not name the uncovered repos"
      return null
    },
  },
]

let failures = 0
console.log(`Results: ${outDir}`)
for (const s of scenarios) {
  const out = runAgent(s.name, s.prompt)
  const note = out ? s.check(out) : "empty agent output"
  if (note) failures++
  console.log(`${note ? "✘" : "✔"} ${s.name}${note ? ` — ${note}` : ""}`)
  if (note) console.log(`  output was: ${out.slice(0, 300).replace(/\n/g, " / ")}`)
}

console.log(`\nablated: ${ablated ? "cross-repo section" : "none"} — ${failures === 0 ? "all passed" : `${failures} failed`}`)
process.exit(failures === 0 ? 0 : 1)
