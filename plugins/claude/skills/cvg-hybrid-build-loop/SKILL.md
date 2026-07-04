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
2. **Fresh code review (Phase 2):** codex-backed specialist, sandbox
   `read-only`, role skill `cvg-code-review`. Codex sessions run through
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

- Spawn a background agent on a cheap model (`model: "sonnet"`). Its prompt
  instructs it to:
  1. compose one self-contained codex prompt from the specialist prompt it
     received — role skill to load, artifact paths, refs, boundaries, and the
     exact callback template; nothing else;
  2. run it once via Bash with the sandbox this role requires
     (`codex exec --sandbox workspace-write "<prompt>"` for the worker,
     `codex exec --sandbox read-only "<prompt>"` for reviewers), capturing
     the codex session id the CLI reports (use `--json` if the plain output
     does not show it);
  3. return the codex session's final message verbatim as its own final
     message, appending one line: `Codex session: <session-id>`.
- The wrapper agent id from the `Agent` tool result is the specialist id.
  Record the codex session id beside it for continuation.
- Continue the specialist with `SendMessage` to the same wrapper; the wrapper
  resumes the recorded codex session **with the same sandbox flag this role
  used initially** (for example `codex exec resume <session-id>
  --sandbox workspace-write "<follow-up>"` for the worker) and relays the
  result verbatim again. Sandbox is per invocation; a resume without the
  flag falls back to read-only and a worker repair round cannot write.
- The wrapper must not read the repo, run other commands, review, summarize,
  or filter codex output. Relay fidelity is its whole job.

## Why the Exit Is Tiered

No one can know in advance which fresh review will be the last one, so the
scarce design model cannot simply "take the final round". Instead the exit
condition itself is two-level: an execution-tier clean review is necessary
but never sufficient, and only a clean design-tier `final-fresh-exit` review
ends the loop. The design model therefore runs exactly when the cheap engine
believes the work is done — typically once or twice per loop.
