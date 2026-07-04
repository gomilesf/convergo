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
   codex-backed specialists (pattern below) with sandbox `read-only` and role
   skill `cvg-plan-review`.
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

- Spawn a background agent on a cheap model (`model: "sonnet"`). Its prompt
  instructs it to:
  1. compose one self-contained codex prompt from the specialist prompt it
     received — role skill to load, artifact paths, refs, boundaries, and the
     exact callback template; nothing else;
  2. run it once via Bash: `codex exec --sandbox read-only "<prompt>"`,
     capturing the codex session id the CLI reports (use `--json` if the
     plain output does not show it);
  3. return the codex session's final message verbatim as its own final
     message, appending one line: `Codex session: <session-id>`.
- The wrapper agent id from the `Agent` tool result is the specialist id.
  Record the codex session id beside it for continuation.
- Continue the specialist with `SendMessage` to the same wrapper; the wrapper
  resumes the recorded codex session with the same sandbox flag it used
  initially (for example `codex exec resume <session-id> --sandbox read-only
  "<follow-up>"`) and relays the result verbatim again. Sandbox is per
  invocation, not per session.
- The wrapper must not read the repo, run other commands, review, summarize,
  or filter codex output. Relay fidelity is its whole job.
