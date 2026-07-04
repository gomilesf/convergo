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

If either prerequisite fails, stop and report it. Do not silently fall back
to a single-engine loop; the user chose this skill for the split.

## Engine Bindings

Defaults; the user's invocation may override either tier.

| Tier | Default | Runs |
| --- | --- | --- |
| Execution tier | `codex exec` with the user's configured model (recommended: a frontier codex model at high reasoning effort) | worker, first-pass fresh reviews, QA workers |
| Design tier | Claude `fable` via the `Agent` tool `model` parameter | final-fresh-exit reviews |

Focused re-reviews always return to the reviewer session that raised the
findings, on whichever tier that session lives — unchanged protocol.

## Procedure

Apply the `cvg-build-loop` skill in full — same phases, protocol gates,
callback templates, and round cap — with these routing overrides:

1. **Worker (Phase 1):** codex-backed specialist (pattern below), sandbox
   `workspace-write`, role skill `cvg-work`.
2. **Fresh code review (Phase 2):** codex-backed specialist with the
   reviewer sandbox (see pattern), role skill `cvg-code-review`. Codex
   sessions run through
   `codex exec`, which has no generic subagent primitive, so expect
   auxiliary persona coverage to run inline (the role skill's documented
   fallback). Inline coverage is valid for first-pass reviews; it can never
   satisfy the final-fresh-exit condition, which is one more reason the
   final gate below is a native design-tier specialist.
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
     foreground Bash timeout) with the sandbox this role requires, the
     final message written to a file, and the run header captured:
     `codex exec --sandbox workspace-write -o <scratch>/last-message.txt
     "<prompt>" > <scratch>/run-header.log 2>&1` for the worker, launched
     from the worktree. Reviewers also use `--sandbox workspace-write` but
     launched from a scratch working directory (`-C <scratch>`): reads are
     unrestricted so the reviewer can read the repo, while writes stay
     OS-confined to scratch and /tmp — the repo is outside the writable
     roots, and the role skill can still write its /tmp/convergo findings
     and audit artifacts. Never use `--sandbox read-only` for reviewers: it
     blocks /tmp writes, so review artifacts cannot be written at all;
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

If a wrapper does stop early anyway, it is recoverable: `SendMessage` it to
relay now — the resumed wrapper reads the `-o` file and finishes.
- The wrapper agent id from the `Agent` tool result is the specialist id.
  Record the codex session id beside it for continuation.
- Continue the specialist with `SendMessage` to the same wrapper; the wrapper
  resumes the recorded codex session and relays the result verbatim again.
  `codex exec resume` does not accept `--sandbox`; re-pin the role's sandbox
  as a config override on every resume, for example
  `codex exec resume <session-id> -c sandbox_mode="workspace-write"
  "<follow-up>"` for the worker. A resume without the override re-resolves
  the sandbox from the user's codex config, which can silently escalate the
  reviewer to full access or leave the worker unable to write.
- The wrapper must not read the repo, run other commands, review, summarize,
  or filter codex output. Relay fidelity is its whole job.
- `workspace-write` covers the directory codex is launched from. If the task
  legitimately needs writes outside that worktree (for example a second
  repo), the orchestrator must name those extra paths in the specialist
  prompt and the wrapper allows exactly those paths — `--add-dir <path>` on
  the initial run, `-c 'sandbox_workspace_write.writable_roots=[...]'` on
  resumes. Never escalate to `danger-full-access` to get past a write
  denial.

## Why the Exit Is Tiered

No one can know in advance which fresh review will be the last one, so the
scarce design model cannot simply "take the final round". Instead the exit
condition itself is two-level: an execution-tier clean review is necessary
but never sufficient, and only a clean design-tier `final-fresh-exit` review
ends the loop. The design model therefore runs exactly when the cheap engine
believes the work is done — typically once or twice per loop.
