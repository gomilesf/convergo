---
name: cvg-plan-loop
description: Orchestrate a monitored Codex planning loop with a planner, fresh plan reviewers, focused re-review, callback transport, heartbeat waiting, and strict fresh-reviewer exit gates. Use when the user asks to create or revise a plan through Codex sessions.
argument-hint: "[planning goal, requirements path, behavior contract path, or planning prompt]"
---

# Codex Plan Loop

Use this skill for plan-only cvg-multi-session orchestration.

Before doing anything, open and read `references/cvg-multi-session-protocol.md`, then apply the protocol gates from `cvg-multi-session`:

- real Codex thread gate,
- orchestrator callback transport gate,
- heartbeat handoff gate,
- cvg-plan-review-feedback gate,
- fresh-reviewer exit gate.

Do not implement product code in this workflow.

## Phase 0: Orchestrator Setup

Record:

- current orchestrator thread id,
- worktree or repo path,
- current `git rev-parse HEAD` if available,
- dirty worktree state,
- source prompt or input document,
- expected plan path or target docs directory when known.

Classify dirty files:

- plan-owned files,
- unrelated user artifacts,
- files the planner must not touch.

## Phase 1: Planner Handoff

Create the planner as a real Codex thread with `create_thread`.

Immediately verify the returned planner thread id with `read_thread`. If it is
not readable, do not continue. After verification, send the planner its verified
thread id before creating the heartbeat.

Planner prompt must include:

- role: planner,
- destination orchestrator Codex thread id,
- required planning skill, such as `cvg-plan` or another user-specified plan skill,
- source prompt, requirements path, or exact user goal,
- repo path and starting state,
- dirty-state warning when present,
- plan-only boundary,
- output path rules,
- task-specific external side-effect boundary,
- callback transport block,
- callback template.

Do not restate the planning skill's process or paste broad repo rules, likely
files, or local policy summaries unless they are the user's source authority.

Planner callback template:

```text
I am the planner. My session/thread id is <planner-thread-id>. Orchestrator thread id: <orchestrator-id>. This planning round is complete. Plan path: <absolute path>. Key status: <brief>. Please decide the next step.
```

After verifying the planner thread, create or update a heartbeat and end the active turn. Do not use `sleep` or repeated `read_thread` to wait.

## Phase 2: Fresh Plan Review

After planner callback is visible in the orchestrator thread, create a new fresh reviewer Codex thread.

Immediately verify the reviewer thread id with `read_thread`.

Reviewer prompt must include:

- role: fresh plan reviewer,
- the line `Do not consult project memory, prior sessions, rollout summaries, or external history.` before the required skill line,
- destination orchestrator Codex thread id,
- required cvg-plan-review skill, such as `cvg-plan-review`,
- original planning goal or source prompt,
- plan path,
- repo path,
- read-only boundary,
- blocker-only reporting rule,
- task-specific external side-effect boundary,
- callback transport block,
- callback template.

Do not paste the full planning prompt or all context documents when the plan
links its authorities and the reviewer can read the worktree.

Reviewer callback template:

```text
I am the fresh reviewer. My session/thread id is <reviewer-thread-id>. Orchestrator thread id: <orchestrator-id>. This first-pass full review is complete. Verdict: <passed / blocking findings>. Findings: <none or numbered concise list>. Please decide the next step.
```

After verifying the reviewer thread with `read_thread`, send the reviewer its
verified thread id before creating the heartbeat.

Create or update a heartbeat and end the active turn while waiting. Do not manually poll.

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

If the reviewer reports blockers, send the reviewer feedback to the same verified planner thread with `send_message_to_thread`.

Do not classify findings, choose revision strategy, filter reviewer output, or turn the review into an edit list in the orchestrator.

The feedback prompt must include:

- destination orchestrator Codex thread id,
- reviewer thread id,
- required feedback skill: `cvg-plan-review-feedback`,
- original planning goal and source prompt,
- current plan path and related contracts,
- exact reviewer blocker findings appended under a `Plan Review Feedback Input` section,
- task-specific external side-effect boundary,
- callback transport block,
- callback template.

Do not restate the feedback skill's intake, classification, or revision rules.

Create or update a heartbeat and end the active turn.

## Phase 4: Focused Re-Review

After planner feedback callback is visible in the orchestrator thread and a reviewable plan revision exists, send a focused re-review request to the same verified reviewer thread with `send_message_to_thread`.

Focused scope:

- verify old blockers were addressed,
- check directly related contradictions introduced by the revision,
- do not redo broad review unless the plan's core design changed.

Create or update a heartbeat and end the active turn.

If the planner reports a contract decision, escalation, or clarification need, route that callback to the appropriate reviewer or user decision before requesting re-review.

If same reviewer still finds blockers, repeat Phase 3.

If same reviewer passes, do not exit. Continue to Phase 5.

## Phase 5: Final Fresh Review

Create a new fresh reviewer Codex thread for a complete first review of the revised plan. Verify it with `read_thread`.

Use the same minimal reviewer prompt shape from Phase 2. The new fresh reviewer
must send its callback to the orchestrator with `send_message_to_thread`; do
not ask it to leave the callback only in its own thread.

Final exit condition:

- new fresh reviewer,
- complete first review,
- no blocking findings.

Only then can the orchestrator declare the plan loop complete.

## Completion Summary

Report:

- plan path,
- planner thread id,
- reviewer thread ids,
- callback transport status,
- blockers and planner `cvg-plan-review-feedback` results,
- final fresh reviewer verdict,
- heartbeat cleanup,
- known gaps.
