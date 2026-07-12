#!/usr/bin/env bun
// Layer A: wrapper-compliance scenarios for the hybrid-loop codex wrapper
// pattern (ARMED-handoff design: the wrapper launches codex in the
// background and ends its turn; the ORCHESTRATOR watches the output file
// and messages the wrapper to relay). Spawns a REAL sonnet wrapper agent
// (claude -p) against a STUB codex binary, two phases per scenario:
//   phase 1  launch + ARMED — the wrapper must NOT wait in-turn
//   phase 2  resume the same claude session with a relay request
//
// Supports ablation: --ablate <RULE>[,<RULE>] removes a rule block from the
// wrapper prompt so you can measure whether a rule is load-bearing.
// Rules: R_ARM (end turn immediately with the ARMED message), R_EXITCODE
// (-o file is the source of truth), R_ONCE (launch exactly once), R_RELAY
// (verbatim + session line).
//
// Cost: two sonnet turns per scenario. Run manually:
//   bun run eval:wrapper                 # all scenarios, full prompt
//   bun run eval:wrapper -- --ablate R_ARM
//   bun run eval:wrapper -- --only arm-and-relay

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, chmodSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const HERE = import.meta.dir
const STUB_DIR_SRC = path.join(HERE, "stub")
// Per-phase deadline. An R_ARM-ablated wrapper falls back to waiting
// in-turn and hits this instead of ARMing — the duration assertion in
// phase 1 is what makes that a failure, not a hang.
const TIMEOUT_MS = 180_000

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
    `You are a thin launcher/relay wrapper around a Codex CLI session. Do not read any repository, review, summarize, or filter codex output.`,
    `1. Launch codex exactly once as a background Bash command (run_in_background: true):\ncodex exec -m gpt-5.6-sol -c model_reasoning_effort="high" -o ${o} "Do the assigned task." > ${header} 2>&1 </dev/null & echo $! > ${work}/codex.pid; wait "$(cat ${work}/codex.pid)"\nRun it verbatim — do not drop, reorder, or "simplify" any flag.`,
  ]
  if (!rules.has("R_ARM")) parts.push(
    `2. End your turn immediately after launching. Your message must be exactly:\nARMED. Codex running. Output: ${o}. Header: ${header}.\nDo not wait for codex, do not sleep, do not poll — the orchestrator watches the output file and will message you when it is time to relay. Fast path: only if codex has ALREADY completed within this same turn, relay per rule 5 instead of ARMED.`,
  )
  if (!rules.has("R_EXITCODE")) parts.push(
    `3. The -o file is the source of truth, not the exit code. Codex can exit nonzero after a completed run, so a "command failed" report with a non-empty -o file still means success — relay it. Treat the run as failed only when the process has exited and the -o file is still empty; then relay the tail of ${header} as a failure report instead of retrying.`,
  )
  if (!rules.has("R_ONCE")) parts.push(
    `4. Never relaunch codex, whatever happens. One launch per lifetime of this task.`,
  )
  if (!rules.has("R_RELAY")) parts.push(
    `5. When asked to relay: your final message is the -o file content verbatim, then one line \`Codex session: <session-id>\` (grep "session id:" from ${header}). On failure per rule 3, final message: FAILURE + the header tail. Do not add anything else.`,
  )
  return parts.join("\n\n")
}

type Scenario = {
  name: string
  env: Record<string, string>
  relay: boolean
  check: (armMsg: string, relayMsg: string, work: string, armMs: number) => string | null
}

function invocations(work: string): number {
  const f = path.join(work, "state", "argv.log")
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).length : 0
}

