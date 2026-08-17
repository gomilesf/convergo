---
name: cvg-plan-loop
description: Orchestrate a monitored planning loop where a planner drafts the plan and fresh plan reviewers gate the exit. Use when the user asks to create or revise a plan through supervised specialist sessions on Codex threads or Claude Code background agents.
argument-hint: "[planning goal, requirements path, behavior contract path, or planning prompt]"
---

# Plan Loop

Use this skill for plan-only cvg-multi-session orchestration.

Before doing anything, open and read `references/cvg-multi-session-protocol.md`, then apply the protocol gates from `cvg-multi-session`:

- transport binding gate,
- real specialist session gate,
- orchestrator callback transport gate,
- waiting handoff gate,
- cvg-plan-review-feedback gate,
- fresh-reviewer exit gate.

Do not implement product code in this workflow.

## Phase 0: Orchestrator Setup

Record:

- current orchestrator session id (Codex thread id; on Claude Code the harness tracks it),
- worktree or repo path,
- current `git rev-parse HEAD` if available,
- dirty worktree state,
- source prompt or input document,
- expected plan path or target docs directory when known,
- the loop ledger path, created per the Gate 5 loop-ledger rule.

Classify dirty files:

- plan-owned files,
- unrelated user artifacts,
- files the planner must not touch.

## Phase 1: Planner Handoff

Spawn the planner as a real specialist session (Gate 0 spawn operation) and
record the id returned by the tool. Verify it per Gate 1; if it is not
verifiable, do not continue.

(Codex) Include the protocol's `<specialist-thread-id>` identity line in the
planner prompt. The App Server transport replaces it before turn start. After
`thread_handoff_ready`, verify with `read_thread` that the ids match.

Planner prompt must include:

- role: planner,
- callback destination per Gate 2,
- required planning skill, such as `cvg-plan` or another user-specified plan skill,
- source prompt, requirements path, or exact user goal,
- repo path and starting state,
- dirty-state warning when present,
- plan-only boundary,
- output path rules,
- task-specific external side-effect boundary,
- operation-appropriate callback transport block,
- callback template.

Do not restate the planning skill's process or paste broad repo rules, likely
files, or local policy summaries unless they are the user's source authority.

Planner callback template:

```text
I am the planner. My specialist id is <planner-id>. This planning round is complete. Plan path: <absolute path>. Key status: <brief>. Please decide the next step.
```

Complete the waiting handoff per Gate 3 and end the active turn.

## Phase 2: Fresh Plan Review

After the planner callback is visible, spawn a new fresh reviewer specialist
session and verify its id per Gate 1.

Reviewer prompt must include:

- role: fresh plan reviewer,
- the line `Do not consult project memory, prior sessions, rollout summaries, or external history. The repository's own git history (log, blame, commit messages) is repo evidence, not external history.` before the required skill line,
- callback destination per Gate 2,
- required cvg-plan-review skill, such as `cvg-plan-review`,
- original planning goal or source prompt,
- plan path,
- repo path,
- read-only boundary,
- blocker-only reporting rule,
- task-specific external side-effect boundary,
- operation-appropriate callback transport block,
- callback template.

Do not paste the full planning prompt or all context documents when the plan
links its authorities and the reviewer can read the worktree.

Reviewer callback template:

```text
I am the fresh reviewer. My specialist id is <reviewer-id>. This first-pass full review is complete. Verdict: <clean / blocking findings>. Findings: <none or numbered concise list>. Please decide the next step.
```

Complete the waiting handoff per Gate 3 and end the active turn while waiting.

Blocking plan findings include:

- missing required surface,
- incomplete behavior contract coverage,
- wrong ownership boundary,
- unclear external or API contract,
- missing migration, rollback, deletion, privacy, or safety lifecycle,
- insufficient test or verification gate,
- plan criterion that cannot be implemented as written,
- unsafe side-effect assumption.

## Phase 3: Return Review Feedback to Planner

If the reviewer reports blockers, send the reviewer feedback to the same verified planner session with the continue operation (Gate 0).

Do not classify findings, choose revision strategy, filter reviewer output, or turn the review into an edit list in the orchestrator.

The feedback prompt must include:

- callback destination per Gate 2,
- reviewer specialist id,
- required feedback skill: `cvg-plan-review-feedback`,
- original planning goal and source prompt,
- current plan path and related contracts,
- exact reviewer blocker findings appended under a `Plan Review Feedback Input` section,
- task-specific external side-effect boundary,
- operation-appropriate callback transport block,
- callback template.

Do not restate the feedback skill's intake, classification, or revision rules.

Complete the waiting handoff per Gate 3 and end the active turn.

## Phase 4: Focused Re-Review

After the planner feedback callback is visible and a reviewable plan revision exists, send a focused re-review request to the same verified reviewer session with the continue operation.

Focused scope:

- verify old blockers were addressed,
- check directly related contradictions introduced by the revision,
- do not redo broad review unless the plan's core design changed.

The focused re-review prompt must include the operation-appropriate callback
transport block and exact callback template.

Complete the waiting handoff per Gate 3 and end the active turn.

If the planner reports a contract decision, escalation, or clarification need, route that callback to the appropriate reviewer or user decision before requesting re-review.

If same reviewer still finds blockers, repeat Phase 3.

If same reviewer passes, do not exit. Continue to Phase 5.

## Phase 5: Final Fresh Review

Spawn a new fresh reviewer specialist session for a complete first review of the revised plan. Verify its id per Gate 1.

Use the same minimal reviewer prompt shape from Phase 2. The new fresh reviewer
must deliver its callback to the orchestrator per Gate 2; do not accept a
result left only inside the specialist session when the platform requires an
explicit callback send.

Final exit condition:

- new fresh reviewer,
- complete first review,
- no blocking findings.

Only then can the orchestrator declare the plan loop complete.

If the final fresh reviewer finds blockers, repeat from Phase 3. Each
Phase 3-5 cycle is one round; after 3 rounds without a clean final review,
stop and escalate to the user with all open findings and their adjudications
(Gate 5 round cap). Apply the Gate 5 adjudication ratchet: findings previously
adjudicated invalid or out of scope cannot re-block without new evidence.

## Completion Summary

Report:

- plan path,
- planner specialist id,
- reviewer specialist ids,
- callback transport status,
- blockers and planner `cvg-plan-review-feedback` results,
- final fresh reviewer verdict,
- heartbeat cleanup (Codex),
- known gaps.
