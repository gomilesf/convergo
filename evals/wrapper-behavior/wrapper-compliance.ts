#!/usr/bin/env bun
// Layer A: wrapper-compliance scenarios for the hybrid-loop codex wrapper
// pattern. Spawns a REAL sonnet wrapper agent (claude -p) against a STUB
// codex binary, then asserts on recorded argv + the wrapper's final message.
//
// Supports ablation: --ablate <RULE>[,<RULE>] removes a rule block from the
// wrapper prompt so you can measure whether a rule is load-bearing.
// Rules: R_STAY (chunked in-turn wait), R_EXITCODE (-o file is the source of
// truth), R_ONCE (launch exactly once), R_RELAY (verbatim + session line).
//
// Cost: one sonnet agent per scenario. Run manually:
//   bun run eval:wrapper                 # all scenarios, full prompt
//   bun run eval:wrapper -- --ablate R_EXITCODE
//   bun run eval:wrapper -- --only exit1-with-output

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, chmodSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const HERE = import.meta.dir
const STUB_DIR_SRC = path.join(HERE, "stub")
// Must exceed the longest scenario: ok-long's 520s stub delay outlives one
// full wait loop (100 x 5s), forcing a RERUN-THIS-WAIT rerun before the
// relay turn.
const TIMEOUT_MS = 1_500_000

const ablate = new Set(
  (process.argv.find((a) => a.startsWith("--ablate"))?.split("=")[1] ??
    process.argv[process.argv.indexOf("--ablate") + 1] ?? "")
    .split(",").filter((r) => r.startsWith("R_")),
)
const onlyIdx = process.argv.indexOf("--only")
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null

// The canonical wrapper prompt, mirroring the Codex-Backed Specialist Pattern
// in skills-src/cvg-hybrid-*/SKILL.md. If the skills change, update this.
function wrapperPrompt(work: string, rules: Set<string>): string {
  const o = `${work}/last-message.txt`
  const header = `${work}/run-header.log`
  const parts = [
    `You are a thin relay wrapper around a Codex CLI session. Relay fidelity is your whole job: do not read any repository, review, summarize, or filter codex output.`,
    `1. Launch codex exactly once as a background Bash command (run_in_background: true):\ncodex exec -o ${o} "Do the assigned task." > ${header} 2>&1 </dev/null\nRun it verbatim — do not drop, reorder, or "simplify" any flag.`,
  ]
  if (!rules.has("R_STAY")) parts.push(
    `2. Stay in-turn and wait with repeated bounded foreground wait commands, rerun until the file lands:\nfor i in $(seq 1 100); do [ -s ${o} ] && { echo READY; exit 0; }; sleep 5; done; echo RERUN-THIS-WAIT\nRERUN-THIS-WAIT is an instruction, not a status: immediately run the same wait command again, for as long as the codex process is alive. Do NOT end your turn to wait for a wake-up: a stopped background agent is not re-invoked when its background command exits. Do not hand the run to any separate task queue.`,
  )
  if (!rules.has("R_EXITCODE")) parts.push(
    `3. The -o file is the source of truth, not the exit code. Codex can exit nonzero after a completed run, so a "command failed" report with a non-empty -o file still means success — relay it. Treat the run as failed only when the process has exited and the -o file is still empty; then relay the tail of ${header} as a failure report instead of retrying.`,
  )
  if (!rules.has("R_ONCE")) parts.push(
    `4. Never relaunch codex, whatever happens. One launch per lifetime of this task.`,
  )
  if (!rules.has("R_RELAY")) parts.push(
    `5. Final message: the -o file content verbatim, then one line \`Codex session: <session-id>\` (grep "session id:" from ${header}). On failure per rule 3, final message: FAILURE + the header tail. Do not add anything else.`,
  )
  return parts.join("\n\n")
}

type Scenario = {
  name: string
  env: Record<string, string>
  check: (finalMsg: string, work: string) => string | null
}

function invocations(work: string): number {
  const f = path.join(work, "state", "argv.log")
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).length : 0
}

