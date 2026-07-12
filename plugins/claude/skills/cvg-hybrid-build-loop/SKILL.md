---
name: cvg-hybrid-build-loop
description: Orchestrate the build loop with split engines - Codex CLI sessions implement and take every first-pass review round while a high-taste Claude design model holds the final exit gate. Use when the user asks for a hybrid, split-model, or cross-model build loop, such as codex implementing with fable as the closer or final reviewer. Claude Code only.
argument-hint: "[plan path, plus optional engine overrides]"
---

# Hybrid Build Loop

Run `cvg-build-loop` with a tiered engine split: a Codex CLI session
implements, Codex CLI sessions take every first-pass review round, and a
high-taste Claude design model reviews only when the execution tier already
believes the work is clean. The design model is the exit gate inside the
protocol, not a closer bolted on after the loop: its blockers re-enter the
normal feedback cycle.

## Prerequisites

- Claude Code as the orchestrating platform: the `Agent` tool `model`
  parameter and `SendMessage` continuation are required.
- A working `codex` CLI (`codex --version` succeeds) with the convergo codex
  plugin installed, so codex sessions can load role skills by name.
- Codex sessions run with whatever permissions the user's own codex
  configuration grants. Convergo passes no sandbox or permission flags;
  roles assume normal developer access — reading and writing the repo,
  committing, and running the project's build and test commands.

If either prerequisite fails, stop and report it. Do not silently fall back
to a single-engine loop; the user chose this skill for the split.

## Engine Bindings

Defaults; the user's invocation may override either tier.

| Tier | Default | Runs |
| --- | --- | --- |
| Execution tier | `codex exec -m gpt-5.6-sol` at `model_reasoning_effort=high` — the current frontier codex pin, updated with plugin releases | worker, first-pass fresh reviews, QA workers |
| Design tier | Claude `fable` via the `Agent` tool `model` parameter | final-fresh-exit reviews |

Focused re-reviews always return to the reviewer session that raised the
findings, on whichever tier that session lives — unchanged protocol.

Before the first spawn, echo the resolved bindings in one line — worker
model and effort, reviewer engine, design-tier model, round cap — so a
binding mistake surfaces before any specialist runs. If codex rejects the
pinned execution-tier model (a retired id), fall back to the model the
user's codex config resolves to — respawn the specialist wrapper with the
model pin dropped, initial `-m` and resume `-c` overrides both — echo what
actually ran (the `model:`
line of the run header, never an assumption), and flag it to the user if
it sits below a frontier model at high reasoning effort: the tier split's
economics assume execution is nearly as capable as the design tier.

## Procedure

Apply the `cvg-build-loop` skill in full — same phases, protocol gates,
callback templates, and round cap — with these routing overrides:

1. **Worker (Phase 1):** codex-backed specialist (pattern below), role
   skill `cvg-work`.
2. **Fresh code review (Phase 2):** codex-backed specialist (pattern
   below), role skill `cvg-code-review`. `codex exec` sessions expose a
   subagent primitive (`collaboration.spawn_agent` — verified live):
   instruct codex reviewers to dispatch their auxiliary personas through
   it and record the returned child ids in the coverage object. Inline
   coverage remains the role skill's documented fallback when a spawn
   fails. Either way, codex-side child ids reach the orchestrator only
   through the relay — self-reported — so execution-tier coverage still
   never satisfies the final-fresh-exit condition, which is one more
   reason the final gate below is a native design-tier specialist whose
   dispatches the orchestrator verifies from its own tool results.
3. **Feedback (Phase 3):** unchanged — blockers return to the codex-backed
   worker with `cvg-code-review-feedback`.
4. **Tiered exit (Phase 5 override):** a clean execution-tier fresh review
   never exits the loop; it is a promotion. Spawn the
   `Review mode: final-fresh-exit` reviewer as a native design-tier
   specialist (`model: "fable"`, role skill `cvg-code-review`).
   - Design-tier review clean: the loop exits.
   - Design-tier blockers: normal Phase 3 feedback to the worker, focused
     re-review by the same design-tier session, and on pass the next fresh
     first review starts again at the execution tier before the next
     promotion.
   - Every feedback-repair-re-review-fresh-review cycle counts as one round
     against the cap, regardless of which tier raised the blockers.
5. **Design-tier cost control:** in the design-tier reviewer prompt, instruct
   that auxiliary persona subagents be spawned on a cheaper Claude model (for
   example `model: "opus"`); synthesis and the verdict stay on the design
   tier.
6. **QA (Phase 6):** execution tier.

## Cross-Repo Plans

One loop drives one worker in one repo. A plan whose slices or invariant
matrix span multiple repos is NOT completed by one loop. When Phase 0 finds
more than one repo in scope:

- declare the repo split and build order to the user before spawning the
  worker (the contract-source repo usually goes first), including which
  slices are runnable in parallel rather than blocked;
- scope this loop and its reviewer prompts to that one repo's slices;
- after this loop exits, the remaining repos' slices are open work — launch
  the next repo's loop or hand the sequencing decision to the user;
- never present a single-repo exit as plan completion: the completion
  summary must list every repo the plan names that this loop did not cover
  as blocking known gaps.

## Codex-Backed Specialist Pattern

