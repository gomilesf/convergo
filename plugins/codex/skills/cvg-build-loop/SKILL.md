---
name: cvg-build-loop
description: Orchestrate a monitored Codex implementation loop with a worker, code reviewers, actor-local review feedback handling, QA gates, callback transport, heartbeat waiting, and strict fresh-reviewer exit conditions.
argument-hint: "[plan path, base commit, or implementation goal]"
---

# Codex Build Loop

Use this skill for implementation work that should be executed by a monitored Codex worker and reviewed by monitored Codex reviewers.

Before doing anything, open and read `references/cvg-multi-session-protocol.md`, then apply the protocol gates from `cvg-multi-session`:

- real Codex thread gate,
- orchestrator callback transport gate,
- heartbeat handoff gate,
- cvg-code-review-feedback gate,
- fresh-reviewer exit gate.

## Phase 0: Orchestrator Setup

Record:

- current orchestrator thread id,
- implementation base commit with `git rev-parse HEAD`,
- worktree status,
- task-owned and unrelated dirty files,
- source artifact or implementation goal,
- allowed external side effects, if any.

Pass unrelated dirty state to the worker and tell it not to overwrite those files.

## Phase 1: Worker Handoff

Create the worker as a real Codex thread with `create_thread`.

Immediately verify the returned worker thread id with `read_thread`. If it is not readable, do not continue.

Worker prompt must include:

- role: implementation worker,
- destination orchestrator Codex thread id,
- required work skill, such as `cvg-work` or another user-specified implementation skill,
- base commit,
- worktree path,
- dirty-state warning when present,
- plan path or implementation goal,
- implementation notes path only when the plan or repo convention requires one,
- task-specific external side-effect boundary,
- callback transport block,
- callback templates.

Do not restate `cvg-work` execution rules in the worker prompt. Do not paste
likely files, broad surface checklists, previous reviewer risk hints, old
commits, or repo policy summaries unless the user supplied them as task
authority and they are not linked from the plan.

After verifying the worker thread with `read_thread`, send the worker its
verified thread id before creating the heartbeat.

Worker completion callback template:

```text
I am the worker. My session/thread id is <worker-thread-id>. Orchestrator thread id: <orchestrator-id>. This implementation round is complete. Base commit: <base>. Head commit: <head>. Key changes: <brief>. Verification: <commands/results>. Known gaps: <none or list>. Please arrange a fresh code reviewer.
```

Worker blocker callback template:

```text
I am the worker. My session/thread id is <worker-thread-id>. Orchestrator thread id: <orchestrator-id>. I found a blocking contract gap. Gap: <id/summary>. Evidence: <files/tests>. Recommendation: <repair/escalation>. Please decide the next step.
```

After verifying the worker thread, create or update a heartbeat and end the active turn. Do not use `sleep` or repeated `read_thread` to wait.

## Phase 2: Fresh Code Review

After worker callback is visible in the orchestrator thread, create a fresh reviewer Codex thread. Verify it with `read_thread`.

Reviewer prompt must include:

- role: fresh code reviewer,
- the line `Do not consult project memory, prior sessions, rollout summaries, or external history.` before the required skill line,
- destination orchestrator Codex thread id,
- required cvg-code-review skill, such as `cvg-code-review`,
- review mode when this reviewer is the final exit gate,
- base commit and head commit,
- plan path and implementation notes path when present,
- `git diff <base>..HEAD`,
- read-only boundary,
- blocker-only reporting rule,
- task-specific external-side-effect boundary,
- callback transport block,
- callback template.

Do not paste changed files in full when the reviewer can read the worktree.
Provide changed file names or a diff stat only when useful for orientation.
Fresh reviewer prompts must not include a `Relevant review history` narrative,
prior reviewer verdicts, prior findings, worker repair summaries, or
same-reviewer pass/fail conclusions. If history matters, compress it into
`Risk areas to inspect independently:` with filenames or behaviors only, after
stating the review must be independent.

Reviewer callback template:

```text
I am the fresh code reviewer. My session/thread id is <reviewer-thread-id>. Orchestrator thread id: <orchestrator-id>. This first-pass full code review is complete. Verdict: <ready / not ready>. Findings: <none or numbered blocker list>. Please decide the next step.
```

After verifying the reviewer thread with `read_thread`, send the reviewer its
verified thread id before creating the heartbeat.

Create or update a heartbeat and end the active turn while waiting. Do not manually poll.

Reviewer should report blocking findings only:

- P0/P1 code bug,
- unmet plan criterion,
- missing real surface,
- contract gap,
- unsafe side-effect path,
- missing required migration, rollback, deletion, privacy, or verification gate,
- test/build/deploy gate missing where the plan requires it.

Non-blocking quality notes belong in a separate quality review unless the orchestrator requested them here.

