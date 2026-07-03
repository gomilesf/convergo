---
name: cvg-plan-review-feedback
description: "Handle plan-review blocker findings returned to the planner session. Validate feedback, revise plan-owned artifacts, or stop for missing decisions."
---

# Plan Review Feedback

Use this skill in the planner session after a plan reviewer returns blocker
findings.

The input is the reviewer blocker findings appended to the prompt, plus the
original planning goal, source prompt, current plan, behavior contract if present,
and relevant codebase evidence.

Do not treat reviewer findings as an edit list. First decide whether each finding
is valid under the accepted goal and current code reality, then revise only
plan-owned artifacts.

If the task context provides no coordination channel (standalone use), the
coordination channel is the user: stop and ask directly.

## Process

### 1. Reload planning authority

Read:

- original user goal, issue, acceptance criteria, and non-goals,
- current plan document,
- behavior contract or linked design notes, if present,
- relevant codebase evidence for each reviewer finding,
- exact reviewer blocker findings.

### 2. Evaluate each blocker

For each finding, decide whether it is:

- **Valid plan gap**: the plan misses a required surface, lifecycle, invariant,
  matrix cell, ownership boundary, or verification gate.
- **Source-backed contract gap**: the source authority defines the behavior, but
  the plan or contract failed to capture it.
- **Decision-required contract gap**: neither the plan nor source authority
  defines the behavior clearly enough to proceed.
- **Reviewer clarification needed**: the finding cannot be mapped to concrete
  plan or code evidence after re-reading the relevant context.
- **Invalid or out of scope**: the finding is stale, already covered, contradicts
  the accepted goal, or asks for work outside the agreed scope.

### 3. Revise only planner-owned artifacts

For valid plan gaps and source-backed contract gaps:

- update the plan, contract, surfaces, invariant matrix, slices, or verification
  gates as needed,
- keep the revision scoped to the accepted goal,
- preserve reviewer finding ids or exact wording so re-review can check them.

For decision-required contract gaps:

- stop and callback through the coordination channel,
- state the missing decision and the blocked plan section,
- do not invent behavior.

For reviewer clarification:

- callback with the exact ambiguity and evidence checked.

For invalid or out-of-scope findings:

- keep the plan unchanged for that finding,
- explain why it does not apply.

## Output

Before editing, write a compact intake summary:

```text
Plan review feedback intake:
1. Finding: <reviewer finding id or short quote>
   Decision: <valid plan gap / source-backed contract gap / decision-required contract gap / clarification needed / invalid or out of scope>
   Action: <plan edit / contract edit / stop for decision / ask reviewer / no change>
   Evidence: <plan/code reference>
```

After acting, report:

- findings addressed,
- plan or contract sections changed,
- findings rejected or needing clarification,
- decisions still blocking the planner,
- verification gates added or changed.

## Rules

- Do not edit implementation code.
- Do not hide implementation bugs by reducing plan scope.
- Do not invent behavior for contract gaps.
- Do not silently drop invalid or out-of-scope findings.
