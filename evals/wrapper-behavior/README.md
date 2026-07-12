# Wrapper-behavior evals

Behavioral evals for the codex-backed specialist wrapper pattern shared by
`cvg-hybrid-plan-loop` and `cvg-hybrid-build-loop`. Complements
`evals/trigger` (which only tests skill *selection*): these test what the
pattern *does*.

Both layers are manual, cost-bearing runs — they are not part of `bun test`.

## Layer A: wrapper compliance (`bun run eval:wrapper`)

Spawns a real sonnet wrapper (`claude -p`) against a stub `codex` binary
(`stub/codex`, staged at the front of PATH) that records argv and plays a
scripted failure mode. Asserts on recorded invocations + the wrapper's final
message:

| scenario | asserts |
| --- | --- |
| `ok-slow` | payload relayed verbatim + session line; exactly 1 launch; survives a wait cycle |
| `exit1-with-output` | the R4 incident: nonzero exit with complete `-o` file is still relayed, never relaunched |
| `exit1-empty` | hard failure reported, not retried, no fabricated payload |
| `command-fidelity` | `-o` path and prompt survive verbatim |

### Ablation

`bun run eval:wrapper -- --ablate R_EXITCODE` removes a rule block from the
wrapper prompt and reruns the scenarios. A rule is load-bearing if removing
it fails the scenario that motivated it; a rule whose removal changes
nothing is a deletion candidate. Rules: `R_STAY`, `R_EXITCODE`, `R_ONCE`,
`R_RELAY`.

The wrapper prompt template in `wrapper-compliance.ts` mirrors the
Codex-Backed Specialist Pattern section of the two hybrid SKILL.md files —
keep them in sync when the pattern changes.

## Layer C: orchestrator scoping (`bun run eval:scoping`)

Feeds the shipped `cvg-hybrid-build-loop` text plus a fixture three-repo
plan to a real agent playing the orchestrator, with deliberately NEUTRAL
prompts (the production failure was not-declaring the split unprompted, so
the scenario must not ask for it). Asserts a content-level floor: the
Phase 0 message names the uncovered repos; a single-repo completion
summary names them and reports `plan_complete: false`.

`--ablate` removes the Cross-Repo Plans section. Honest finding from the
first runs: at this fixture size, sonnet largely produces the scoping
behavior even ablated — the differential did not reproduce at eval scale
(the motivating incident happened under full production context pressure).
Treat Layer C as a regression floor for the shipped text, not proof the
section is load-bearing. Two grader lessons are baked in: don't assert
phrasing (two false negatives, one because the agent answered in Chinese),
assert content.

## Baseline results (2026-07-04, codex-cli 0.142.3, sonnet wrapper)

- Layer A baseline: 4/4.
- Ablations:
  - `R_STAY` removed → `ok-slow` FAILS, reproducing the production orphan
    verbatim ("Codex is running in the background; I'll wait...").
    **Load-bearing.**
  - `R_EXITCODE` removed → `exit1-with-output` passed 2/2 and
    `exit1-empty` passed 1/1. Not shown load-bearing for a sonnet wrapper
    when `R_STAY`/`R_ONCE`/`R_RELAY` are present (the wait loop already
    routes by file, not exit code). Kept anyway: it also carries the
    hard-failure reporting path, wrapper models vary, and its cost is a
    few lines — but it is the first candidate if the pattern needs a diet.
