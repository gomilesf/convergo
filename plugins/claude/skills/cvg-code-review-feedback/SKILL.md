---
name: cvg-code-review-feedback
description: "Handle code-review blocker findings returned to the worker session. Validate feedback, repair implementation-owned issues, or pause dependent work on plan and contract gaps."
---

# Code Review Feedback

Use this skill in the worker session after a code reviewer returns blocker
findings.

The input is the reviewer blocker findings appended to the prompt, plus the
accepted plan, behavior contract if present, implementation notes, base/head
refs, current diff, and relevant changed files.

Do not treat reviewer findings as a patch list. First decide whether each finding
is an implementation-owned issue under the accepted plan and contract. Pause only work dependent on a material unresolved behavior or scope decision.

If the task context provides no coordination channel (standalone use), the
current conversation is the channel. Ask only for a material unresolved decision;
continue independent authorized work.

## Process

### 1. Reload implementation authority

Read:

- original user outcome, non-goals and authorized changes,
- accepted plan and "done when" criteria,
- behavior contract or linked design notes, if present,
- implementation notes,
- current diff and changed files,
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

- **Local code bug**: accepted behavior is clear, and implementation is wrong in
  a bounded place.
- **Pattern bug**: the same implementation mistake may appear across adjacent
  surfaces covered by the accepted plan.
- **Verification gap**: implementation may be correct, but required proof from
  the accepted plan is missing.
- **Plan gap**: the reviewer exposed a missing surface, invariant, slice, matrix
  cell, or gate that the plan does not define.
- **Contract gap**: expected behavior is not defined well enough to patch safely.
- **Systemic design gap**: the architecture, ownership, state model, or protocol
  assumptions are insufficient for a worker patch.
- **Reviewer clarification needed**: the finding cannot be mapped to concrete
  evidence after re-reading the relevant context.
- **Invalid or out of scope**: the finding is stale, already fixed, contradicts
  the accepted plan, or is outside the implementation scope.

### 3. Repair only worker-owned issues

For local code bugs, pattern bugs, and implementation-owned verification gaps:

- add or update the required regression test or verification gate first,
- repair the implementation,
- for pattern bugs, audit adjacent planned surfaces and report what was checked,
- update implementation notes when the feedback reveals a deviation, assumption,
  or audited pattern the reviewer needs to know — written as standing decisions
  without review provenance (no round numbers, finding IDs, or fix-status
  claims): the next fresh reviewer must inherit the decision record, not this
  round's search map.

For plan gaps, contract gaps, and systemic design gaps:

- pause dependent work and callback through the coordination channel,
- state the missing plan or contract decision,
- do not edit plans, contracts, surface matrices, acceptance criteria, or scope,
- let the planner or orchestrator resolve source-backed technical omissions;
  ask the user for changed product semantics, broader authorization or new risk
  acceptance. Continue independent work within the existing goal.

For reviewer clarification:

- callback with the exact ambiguity and evidence checked.

For invalid or out-of-scope findings:

- keep code unchanged for that finding,
- explain why it does not apply.

## Output

Before editing, write a compact intake summary:

```text
Code review feedback intake:
1. Finding: <reviewer finding id or short quote>
   Decision: <local code bug / pattern bug / verification gap / plan gap / contract gap / systemic design gap / clarification needed / invalid or out of scope>
   Action: <repair / audit and repair / add verification / stop for planner / ask reviewer / no change>
   Evidence: <plan/code/test reference>
```

After acting, report:

- findings repaired,
- tests or verification gates added or run,
- adjacent surfaces audited for pattern bugs,
- findings rejected or needing clarification,
- plan, contract, or systemic gaps that stopped implementation.

## Rules

- Do not edit plans, behavior contracts, surface matrices, acceptance criteria, or
  scope.
- Do not patch through missing behavior decisions.
- Do not implement through a material unresolved behavior decision. Continue
  independent authorized work; ordinary implementation choices are yours.
- Do not silently drop invalid or out-of-scope findings.