const scenarios: Scenario[] = [
  {
    name: "arm-fast", // slow codex: the wrapper must ARM and stop, not wait
    // delay 60 outlives the wrapper's launch turn; an R_ARM-ablated wrapper
    // waits the full 60s for the file and blows the duration bound.
    env: { CODEX_STUB_MODE: "ok", CODEX_STUB_DELAY: "60", CODEX_STUB_TAG: "SLOW" },
    relay: false,
    check: (armMsg, _relayMsg, work, armMs) => {
      if (!/\bARMED\b/.test(armMsg)) return `phase 1 message is not an ARMED callback: ${armMsg.slice(0, 120)}`
      if (armMs > 55_000) return `phase 1 took ${Math.round(armMs / 1000)}s — wrapper waited instead of arming`
      if (invocations(work) !== 1) return `codex launched ${invocations(work)} times, want 1`
      return null
    },
  },
  {
    name: "relay-on-request", // fast codex: payload relayed verbatim, either in-turn (fast path) or on request
    env: { CODEX_STUB_MODE: "ok", CODEX_STUB_DELAY: "2", CODEX_STUB_TAG: "OK" },
    relay: true,
    check: (armMsg, relayMsg, work) => {
      const finalMsg = relayMsg || armMsg
      if (!finalMsg.includes("STUB-RELAY-PAYLOAD OK") && !armMsg.includes("STUB-RELAY-PAYLOAD OK")) return "payload not relayed verbatim"
      if (!finalMsg.match(/Codex session: 00000000-dead-beef/) && !armMsg.match(/Codex session: 00000000-dead-beef/)) return "session id line missing"
      if (invocations(work) !== 1) return `codex launched ${invocations(work)} times, want 1`
      return null
    },
  },
  {
    name: "exit1-with-output", // the R4 incident: nonzero exit, complete result
    env: { CODEX_STUB_MODE: "exit1-with-output", CODEX_STUB_DELAY: "2", CODEX_STUB_TAG: "EXIT1" },
    relay: true,
    check: (_armMsg, relayMsg, work) => {
      if (!relayMsg.includes("STUB-RELAY-PAYLOAD EXIT1")) return "payload not relayed despite non-empty -o file"
      if (invocations(work) !== 1) return `codex relaunched (${invocations(work)} launches) after exit 1 — burns a full duplicate run`
      return null
    },
  },
  {
    name: "exit1-empty", // true failure: must report, not retry, not fabricate
    env: { CODEX_STUB_MODE: "exit1-empty", CODEX_STUB_DELAY: "2" },
    relay: true,
    check: (_armMsg, relayMsg, work) => {
      if (invocations(work) !== 1) return `codex relaunched (${invocations(work)} launches) on hard failure`
      if (relayMsg.includes("STUB-RELAY-PAYLOAD")) return "fabricated a payload that was never written"
      if (!/fail|FAILURE|error/i.test(relayMsg)) return "failure not reported"
      return null
    },
  },
  {
    name: "command-fidelity", // flags must survive verbatim (-m pin, effort, -o path, prompt)
    env: { CODEX_STUB_MODE: "ok", CODEX_STUB_DELAY: "1", CODEX_STUB_TAG: "FIDELITY" },
    relay: false,
    check: (_armMsg, _relayMsg, work) => {
      const argv = readFileSync(path.join(work, "state", "argv.log"), "utf8")
      if (!argv.includes("-m gpt-5.6-sol")) return "-m model pin dropped from the command"
      if (!argv.includes("model_reasoning_effort=high")) return "effort override dropped from the command"
      if (!argv.includes(`-o ${work}/last-message.txt`)) return "-o flag dropped from the command"
      if (!argv.includes("Do the assigned task.")) return "prompt not passed verbatim"
      if (!existsSync(path.join(work, "codex.pid"))) return "codex.pid not written — the watcher's liveness probe has nothing to read"
      return null
    },
  },
]

function claudeP(args: string[], env: Record<string, string>): { out: string; sid: string | null } {
  const r = spawnSync("claude", [...args, "--model", "sonnet", "--dangerously-skip-permissions", "--output-format", "json"], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  try {
    const parsed = JSON.parse((r.stdout ?? "").trim())
    return { out: String(parsed.result ?? ""), sid: parsed.session_id ?? null }
  } catch {
    return { out: (r.stdout ?? "").trim(), sid: null }
  }
}

let failures = 0
for (const s of scenarios) {
  if (only && s.name !== only) continue
  const work = mkdtempSync(path.join(tmpdir(), `cvg-wrapper-${s.name}-`))
  const state = path.join(work, "state")
  const bin = path.join(work, "bin")
  mkdirSync(state); mkdirSync(bin)
  const stub = readFileSync(path.join(STUB_DIR_SRC, "codex"))
  const stubPath = path.join(bin, "codex")
  writeFileSync(stubPath, stub)
  chmodSync(stubPath, 0o755)
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_STUB_DIR: state, ...s.env }

  const t0 = Date.now()
  const phase1 = claudeP(["-p", wrapperPrompt(work, ablate)], env)
  const armMs = Date.now() - t0

  let relayMsg = ""
  if (s.relay) {
    // give the stub time to finish (delay + margin) before requesting the relay
    const settle = (Number(s.env.CODEX_STUB_DELAY ?? "2") + 3) * 1000
    Bun.sleepSync(Math.max(0, settle - armMs))
    if (!phase1.sid) {
      failures++
      console.log(`✘ ${s.name} — no session id from phase 1, cannot request relay`)
      rmSync(work, { recursive: true, force: true })
      continue
    }
    relayMsg = claudeP(["-p", "--resume", phase1.sid, "Relay now."], env).out
  }

  let note: string | null
  try {
    note = s.check(phase1.out, relayMsg, work, armMs)
  } catch (err) {
    note = `error: ${(err as Error).message}`
  }
  if (note) failures++
  console.log(`${note ? "✘" : "✔"} ${s.name}${note ? ` — ${note}` : ""}`)
  if (note) {
    console.log(`  phase1 (${Math.round(armMs / 1000)}s): ${phase1.out.slice(0, 200).replace(/\n/g, " / ")}`)
    if (s.relay) console.log(`  phase2: ${relayMsg.slice(0, 200).replace(/\n/g, " / ")}`)
  }
  rmSync(work, { recursive: true, force: true })
}

const ablated = [...ablate].join(",") || "none"
console.log(`\nablated: ${ablated} — ${failures === 0 ? "all scenarios passed" : `${failures} failed`}`)
process.exit(failures === 0 ? 0 : 1)
