---
name: cvg-hybrid-plan-loop
description: Orchestrate the plan loop with split engines - a high-taste Claude design model drafts and revises the plan while Codex CLI sessions gate it as fresh plan reviewers. Use when the user asks for a hybrid, split-model, or cross-model planning loop, such as fable planning with codex reviewing. Claude Code only.
argument-hint: "[brief or requirements path, plus optional engine overrides]"
---

# Hybrid Plan Loop

Run `cvg-plan-loop` with a fixed engine split: the planner runs on a
high-taste Claude design model, and every fresh plan reviewer runs in a Codex
CLI session. The design model's scarce quota is spent only where taste has
leverage — drafting and revising the plan; review rounds burn the cheap
engine. Cross-model review is also a feature: a different model family
reviewing the plan exposes blind spots same-model self-review tends to share.

## Prerequisites

- Claude Code as the orchestrating platform: the `Agent` tool `model`
  parameter and `SendMessage` continuation are required.
- A working `codex` CLI (`codex --version` succeeds) with the convergo codex
  plugin installed, so codex sessions can load role skills by name.
- Codex sessions run with whatever permissions the user's own codex
  configuration grants. Convergo passes no sandbox or permission flags;
  roles assume normal developer access — reading the repo and writing
  their /tmp/convergo findings and audit artifacts.

If either prerequisite fails, stop and report it. Do not silently fall back
to a single-engine loop; the user chose this skill for the split.

## Engine Bindings

Defaults; the user's invocation may override either tier.

| Tier | Default | Runs |
| --- | --- | --- |
| Design tier | Claude `fable` via the `Agent` tool `model` parameter | planner, plan revisions |
| Execution tier | `codex exec -m gpt-5.6-sol` at `model_reasoning_effort=high` — the current frontier codex pin, updated with plugin releases | fresh plan reviewers |

Before the first spawn, echo the resolved bindings in one line — planner
model, reviewer engine and model, round cap — so a binding mistake surfaces
before any specialist runs. If codex rejects the pinned execution-tier
model (a retired id), fall back to the model the user's codex config
resolves to — respawn the specialist wrapper with the model pin dropped,
initial `-m` and resume `-c` overrides both — echo what actually ran (the
`model:` line of the run header,
never an assumption), and flag it to the user if it sits below a frontier
model at high reasoning effort: cross-model review only pays if the
reviewing engine is near-peer.

## Procedure

Apply the `cvg-plan-loop` skill in full — same phases, protocol gates,
callback templates, and exit condition — with these routing overrides:

1. **Planner (Phase 1):** spawn as a native background specialist with the
   design-tier model. Everything else about the planner prompt is unchanged.
2. **Fresh plan reviewers (Phase 2 and every later fresh review):** spawn as
   codex-backed specialists (pattern below) with role skill
   `cvg-plan-review`.
3. **Plan review feedback:** unchanged — blockers return to the same
   design-tier planner session with `cvg-plan-review-feedback`.
4. **Exit:** unchanged — a fresh execution-tier reviewer reporting no
   blocking findings.

`codex exec` sessions expose a subagent primitive
(`collaboration.spawn_agent` — verified live): instruct codex plan
reviewers to dispatch their auxiliary personas through it and record the
returned child ids. Inline coverage marked `inline` in the callback remains
`cvg-plan-review`'s documented fallback and stays valid for plan reviews;
do not treat it as a blocker or ask the wrapper to relaunch codex to force
real dispatch.

## Codex-Backed Specialist Pattern

A codex-backed specialist satisfies the real-specialist gate (real,
addressable, continuable) by wrapping a Codex CLI session in a thin
background Claude agent:

- Spawn a background agent on a cheap model (`model: "sonnet"`), **without
  worktree isolation** — codex must run in the repo named in the specialist
  prompt, and an isolated wrapper worktree can be reclaimed out from under
  a still-running codex process. Its prompt instructs it to:
  1. compose one self-contained codex prompt from the specialist prompt it
     received — role skill to load, artifact paths, refs, boundaries, and the
     exact callback template; nothing else;
  2. launch codex exactly once as a background Bash command
     (`run_in_background: true` — codex runs routinely outlast the single
     foreground Bash timeout) from the repo named in the specialist prompt,
     with the final message written to a file and the run header captured:
     `codex exec -m <execution-model> -c model_reasoning_effort="<effort>"
     -o <scratch>/last-message.txt "<prompt>"
     > <scratch>/run-header.log 2>&1 </dev/null` (binding values from
     Engine Bindings, or the user's override). `<scratch>` is a
     per-specialist directory the orchestrator names in the specialist
     prompt, under the loop's `/tmp/convergo/<loop-slug>/` tree. Convergo
     passes no
     sandbox or permission flags: the session runs with whatever the
     user's codex configuration grants, and the reviewer's read-only
     conduct is a contract line in its role skill;
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
DONE; exit 0; }; pgrep -f "<scratch>" >/dev/null || { echo DIED; exit 0;
}; sleep 5; done; echo TIMEOUT`

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
  "<follow-up>" > <scratch>/run-header-<round>.log 2>&1 </dev/null`
  as a background Bash command and ends its turn ARMED again with the new
  paths; the orchestrator arms a fresh watcher on the new output file. The
  `-c` re-pin is load-bearing: `resume` does not accept
  `-m` and re-resolves model parameters from the user's codex config,
  silently dropping the first run's pin (verified live: a session launched
  at `low` effort resumed at the config default without the override).
- The wrapper must not read the repo, run other commands, review, summarize,
  or filter codex output. Relay fidelity is its whole job.
