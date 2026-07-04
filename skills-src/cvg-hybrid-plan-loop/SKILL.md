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

If either prerequisite fails, stop and report it. Do not silently fall back
to a single-engine loop; the user chose this skill for the split.

## Engine Bindings

Defaults; the user's invocation may override either tier.

| Tier | Default | Runs |
| --- | --- | --- |
| Design tier | Claude `fable` via the `Agent` tool `model` parameter | planner, plan revisions |
| Execution tier | `codex exec` with the user's configured model (recommended: a frontier codex model at high reasoning effort) | fresh plan reviewers |

## Procedure

Apply the `cvg-plan-loop` skill in full — same phases, protocol gates,
callback templates, and exit condition — with these routing overrides:

1. **Planner (Phase 1):** spawn as a native background specialist with the
   design-tier model. Everything else about the planner prompt is unchanged.
2. **Fresh plan reviewers (Phase 2 and every later fresh review):** spawn as
   codex-backed specialists (pattern below) with the reviewer sandbox and
   role skill `cvg-plan-review`.
3. **Plan review feedback:** unchanged — blockers return to the same
   design-tier planner session with `cvg-plan-review-feedback`.
4. **Exit:** unchanged — a fresh execution-tier reviewer reporting no
   blocking findings.

Codex sessions run through `codex exec`, which has no generic subagent
primitive, so expect the reviewer's auxiliary personas to run inline —
`cvg-plan-review`'s documented fallback. Inline coverage marked `inline` in
the callback is valid for plan reviews; do not treat it as a blocker or ask
the wrapper to nest codex sessions to force real dispatch.

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
     foreground Bash timeout), with the final message written to a file and
     the run header captured:
     `codex exec --sandbox workspace-write -C <scratch>
     --skip-git-repo-check -o <scratch>/last-message.txt "<prompt>"
     > <scratch>/run-header.log 2>&1 </dev/null` — the
     `--skip-git-repo-check` is required because codex checks the process
     working directory, and a scratch directory is not a git repo. The
     reviewer sandbox is `workspace-write` launched from a
     scratch working directory: reads are unrestricted so the reviewer can
     read the repo, while writes stay OS-confined to scratch and /tmp — the
     repo is outside the writable roots, and the role skill can still write
     its /tmp/convergo findings and audit artifacts. Never use
     `--sandbox read-only`: it blocks /tmp writes, so review artifacts
     cannot be written at all;
  3. stay in-turn and wait with repeated bounded foreground wait commands,
     rerun until the file lands:
     `for i in $(seq 1 100); do [ -s <scratch>/last-message.txt ] && { echo
     READY; exit 0; }; sleep 5; done; echo NOT-YET`.
     The wrapper must NOT end its turn to wait for a wake-up: a stopped
     background specialist is not re-invoked when its background command
     exits, and the run becomes an orphan until someone nudges the wrapper.
     Do not hand the run to any separate background task queue;
  4. once READY, relay the `-o` file's content verbatim as its own final
     message, appending one line: `Codex session: <session-id>` (grep
     `session id:` from the run header log).

The `-o` file is the source of truth, not the exit code. Codex can exit
nonzero after a completed run (shutdown or hook noise), so a "command
failed" report with a non-empty `-o` file still means success — relay it.
Never relaunch codex because of the exit code alone; treat the run as
failed only when the process has exited and the `-o` file is still empty,
and then relay the tail of the run header log as a failure callback
instead of retrying. Append `</dev/null` to the codex command so it never
waits on stdin.

If a wrapper does stop early anyway, it is recoverable: `SendMessage` it to
relay now — the resumed wrapper reads the `-o` file and finishes.
- The wrapper agent id from the `Agent` tool result is the specialist id.
  Record the codex session id beside it for continuation.
- Continue the specialist with `SendMessage` to the same wrapper; the wrapper
  resumes the recorded codex session and relays the result verbatim again.
  `codex exec resume` does not accept `--sandbox`; re-pin the sandbox as a
  config override on every resume, for example
  `codex exec resume <session-id> --skip-git-repo-check
  -c sandbox_mode="workspace-write" "<follow-up>"` (the session keeps its
  scratch working directory, so the repo stays unwritable). A resume without the override re-resolves the
  sandbox from the user's codex config and can silently escalate the
  reviewer to full access.
- The wrapper must not read the repo, run other commands, review, summarize,
  or filter codex output. Relay fidelity is its whole job.