A codex-backed specialist satisfies the real-specialist gate (real,
addressable, continuable) by wrapping a Codex CLI session in a thin
background Claude agent:

- Spawn a background agent on a cheap model (`model: "sonnet"`), **without
  worktree isolation** — codex must run in the worktree named in the
  specialist prompt, and an isolated wrapper worktree can be reclaimed out
  from under a still-running codex process. Its prompt instructs it to:
  1. compose one self-contained codex prompt from the specialist prompt it
     received — role skill to load, artifact paths, refs, boundaries, and the
     exact callback template; nothing else;
  2. launch codex exactly once as a background Bash command
     (`run_in_background: true` — codex runs routinely outlast the single
     foreground Bash timeout) from the worktree named in the specialist
     prompt, workers and reviewers alike, with the final message written
     to a file and the run header captured:
     `codex exec -m <execution-model> -c model_reasoning_effort="<effort>"
     -o <scratch>/last-message.txt "<prompt>"
     > <scratch>/run-header.log 2>&1 </dev/null &
     echo $! > <scratch>/codex.pid; wait "$(cat <scratch>/codex.pid)"`
     (binding values from Engine
     Bindings, or the user's override; the pid file is what the
     orchestrator's watcher probes for liveness). `<scratch>` is a per-specialist
     directory the orchestrator names in the specialist prompt, under the
     loop's `/tmp/convergo/<loop-slug>/` tree. Convergo passes no sandbox or
     permission flags: the session runs with whatever the user's codex
     configuration grants, and role boundaries (a reviewer does not modify
     the repo) are contract lines in the role skills;
  3. end its turn immediately after the launch, with an ARMED callback
     naming the paths:
     `ARMED. Codex running. Output: <scratch>/last-message.txt. Header:
     <scratch>/run-header.log.`
     Do not wait for codex in-turn and do not poll: completion notices
     queue in a stopped wrapper's transcript without waking it (verified
     live), and the orchestrator owns the waiting — see the watcher below;
  4. when the orchestrator messages it to relay, read the `-o` file and
     relay its content verbatim as its own final message, appending one
     line: `Codex session: <session-id>` (grep `session id:` from the run
     header log).

The `-o` file is the source of truth, not the exit code. Codex can exit
nonzero after a completed run (shutdown or hook noise), so a "command
failed" report with a non-empty `-o` file still means success — relay it.
Never relaunch codex because of the exit code alone; treat the run as
failed only when the process has exited and the `-o` file is still empty,
and then relay the tail of the run header log as a failure callback
instead of retrying. Append `</dev/null` to the codex command so it never
waits on stdin.

The orchestrator waits, not the wrapper. On the ARMED callback, arm a
background watcher on the named output file (`run_in_background: true`):

`for i in $(seq 1 1440); do [ -s <scratch>/last-message.txt ] && { echo
DONE; exit 0; }; p=$(cat <scratch>/codex.pid 2>/dev/null); [ -n "$p" ] &&
kill -0 "$p" 2>/dev/null || { echo DIED; exit 0; }; sleep 5; done; echo
TIMEOUT`

(Liveness is probed through the pid file, never by matching command lines:
host hooks inject text into every shell's argv, which makes pgrep-style
patterns self-match or miss unpredictably — verified live. `kill -0` on
the recorded pid is argv-independent.)

Its completion wakes the orchestrator. On DONE or DIED, `SendMessage` the
wrapper to relay now; the wrapper applies the source-of-truth rule above.
On TIMEOUT (two hours), escalate to the user. A background watcher that
exits when its condition holds is the platform's own single-completion
shape — it is not in-turn waiting.

Fast path: when codex completes while the wrapper is still in its launch
turn (the completion notice arrives in-turn), the wrapper relays
immediately instead of ARMED. A relay-shaped first callback — payload plus
`Codex session:` line — is the result; skip the watcher.
- The wrapper agent id from the `Agent` tool result is the specialist id.
  Record the codex session id beside it for continuation.
- Continue the specialist with `SendMessage` to the same wrapper; the wrapper
  launches
  `codex exec resume <session-id> -c model="<execution-model>"
  -c model_reasoning_effort="<effort>" -o <scratch>/last-message-<round>.txt
  "<follow-up>" > <scratch>/run-header-<round>.log 2>&1 </dev/null &
  echo $! > <scratch>/codex.pid; wait "$(cat <scratch>/codex.pid)"`
  as a background Bash command and ends its turn ARMED again with the new
  paths; the orchestrator arms a fresh watcher on the new output file. The
  `-c` re-pin is load-bearing: `resume` does not accept
  `-m` and re-resolves model parameters from the user's codex config,
  silently dropping the first run's pin (verified live: a session launched
  at `low` effort resumed at the config default without the override).
- The wrapper must not read the repo, run other commands, review, summarize,
  or filter codex output. Relay fidelity is its whole job.

## Why the Exit Is Tiered

No one can know in advance which fresh review will be the last one, so the
scarce design model cannot simply "take the final round". Instead the exit
condition itself is two-level: an execution-tier clean review is necessary
but never sufficient, and only a clean design-tier `final-fresh-exit` review
ends the loop. The design model therefore runs exactly when the cheap engine
believes the work is done — typically once or twice per loop.