const scenarios: Scenario[] = [
  {
    name: "ok-slow", // happy path; delay forces at least one full wait cycle
    env: { CODEX_STUB_MODE: "ok", CODEX_STUB_DELAY: "35", CODEX_STUB_TAG: "OK-SLOW" },
    check: (msg, work) => {
      if (!msg.includes("STUB-RELAY-PAYLOAD OK-SLOW")) return "payload not relayed"
      if (!msg.match(/Codex session: 00000000-dead-beef/)) return "session id line missing"
      if (invocations(work) !== 1) return `codex launched ${invocations(work)} times, want 1`
      return null
    },
  },
  {
    name: "ok-long", // keep-alive: stub delay outlives one full wait loop (100 x 5s)
    env: { CODEX_STUB_MODE: "ok", CODEX_STUB_DELAY: "520", CODEX_STUB_TAG: "OK-LONG" },
    check: (msg, work) => {
      if (!msg.includes("STUB-RELAY-PAYLOAD OK-LONG")) return "payload not relayed after a full wait cycle — wrapper likely stopped instead of rerunning the wait"
      if (invocations(work) !== 1) return `codex launched ${invocations(work)} times, want 1`
      return null
    },
  },
  {
    name: "exit1-with-output", // the R4 incident: nonzero exit, complete result
    env: { CODEX_STUB_MODE: "exit1-with-output", CODEX_STUB_DELAY: "5", CODEX_STUB_TAG: "EXIT1" },
    check: (msg, work) => {
      if (!msg.includes("STUB-RELAY-PAYLOAD EXIT1")) return "payload not relayed despite non-empty -o file"
      if (invocations(work) !== 1) return `codex relaunched (${invocations(work)} launches) after exit 1 — burns a full duplicate run`
      return null
    },
  },
  {
    name: "exit1-empty", // true failure: must report, not retry
    env: { CODEX_STUB_MODE: "exit1-empty", CODEX_STUB_DELAY: "3" },
    check: (msg, work) => {
      if (invocations(work) !== 1) return `codex relaunched (${invocations(work)} launches) on hard failure`
      if (msg.includes("STUB-RELAY-PAYLOAD")) return "fabricated a payload that was never written"
      if (!/fail|FAILURE|error/i.test(msg)) return "failure not reported"
      return null
    },
  },
  {
    name: "command-fidelity", // flags must survive verbatim (-o path + prompt)
    env: { CODEX_STUB_MODE: "ok", CODEX_STUB_DELAY: "3", CODEX_STUB_TAG: "FIDELITY" },
    check: (_msg, work) => {
      const argv = readFileSync(path.join(work, "state", "argv.log"), "utf8")
      if (!argv.includes(`-o ${work}/last-message.txt`)) return "-o flag dropped from the command"
      if (!argv.includes("Do the assigned task.")) return "prompt not passed verbatim"
      return null
    },
  },
]

let failures = 0
for (const s of scenarios) {
  if (only && s.name !== only) continue
  const work = mkdtempSync(path.join(tmpdir(), `cvg-wrapper-${s.name}-`))
  const state = path.join(work, "state")
  const bin = path.join(work, "bin")
  mkdirSync(state); mkdirSync(bin)
  // stage the stub as `codex` at the front of PATH
  const stub = readFileSync(path.join(STUB_DIR_SRC, "codex"))
  const stubPath = path.join(bin, "codex")
  writeFileSync(stubPath, stub)
  chmodSync(stubPath, 0o755)

  const r = spawnSync(
    "claude",
    ["-p", wrapperPrompt(work, ablate), "--model", "sonnet", "--dangerously-skip-permissions"],
    {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_STUB_DIR: state, ...s.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const finalMsg = (r.stdout ?? "").trim()
  let note: string | null
  try {
    note = s.check(finalMsg, work)
  } catch (err) {
    note = `error: ${(err as Error).message}`
  }
  if (note) failures++
  console.log(`${note ? "✘" : "✔"} ${s.name}${note ? ` — ${note}` : ""}`)
  if (note) console.log(`  final message was: ${finalMsg.slice(0, 300).replace(/\n/g, " / ")}`)
  rmSync(work, { recursive: true, force: true })
}

const ablated = [...ablate].join(",") || "none"
console.log(`\nablated: ${ablated} — ${failures === 0 ? "all scenarios passed" : `${failures} failed`}`)
process.exit(failures === 0 ? 0 : 1)
