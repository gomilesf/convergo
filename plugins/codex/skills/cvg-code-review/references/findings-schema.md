# Findings Schema

Shared output contract for all auxiliary reviewers. The dispatching reviewer
includes this file's content in every auxiliary reviewer prompt. Findings that
do not conform are rejected at merge.

## JSON shape

Return exactly one raw JSON object:

```json
{
  "reviewer": "<persona name, e.g. correctness>",
  "findings": [
    {
      "title": "<short specific issue title, 10 words or fewer>",
      "severity": "P0 | P1 | P2 | P3",
      "file": "<relative path from repository root>",
      "line": 42,
      "why_it_matters": "<what breaks, led by observable behavior, 2-4 sentences>",
      "suggested_fix": "<concrete minimal fix, or null when no code-level change exists>",
      "confidence": 100,
      "evidence": ["<file:line -- verbatim code line>", "<supporting reference>"],
      "pre_existing": false
    }
  ],
  "residual_risks": ["<risk noticed but not confirmable as a finding>"],
  "testing_gaps": ["<missing test coverage identified>"]
}
```

Hard constraints:

- `severity`: exactly one of `"P0"`, `"P1"`, `"P2"`, `"P3"`. Never `"high"`,
  `"critical"`, or other vocabulary.
- `confidence`: exactly one of `0`, `25`, `50`, `75`, `100`. Discrete anchors
  only; `72` or `0.85` is a validation failure.
- `evidence`: an array with at least one string, even for a single quote.
- `pre_existing`: boolean, never null. True only for issues in unchanged code
  unrelated to this diff. If the diff makes a dormant issue newly relevant, it
  is not pre-existing.
- `findings` may be empty; still populate `residual_risks` and `testing_gaps`
  when applicable.

## Severity definitions

- **P0** - critical breakage, exploitable vulnerability, data loss or
  corruption. Must fix before merge.
- **P1** - high-impact defect, or a gap preventing an agreed outcome or its
  critical verification. A plan/contract violation is blocking only when the
  requirement is grounded in user intent or applicable product/safety constraints.
- **P2** - moderate issue with meaningful downside: narrow edge case, perf
  regression, maintainability trap. Non-blocking.
- **P3** - low-impact or stylistic. Do not emit; style belongs to tooling.

## Confidence anchors

Pick the single anchor whose behavioral criterion you can honestly self-apply.

- **`0` / `25` - suppress, never emit.** False positive, pre-existing, or
  unverifiable speculation. If genuinely uncertain, gather more evidence
  (read related files, check call sites) until you can anchor at 50+, or drop.
- **`50` - verified real but minor, or real-looking but not fully
  confirmable.** Emit as a finding only when severity is P0
  (critical-but-uncertain issues must not be silently dropped); otherwise
  record the concern in `residual_risks` or `testing_gaps`.
- **`75` - highly confident.** You double-checked the diff and surrounding
  code and can name a concrete observable consequence in normal usage: a wrong
  result, an unhandled error path, a contract mismatch, a security exposure.
  "This could be cleaner" does not meet this bar.
- **`100` - verifiable from the code alone.** Compile error, type mismatch,
  definitive logic bug, or a quotable project-standards violation. No
  interpretation required.

**Quote-the-line gate:** before anchoring a finding at 75 or 100, quote the
verbatim line(s) that make it true, with `file:line`, as the first `evidence`
item. "Field X doesn't exist" requires quoting where X would be defined; "may
return null" requires quoting the initialization; "race between A and B"
requires quoting both. If you cannot quote the motivating line, step down
to 50. When a framework metaclass, ORM, decorator, or migration generates the
symbol, quoting the meta-construct satisfies the gate; a failed grep for the
literal name does not.

## Suppress entirely (not even at anchor 50)

- Pre-existing issues unrelated to this diff (unless newly made relevant).
- Style and lint-level nitpicks the project's tooling already catches.
- Code that looks wrong but is intentional per comments, commit messages, or
  surrounding code.
- Issues already handled by callers, guards, middleware, or framework
  defaults. Check before flagging.
- Generic "consider adding X" advice without a concrete failure mode. If you
  cannot name what breaks, suppress.
- Code carrying an explicit lint-disable comment for the rule in question.
- Speculative future concerns with no current signal in the diff.

## Merge rules (applied by the dispatching reviewer)

- Findings below confidence 75 are dropped from the actionable set, except
  P0 findings at confidence 50+.
- Deduplicate by file+line; keep the highest severity on overlap.
- `residual_risks` and `testing_gaps` merge into the review's non-blocking
  notes.
