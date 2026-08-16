# Loop Smoke Test (Claude Code transport)

Manual end-to-end check that the `cvg-multi-session` Gate 0 transport binding
works on Claude Code: spawn, continue (resume from transcript), completion
notification, fresh-vs-same reviewer semantics. Run it before releases that
touch the loop skills. It consumes real agent tokens, so it is a manual gate,
not part of `bun test`.

## Setup

In a Claude Code session (the orchestrator), create a scratch workspace:

```bash
mkdir -p /tmp/cvg-loop-smoke
echo "spec: add.py must define add(a, b) returning the sum a + b" > /tmp/cvg-loop-smoke/SPEC.txt
```

## Phases and pass criteria

Each phase maps to a build-loop phase and one transport operation.

**Phase 1 — worker spawn (spawn operation).** Spawn a `general-purpose`
subagent told to create `/tmp/cvg-loop-smoke/add.py` with a *deliberately
wrong* body (`return a - b`) and to end with the worker callback template.

- Pass: tool result returns an agent id; callback matches the template.

**Phase 2 — fresh review (spawn, no history).** Spawn a *new* subagent with
the fresh-review boundary line, pointing at `add.py` and `SPEC.txt`,
blocker-only reporting, read-only, reviewer callback template.

- Pass: verdict `not ready` with one P0 finding naming the `a - b` bug.

**Phase 3 — feedback to same worker (continue operation).** `SendMessage` to
the *Phase 1 agent id* with the exact reviewer findings under
`Code Review Feedback Input`, instructing repair + verification.

- Pass: harness reports `resumed from transcript`; worker fixes `add.py` to
  `a + b`, reports verification, and a `<task-notification>` fires on
  completion.

**Phase 4 — focused re-review to same reviewer (continue operation).**
`SendMessage` to the *Phase 2 agent id* with `Review mode: focused-re-review`,
asking it to verify *its own* first-pass findings without restating them.

- Pass: the reviewer correctly recalls its own P0 finding from first-pass
  context (proof of transcript-based context retention) and confirms the fix
  with no new blockers.

**Phase 5 — final fresh exit (spawn, no history).** Spawn another *new*
reviewer subagent with the same Phase 2 prompt shape.

- Pass: verdict `ready to merge`, findings none.

## Overall pass

All five phase criteria met, and every specialist id used came from a tool
result (never from specialist prose). Expected cost: ~5 subagent runs of
~25k tokens each.

## Codex equivalent

The same scenario runs on Codex through the skill-local
`scripts/codex-app-server-transport.mjs` client:

1. Write each specialist prompt under the loop scratch directory.
2. Launch `start` through `exec_command` with a short yield and capture the
   `threadId` from its `thread_started` JSON event.
3. Verify the id with `read_thread`; confirm the transport event reports
   `approvalPolicy: never` and effective `sandbox: dangerFullAccess` (the
   thread request uses `sandbox: danger-full-access`).
4. Continue the worker or reviewer with the transport's `resume` operation,
   using the same thread id and worktree.
5. Confirm the specialist calls `convergo_callback` and the attached execution
   session prints one `specialist_callback` event with the exact callback text.
6. Use heartbeat waiting instead of task notifications; each wake-up reads the
   execution session and thread at most once.

Pass: every start and resume returns the same explicit full-access settings,
the specialist runs without command approvals, `read_thread` observes the
real persisted thread, and callback/fresh-review semantics match the Claude
phases above. A managed-policy rejection or downgraded App Server response
must fail before `turn/start`; a missing required callback must also fail the
transport.

## Hybrid transport (codex wrapper + orchestrator watcher)

End-to-end check of the ARMED-handoff transport in the two hybrid skills,
with a real codex session. Run it before releases that touch the
Codex-Backed Specialist Pattern. First verified 2026-07-12 (codex-cli
0.144.1, sonnet wrapper).

Scratch: `mkdir -p /tmp/cvg-hybrid-smoke`.

**Leg 1 — launch + ARMED.** Spawn a background sonnet wrapper with the
pattern's verbatim prompt (launch command with the `-m` pin and effort
override, ARMED instruction, fast path, source-of-truth rule, relay rule,
resume rule). Pass: ARMED callback naming the output and header paths; the
codex process survives the wrapper stopping.

**Leg 2 — watcher wake.** Arm the skill's verbatim watcher (background
Bash, `kill -0` on `<scratch>/codex.pid`). Pass: watcher exits `DONE` when
the `-o` file lands and its completion wakes the orchestrator.

**Leg 3 — relay.** `SendMessage` the wrapper "Relay now." Pass: the `-o`
content relayed verbatim plus a `Codex session: <id>` line.

**Leg 4 — resume + re-pin.** Send a follow-up task. Pass: the wrapper
greps the session id itself, launches `codex exec resume` with both `-c`
re-pins and round-2 files, ARMs again; the round-2 run header shows the
pinned model AND effort (the re-pin holding on resume is the load-bearing
assertion — an unpinned resume silently reverts to config defaults); the
round-2 relay returns the payload with the SAME session id.

**Leg 5 — DIED path.** Launch a long codex task through a fresh wrapper,
arm the watcher, then kill codex precisely via the pid file
(`kill "$(cat <scratch>/codex.pid)"`). Pass: the watcher exits `DIED`
within one poll interval and wakes the orchestrator; the relay request
returns `FAILURE` plus the run-header tail — no fabricated payload, no
relaunch. First verified 2026-07-12: kill at :04, DIED verdict delivered
by :19.

Liveness is probed through the pid file, never by matching command lines:
host hooks inject text (for example companion-plugin env exports
containing the string "codex") into every shell's argv, which makes
pgrep-style patterns self-match or miss unpredictably — this exact
failure was hit live before the pid-file design replaced the pattern.

Overall pass: all five legs, one codex launch per round, no wrapper nudges
needed outside the designed relay requests.
