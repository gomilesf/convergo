---
name: cvg-build-loop
description: Orchestrate a monitored implementation loop where a worker implements the plan and fresh code reviewers gate the exit. Use when the user asks to run a supervised implementation or build loop on Codex threads or Claude Code background agents.
argument-hint: "[plan path, base commit, or implementation goal]"
---

# Build Loop

Use this skill for implementation work that should be executed by a monitored specialist worker and reviewed by monitored specialist reviewers.

Before doing anything, open and read `references/cvg-multi-session-protocol.md`, then apply the protocol gates from `cvg-multi-session`:

- transport binding gate,
- real specialist session gate,
- orchestrator callback transport gate,
- waiting handoff gate,
- cvg-code-review-feedback gate,
- fresh-reviewer exit gate.

## Phase 0: Orchestrator Setup

Record:

- current orchestrator session id (Codex thread id; on Claude Code the harness tracks it),
- implementation base commit with `git rev-parse HEAD`,
- worktree status,
- task-owned and unrelated dirty files,
- source artifact or implementation goal,
- allowed external side effects, if any,
- the loop ledger path, created per the Gate 5 loop-ledger rule.

Pass unrelated dirty state to the worker and tell it not to overwrite those files.

If the plan's slices or invariant matrix span multiple repos, declare the
repo split and build order to the user before spawning the worker, and scope
this loop to one repo's slices: the loop's base/head and diff bookkeeping
covers one repo, so changes outside it escape review entirely. Instruct the
worker not to modify other repos. Run one loop per repo, and carry every
repo this loop does not cover into the completion summary as a blocking
known gap — a single-repo exit is never plan completion.

## Phase 1: Worker Handoff

Spawn the worker as a real specialist session (Gate 0 spawn operation) and
record the id returned by the tool. Verify it per Gate 1; if it is not
verifiable, do not continue.

Worker prompt must include:

- role: implementation worker,
- callback destination per Gate 2,
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

(Codex) After verifying the worker thread with `read_thread`, send the worker
its verified thread id before creating the heartbeat.

Worker completion callback template:

```text
I am the worker. My specialist id is <worker-id>. This implementation round is complete. Base commit: <base>. Head commit: <head>. Key changes: <brief>. Verification: <commands/results>. Known gaps: <none or list>. Please arrange a fresh code reviewer.
```

Worker blocker callback template:

```text
I am the worker. My specialist id is <worker-id>. I found a blocking contract gap. Gap: <id/summary>. Evidence: <files/tests>. Recommendation: <repair/escalation>. Please decide the next step.
```

Complete the waiting handoff per Gate 3 and end the active turn.

## Phase 2: Fresh Code Review

After the worker callback is visible, spawn a fresh reviewer specialist session. Verify it per Gate 1.

Reviewer prompt must include:

- role: fresh code reviewer,
- the line `Do not consult project memory, prior sessions, rollout summaries, or external history. The repository's own git history (log, blame, commit messages) is repo evidence, not external history.` before the required skill line,
- callback destination per Gate 2,
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
I am the fresh code reviewer. My specialist id is <reviewer-id>. This first-pass full code review is complete. Verdict: <ready to merge / ready with fixes / not ready>. Findings: <none or numbered blocker list>. Non-blocking P2 notes: <none or brief list>. Please decide the next step.
```

(Codex) After verifying the reviewer thread with `read_thread`, send the
reviewer its verified thread id before creating the heartbeat.

Complete the waiting handoff per Gate 3 and end the active turn while waiting.

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

After the reviewer callback is visible, send the reviewer feedback to the same verified worker session with the continue operation (Gate 0).

Do not classify findings, choose repair strategy, filter reviewer output, or turn the review into a patch list in the orchestrator.

Feedback prompt must include:

- callback destination per Gate 2,
- reviewer specialist id,
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
I am the worker. My specialist id is <worker-id>. Code review feedback handling is complete. Base commit: <base>. Previous review head: <old>. New head commit: <new>. Code-review-feedback result: <repaired / plan gap / contract gap / systemic design gap / escalation / clarification needed>. Fixed findings: <brief or none>. Verification: <commands/results>. Known gaps: <none or list>. Please arrange the next review step.
```

Complete the waiting handoff per Gate 3 and end the active turn.

If the worker reports a plan or contract gap, escalation, or clarification need, route that callback to the appropriate planner, reviewer, or user decision before requesting re-review.

## Phase 4: Same Reviewer Focused Re-Review

After the worker feedback callback is visible and a reviewable implementation repair exists, send focused re-review to the same verified reviewer session with the continue operation.

If the worker reported a plan gap, contract gap, systemic design gap, escalation, or clarification need, do not request code re-review yet. Route that blocker to the planner, reviewer, or user decision path first, then return to the worker only after the plan or contract is resolved.

Focused scope:

- verify old blockers are fixed,
- inspect new repair diff,
- check whether new code introduced P0/P1 issues,
- if a contract or plan update changed a matrix, re-check only related matrix rows.

Focused re-review prompt must include:

- `Review mode: focused-re-review`,
- `Do not consult project memory, prior sessions, rollout summaries, or external history. The repository's own git history (log, blame, commit messages) is repo evidence, not external history.`

Focused re-review does not require auxiliary reviewers. Do not ask the focused
reviewer to dispatch auxiliary reviewers or synthesize inline auxiliary
coverage.

Complete the waiting handoff per Gate 3 and end the active turn.

## Phase 5: New Fresh Review

After same reviewer passes, spawn a new fresh code reviewer specialist session for a complete first review. Verify it per Gate 1.

Use the same minimal reviewer prompt shape from Phase 2. The new fresh reviewer
prompt must include `Review mode: final-fresh-exit`. It must deliver its
callback to the orchestrator per Gate 2; do not accept a result left only
inside the specialist session when the platform requires an explicit callback
send. Do not include previous reviewer verdicts, blocker text, focused re-review results, or worker repair summaries; include only independent risk-area labels if needed.

Final implementation exit condition:

- new fresh reviewer,
- complete first code review,
- no blocking findings of any class, including code bugs, contract gaps, unsafe side-effect paths, missing real surfaces, missing lifecycle coverage, or missing required gates.
- audit artifact shows every selected auxiliary reviewer dispatched with a
  non-null `agent_id`; inline auxiliary coverage cannot satisfy the final implementation exit condition.

A "ready with fixes" verdict (only non-blocking P2 findings remain) satisfies
the exit condition; carry the P2 list into the completion summary.

If the new fresh reviewer finds blockers, repeat from Phase 3. Each Phase 3-5
cycle is one round; after 3 rounds without a clean exit, stop and escalate to
the user with all open findings and their adjudications (Gate 5 round cap).
Apply the Gate 5 adjudication ratchet: findings previously adjudicated invalid
or out of scope cannot re-block without new evidence.

## Phase 6: QA and External Verification

If the plan requires integration, staging, deployment, end-to-end, or smoke checks, run them through a QA or ops worker after code review is clean, unless the plan explicitly orders them earlier.

QA worker prompt must include:

- callback destination per Gate 2,
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
- worker and reviewer specialist ids verified per Gate 1,
- callback transport status,
- review findings and worker `cvg-code-review-feedback` results,
- repair commits,
- final fresh reviewer result,
- QA evidence and gates,
- known gaps,
- whether external side effects were performed and restored.