## Phase 3: Return Review Feedback to Worker

After reviewer callback is visible in the orchestrator thread, send the reviewer feedback to the same verified worker thread with `send_message_to_thread`.

Do not classify findings, choose repair strategy, filter reviewer output, or turn the review into a patch list in the orchestrator.

Feedback prompt must include:

- destination orchestrator Codex thread id,
- reviewer thread id,
- required feedback skill: `cvg-code-review-feedback`,
- plan path, implementation notes path when present, base commit, review head,
  and current head,
- exact reviewer blocker findings appended under a `Code Review Feedback Input` section,
- task-specific external-side-effect boundary,
- callback transport block,
- callback template.

Do not restate the feedback skill's intake, classification, or repair rules.
The exact findings under `Code Review Feedback Input` plus the required skill
are the worker's authority.

Worker feedback callback template:

```text
I am the worker. My session/thread id is <worker-thread-id>. Orchestrator thread id: <orchestrator-id>. Code review feedback handling is complete. Base commit: <base>. Previous review head: <old>. New head commit: <new>. Code-review-feedback result: <repaired / plan gap / contract gap / systemic design gap / escalation / clarification needed>. Fixed findings: <brief or none>. Verification: <commands/results>. Known gaps: <none or list>. Please arrange the next review step.
```

Create or update a heartbeat and end the active turn.

If the worker reports a plan or contract gap, escalation, or clarification need, route that callback to the appropriate planner, reviewer, or user decision before requesting re-review.

## Phase 4: Same Reviewer Focused Re-Review

After worker feedback callback is visible in the orchestrator thread and a reviewable implementation repair exists, send focused re-review to the same verified reviewer thread with `send_message_to_thread`.

If the worker reported a plan gap, contract gap, systemic design gap, escalation, or clarification need, do not request code re-review yet. Route that blocker to the planner, reviewer, or user decision path first, then return to the worker only after the plan or contract is resolved.

Focused scope:

- verify old blockers are fixed,
- inspect new repair diff,
- check whether new code introduced P0/P1 issues,
- if a contract or plan update changed a matrix, re-check only related matrix rows.

Focused re-review prompt must include:

- `Review mode: focused-re-review`,
- `Do not consult project memory, prior sessions, rollout summaries, or external history.`

Focused re-review does not require auxiliary reviewers. Do not ask the focused
reviewer to dispatch auxiliary reviewers or synthesize inline auxiliary
coverage.

Create or update a heartbeat and end the active turn.

Same reviewer pass is not enough to exit.

## Phase 5: New Fresh Review

After same reviewer passes, create a new fresh code reviewer thread for a complete first review. Verify it with `read_thread`.

Use the same minimal reviewer prompt shape from Phase 2. The new fresh reviewer
prompt must include `Review mode: final-fresh-exit`. It must send its callback
to the orchestrator with `send_message_to_thread`; do not ask it to leave the
callback only in its own thread. Do not include previous reviewer verdicts, blocker text, focused re-review results, or worker repair summaries; include only independent risk-area labels if needed.

Final implementation exit condition:

- new fresh reviewer,
- complete first code review,
- no blocking findings of any class, including code bugs, contract gaps, unsafe side-effect paths, missing real surfaces, missing lifecycle coverage, or missing required gates.
- audit artifact shows every selected auxiliary reviewer dispatched with a
  non-null `agent_id` or `thread_id`; inline auxiliary coverage cannot satisfy the final implementation exit condition.

If the new fresh reviewer finds blockers, repeat from Phase 3.

## Phase 6: QA and External Verification

If the plan requires integration, staging, deployment, end-to-end, or smoke checks, run them through a QA or ops worker after code review is clean, unless the plan explicitly orders them earlier.

QA worker prompt must include:

- destination orchestrator Codex thread id,
- exact versions under test,
- allowed external side effects,
- evidence/report path,
- stop-and-callback rule for failures,
- no-secrets rule,
- callback transport block,
- callback template.

Classify QA failures before routing:

- frontend bug,
- backend bug,
- contract gap,
- data/setup issue,
- ops/config issue,
- tooling limitation,
- runbook gap.

Real QA failures can reopen the build loop.

## Phase 7: Quality Review

Optionally run a separate quality reviewer for:

- modularity,
- code smells,
- hacky shortcuts,
- over-coupling,
- maintainability risks,
- test shape and fixture hygiene.

Quality findings are not automatically release blockers. The orchestrator decides whether to run cleanup based on risk and timing.

## Completion Summary

Report:

- base commit and final head,
- worker and reviewer thread ids verified with `read_thread`,
- callback transport status,
- review findings and worker `cvg-code-review-feedback` results,
- repair commits,
- final fresh reviewer result,
- QA evidence and gates,
- known gaps,
- whether external side effects were performed and restored.
