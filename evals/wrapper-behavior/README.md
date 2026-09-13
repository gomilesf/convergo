# Wrapper-behavior evals

Behavioral evals for the codex-backed specialist wrapper pattern shared by
`cvg-hybrid-plan-loop` and `cvg-hybrid-build-loop`. Complements
`evals/trigger` (which only tests skill *selection*): these test what the
pattern *does*.

All of these are manual, cost-bearing runs — they are not part of `bun test`.

## Ground truth: resume re-pin (`bun run eval:repin`)

Three real codex calls asserting the behavior the hybrid skills' resume
command depends on: `codex exec resume` drops the first run's `-m` pin and
re-resolves from the user's config, so every resume must re-pin with
`-c model=` / `-c model_reasoning_effort=`. Reports what a bare resume
resolves to (the canary line), asserts the re-pinned resume holds. Rerun
after every codex CLI upgrade.

## Layer A: wrapper compliance (`bun run eval:wrapper`)

Spawns a real sonnet wrapper (`claude -p`) against a stub `codex` binary
(`stub/codex`, staged at the front of PATH) that records argv and plays a
scripted failure mode. Each scenario runs two phases against the same claude
session — launch + ARMED, then a resumed relay request — mirroring the
ARMED-handoff design in which the orchestrator owns the waiting via a
background watcher. Asserts on recorded invocations, the ARMED message, and
the relay:

| scenario | asserts |
| --- | --- |
| `arm-fast` | slow stub (60s): phase 1 ends ARMED without waiting, duration-bounded; an R_ARM-ablated wrapper waits and blows the bound |
| `relay-on-request` | fast stub (2s): payload + session line relayed verbatim — in-turn via the fast path or on the resumed relay request; exactly 1 launch |
| `exit1-with-output` | the R4 incident: nonzero exit with complete `-o` file is still relayed, never relaunched |
| `exit1-empty` | hard failure reported, not retried, no fabricated payload |
| `command-fidelity` | `-m` pin, effort override, `-o` path, and prompt survive verbatim |

### Ablation

`bun run eval:wrapper -- --ablate R_EXITCODE` removes a rule block from the
wrapper prompt and reruns the scenarios. A rule is load-bearing if removing
it fails the scenario that motivated it; a rule whose removal changes
nothing is a deletion candidate. Rules: `R_ARM`, `R_EXITCODE`, `R_ONCE`,
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

## Baseline results (2026-07-12, codex-cli 0.144.1, sonnet wrapper, ARMED-handoff design)

- Layer A baseline: 5/5 (`arm-fast`, `relay-on-request`, `exit1-with-output`,
  `exit1-empty`, `command-fidelity`).
- `R_ARM` ablation → `arm-fast` FAILS: the wrapper stops with "Codex session
  launched in the background. I'll wait for it to complete before relaying"
  — the 2026-07-04 production-orphan phrasing verbatim. **Load-bearing** for
  callback shape; note the orchestrator-side watcher still recovers even
  this drift, which is the point of the ARMED-handoff design.
- Historical: the pre-ARMED wait-loop design and its `R_STAY` rule are gone —
  the orchestrator owns the waiting now, so wrapper keep-alive is a
  non-problem by construction.
- Eval-harness limit, not a production limit: `claude -p` kills background
  children at process exit (verified), so no scenario can observe a
  cross-process ARMED-then-relay gap; `arm-fast` (slow stub, phase 1 only)
  and `relay-on-request` (fast stub, both phases) split that coverage.

## Intent and convergence decisions (`bun run eval:convergence`)

Nine fixed fixtures check unnecessary cache/merge machinery, a wrong product
outcome hidden by green tests, focused exit, new evidence, a necessary privacy
guard, missing extension-load acceptance, optional auxiliary identities and
required independent signatures. The grader receives expected choices;
the model receives only task facts and neutral decision options. Read the saved
reasons as well as the decision score. This is decision coverage, not proof of a
real multi-agent lifecycle or an implemented repair.

The runner disables tools and MCP, uses a temporary cwd, records raw results,
model usage and timings, and fails on timeout, CLI errors or malformed answers.
`EVAL_MODEL` selects the model (default `sonnet`). Compare the same fixtures and
model with a frozen source tree using `--skills-root /path/to/skills-src`.
`--ablate` removes the necessity paragraph for the two relevant repair fixtures;
`--case <id>` runs one case. If removal preserves behavior, do not claim that
paragraph is proven necessary. Real lifecycle validation remains the smoke test.
