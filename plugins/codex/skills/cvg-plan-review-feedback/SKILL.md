---
name: cvg-plan-review-feedback
description: "Handle plan-review blocker findings returned to the planner session. Validate feedback, revise plan-owned artifacts, or pause dependent work on missing decisions."
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
current conversation is the channel. Ask only for a material unresolved decision;
continue independent authorized work.

## Process

### 1. Reload planning authority

Read:

- original user goal, issue, acceptance criteria, and non-goals,
- current plan document,
- behavior contract or linked design notes, if present,
- relevant codebase evidence for each reviewer finding,
- exact reviewer blocker findings.

### 2. Evaluate each blocker

Recheck the original outcome, non-goals, authorized changes and current product
constraints before treating plan text as a requirement. A contract gap blocks
only when it prevents required behavior or critical verification. Use the
orchestrator's evidence-based adjudications as input, retaining the original
finding and explaining any disagreement or new evidence.

For materially added mechanisms, ask what required outcome or concrete
constraint fails if they are removed. Consider deleting the cause or reusing
existing behavior before prescribing more coordination, recovery, or guards.
A counterfactual explanation is not an executed ablation experiment. Run an
isolated removal experiment only when uncertainty could change the choice and
it is within your role; preserve the baseline and verify affected behavior.
Keep necessary privacy, integrity and failure protection even for rare schedules.
Use existing finding fields to explain the consequence and smallest effective
change; do not add a separate complexity report or demand a deletion quota.

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

- pause dependent work and callback through the coordination channel,
- state the missing material decision and its affected plan section; resolve
  source-backed details without repeating user approval,
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
