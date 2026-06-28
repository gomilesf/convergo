# Multi-Session Protocol Reference

This file is a skill-local copy of the `cvg-multi-session` protocol needed by `cvg-plan-loop`. It keeps the loop skill self-contained when installed from a marketplace cache.

Use this protocol when the current Codex thread should act as an **orchestrator** over other real Codex threads. This is a protocol, not just a checklist.

The workflow is repo-independent. Specialist prompts should carry only the
coordination data the specialist cannot infer from the selected role skill and
source artifact. Do not paste broad repo rules, likely-file lists, old phase
state, or role-skill procedures unless they are task-specific authority.

## Non-Negotiable Protocol Gates

Apply these gates before any planner, worker, reviewer, QA runner, or quality reviewer is launched.

### Gate 1: Real Codex Thread

Specialists must run in monitorable Codex threads.

- Use `create_thread` to create a new specialist thread unless the user explicitly named an existing Codex thread.
- Use `send_message_to_thread` to continue an existing specialist thread.
- Use `read_thread` to verify every specialist thread id immediately after creation or selection.
- For a newly created specialist, send a short identity note after `read_thread`
  succeeds: `Your verified Codex thread id is <specialist-thread-id>. Use this
  exact id in callbacks.`
- Do not use multi-agent subagents, task agents, context-fork agents, local shell jobs, or background processes as substitutes.
- Do not treat a subagent id, job id, process id, local session id, or model-generated id as a Codex thread id.
- If `read_thread` cannot read the id, stop the workflow and retry with Codex thread tools or report a tool-layer blocker.
- If Codex thread tools are not loaded, search for `create_thread`, `send_message_to_thread`, and `read_thread` first. If they still cannot be loaded, report a tool-layer blocker.

The authoritative specialist identity is the id returned by `create_thread` or
the source thread on a callback message, not whatever the specialist writes in
prose. Do not accept placeholder specialist identity in callback templates.

### Gate 2: Orchestrator Callback Transport

Every specialist prompt must include:

- destination orchestrator Codex thread id,
- exact callback template,
- instruction to send the callback with `send_message_to_thread`,
- instruction to include `Audit artifact: <absolute path>` when the specialist
  creates or receives an audit artifact,
- fallback instruction if callback transport is unavailable.

The specialist must send its callback to the orchestrator thread. A final answer left only in the specialist thread is not sufficient.

If the specialist creates or receives an audit artifact, the callback must include `Audit artifact: <absolute path>`.

The specialist must use the verified thread id supplied by the orchestrator in
its callback body.

If `send_message_to_thread` is unavailable inside the specialist thread, the specialist must say `callback transport failed` in its final answer and include the exact callback text for manual relay.

The orchestrator treats the phase as pending until the callback is visible in the orchestrator thread or has been manually relayed by the user.

### Gate 3: Heartbeat Handoff

Waiting is handled by heartbeat automation, not by manual polling.

Handoff sequence:

1. Send the specialist work with `create_thread` or `send_message_to_thread`.
2. Verify the specialist thread once with `read_thread`.
3. For newly created threads, send the verified specialist thread id to that
   thread.
4. Create or update a heartbeat automation for the current orchestrator thread.
5. Tell the user the specialist thread id and heartbeat id.
6. End the active turn.

If heartbeat automation tools are not loaded, search for `automation_update` first. If no heartbeat tool is available, tell the user the fallback is unavailable and end the turn after one verified handoff; do not replace the missing heartbeat with manual polling.

Do not emulate a heartbeat with `sleep`, repeated `read_thread`, shell loops, timers, or repeated status checks in the same assistant turn.

A heartbeat turn may do one status check. If the specialist is still active, report one short status and stop. Do not sleep and check again.

Continue immediately only when an explicit callback is already present or `read_thread` already shows the specialist completed.

### Gate 4: Role-Specific Review Feedback

Reviewer feedback returns to the same planner or worker thread that produced the reviewed artifact.

The orchestrator must not classify findings, choose the repair route, filter reviewer output, or turn the review into a patch list.

Plan-review blockers return to the planner with the `cvg-plan-review-feedback` skill. The prompt must contain the exact reviewer blocker findings under a `Plan Review Feedback Input` section.

Code-review blockers return to the worker with the `cvg-code-review-feedback` skill. The prompt must contain the exact reviewer blocker findings under a `Code Review Feedback Input` section.

Role boundaries still apply: workers may repair implementation-owned findings only. Workers must stop and callback for plan gaps, contract gaps, systemic design gaps, reviewer clarification, or escalation. Only planners may produce plan or contract revisions.

The orchestrator continues only after the actor callback reports a role-valid result: implementation repair from a worker, plan or contract revision from a planner, or a blocker that needs planner, reviewer, user, or escalation handling.

### Gate 5: Fresh Reviewer Exit

Same-reviewer pass is never the final exit condition.

The exit sequence is:

1. Fresh reviewer performs a complete first review.
2. If blockers exist, return feedback to the same planner or worker and require the role-specific feedback skill.
3. Same reviewer performs a focused re-review after the actor produces a reviewable update.
4. If same reviewer passes, start a new fresh reviewer for another complete first review.
5. Exit only when the new fresh reviewer reports no blocking findings.

For code-review final exits, the final fresh reviewer prompt must include
`Review mode: final-fresh-exit`. Its audit artifact must show every selected
auxiliary reviewer dispatched with a non-null `agent_id` or `thread_id`;
inline auxiliary coverage cannot satisfy the final fresh-reviewer exit condition.

## Specialist Prompt Checklist

Every specialist prompt must include:

- role and scope,
- destination orchestrator Codex thread id,
- worktree or repo path,
- base/head refs when relevant,
- dirty-state warning and unrelated files when present,
- one source artifact or exact user input: plan path, requirements path, review
  callback, or implementation goal,
- required role skill,
- task-specific external side-effect boundary, especially whether push, deploy,
  remote smoke checks, secrets, or external environment/data changes are allowed,
- audit artifact callback line when the specialist creates or receives one,
- exact callback transport block,
- exact callback template.

Do not include:

- execution rules already owned by the required role skill,
- duplicated authority lists when the plan or source artifact links them,
- likely files or exhaustive surface checklists copied from the orchestrator,
- old heartbeat payloads or previous phase instructions,
- reviewer concerns unless this is a role-specific feedback prompt.

Callback transport block:

```text
Destination orchestrator Codex thread id: <orchestrator-thread-id>

When complete or blocked, send the callback to that thread with send_message_to_thread.
If you create or receive an audit artifact, include this line in the callback:
Audit artifact: <absolute path>
If send_message_to_thread is unavailable, write "callback transport failed" and include the exact callback text in your final answer.
```

## Heartbeat Prompt Checklist

Heartbeat prompts should say:

- which specialist thread to check,
- what callback shape to detect,
- whether the actor completed the role-specific feedback intake,
- if still active, report one short status and continue waiting,
- do not busy-wait,
- delete or update the heartbeat when the phase is complete or stale.

When updating a heartbeat for a new phase, replace the old instructions. Do not
wrap or nest previous heartbeat payloads inside the new heartbeat prompt.

## Completion Summary

When the workflow completes, summarize:

- base and final refs or final plan path,
- specialist thread ids verified with `read_thread`,
- callback transport status,
- audit artifact paths received from specialists,
- review loop results,
- role-specific feedback results,
- verification gates,
- remaining known gaps,
- heartbeat cleanup,
- whether the fresh-reviewer exit condition was met.
