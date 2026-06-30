# Convergo

> Coding-agent **plan → review → build** loops that actually terminate.

<!-- hero image: diverging-vs-converging loop diagram (docs/assets/convergo-hero.png) — pending from Iris -->

**Convergo** is an opinionated, convergence-focused fork of
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
(CE) for coding-agent workflows where review loops need to terminate cleanly.
**Who it's for:** engineers doing correctness-critical, reviewable work with AI
coding agents — not quick spikes or throwaway prototypes.

CE is a strong methodology: plan before implementation, execute with tests,
review to catch issues and calibrate judgment, and compound the learning for the
next round. In real codebases, though, an unbounded review loop can fail to
settle. A reviewer finds a missing surface, the planner patches that single
point, the next review finds the same weakness from another angle, and the plan
grows round by round. In the worst case the plan starts accumulating
implementation details and pseudo-code, which then creates a new class of review
failures.

Convergo keeps the useful CE discipline and adds convergence rules:
right-sized plans, behavior-contract thresholds for high-risk or missing
behavior decisions, role-specific review feedback handling, fresh-reviewer exit
gates, and Codex-only planner-reviewer and worker-reviewer loops with a human
decision point between planning and implementation.

## Why Convergo Exists

The failure mode this project targets is not "the reviewer found a bug." That is
expected. The failure mode is non-convergence:

- plan review discovers one symptom at a time instead of the underlying missing
  surface, invariant, or behavior decision;
- the planner responds by adding more text instead of stepping back to repair
  the structure of the plan;
- code review pushes the worker into local patches even when the feedback is
  really a plan gap, contract gap, or systemic design gap;
- repeated rounds make the artifact larger, less precise, and more likely to
  contain pseudo-code or implementation-shaped instructions.

`cvg` changes the loop by forcing review feedback through an intake step before
any repair. The planner or worker must decide whether a finding is local,
pattern-level, plan-owned, contract-owned, systemic, stale, or blocked on a
missing decision. That "step back" is the main difference: it prevents a
sequence of small patches from hiding a bigger issue.

## Does It Fit Your Case?

Convergo is optimized for software engineering work where correctness,
testability, and reviewability matter more than speed of iteration. It is a
TDD-oriented workflow for code changes with explicit acceptance criteria.

It is not the best default for quick spikes, throwaway experiments, or highly
interactive UI exploration where the right answer emerges from rapid visual
iteration. You can still use the base planning and review skills there, but the
full plan/build loop is deliberately heavier than a fast prototype workflow.

## Planning Methodology

`/cvg-plan` reads the issue scope and the codebase before writing a plan. It
does not infer product intent from scratch; the accepted goal, acceptance
criteria, and non-goals are the planning authority.

Planning starts with complexity classification:

| Complexity | Signals | Plan shape |
| --- | --- | --- |
| Simple | 1-3 files, one module, clear existing pattern | Brief plan: goal, approach, files, done-when criteria |
| Medium | 3-10 files, multiple modules, some design decisions | Standard plan: goal, approach, independently verifiable slices |
| Cross-cutting | Multiple entry points, stateful lifecycle, invariants across surfaces | Full plan: surfaces, invariants, invariant matrix, slices organized by invariant |

Full plans are built around surfaces and invariants. If the same behavior must
hold through HTTP handlers, background jobs, callbacks, CLI paths, or other
entry points, the plan must list those surfaces and make the invariant matrix
reviewable. The worker then implements one invariant across all listed surfaces
before moving to the next slice.

Plans are decision artifacts, not implementation drafts. They must not contain
function signatures, pseudo-code, or code blocks. If an implementation detail is
needed to make the plan understandable, the plan should name the decision and
the affected files or surfaces, not write the code in advance.

Behavior contracts are part of that planning threshold. `/cvg-plan` does not
create one merely because the plan could be more detailed. Stage and
issue-specific risk raise the threshold when implementation or review would
otherwise require the worker to invent behavior that the accepted goal, plan,
and codebase do not define. Use or create a contract for stable semantics across
migration, rollback, deletion, privacy, safety, persistence, external APIs, or
protocol behavior; for cross-surface invariants that need one shared authority;
or when plan review or implementation exposes a source-backed or
decision-required contract gap. Workers stop at contract gaps and call back so
the planner, user, or project authority can update the plan or contract first.

## Review Feedback

`/cvg-plan-review-feedback` and `/cvg-code-review-feedback` exist for one reason:
review feedback is not an edit list.

When feedback arrives, the same planner or worker that produced the artifact
first classifies each blocker. Some findings are local fixes. Others are plan
gaps, contract gaps, systemic design gaps, stale findings, or missing decisions.

That classification is what keeps the loop bounded. A worker can repair a local
code bug, but if code review exposes a contract gap, plan gap, or systemic
design gap, the worker breaks the loop and sends a callback instead of blindly
patching forward. One missing invariant across eight surfaces should become one
plan or contract repair, not eight rounds of local patches.

## Bonus for Codex

The base skills work across supported agent hosts. Codex adds a stronger
execution surface because it can create, continue, and inspect real Codex
threads. Convergo uses that capability to run monitored planner,
reviewer, worker, and QA threads with callback transport, heartbeat waiting,
focused re-review, and fresh-reviewer exit gates.

The Codex-only loop skills are:

- `/cvg-plan-loop`: planner and plan reviewers iterate until a fresh reviewer
  finds no blocking plan issues.
- `/cvg-build-loop`: worker and code reviewers iterate until a fresh reviewer
  finds no blocking implementation issues.

The human sits between those loops. After `/cvg-plan-loop` produces a finished
plan, the user reviews and questions the plan before implementation starts.
`/cvg-build-loop` starts only when the user explicitly triggers it. If the plan
requires integration, staging, end-to-end, deployment, or smoke checks, Codex
runs those gates after clean code review; real failures can reopen the build
loop.

## Workflow Summary

```text
discuss goal
-> /cvg-plan-loop
-> human reviews and questions the plan
-> human triggers /cvg-build-loop
-> final fresh code review
-> required QA gates, if any
-> done
```

## Skills

| Skill | Purpose | Best fit |
| --- | --- | --- |
| `/cvg-plan` | Read an issue and codebase, then write a sliced plan with an invariant matrix when needed | Claude Code, Codex |
| `/cvg-plan-review` | Review a plan against the actual codebase for missing surfaces, incomplete slices, and wrong invariants | Claude Code, Codex |
| `/cvg-plan-review-feedback` | Handle cvg-plan-review blockers inside the planner session before revising plan-owned artifacts | Claude Code, Codex |
| `/cvg-work` | Execute a plan slice by slice with TDD and implementation notes | Claude Code, Codex |
| `/cvg-code-review` | Review implementation against the plan and contract, separating code bugs from contract gaps | Claude Code, Codex |
| `/cvg-code-review-feedback` | Handle cvg-code-review blockers inside the worker session before repairing implementation-owned issues | Claude Code, Codex |
| `/cvg-plan-loop` | Orchestrate the plan -> fresh cvg-plan-review loop across real Codex threads | Codex |
| `/cvg-build-loop` | Orchestrate worker -> fresh cvg-code-review -> repair -> final fresh-review across real Codex threads | Codex |
| `/cvg-multi-session` | Shared Codex multi-thread protocol for specialist handoff, callbacks, heartbeat waiting, and exit gates | Codex |

## Auxiliary Agents

The planning and review skills also vendor a small auxiliary
reviewer/researcher set adapted from Compound Engineering. Plan-review personas
live as skill-local prompt assets under
`cvg-plan-review/references/personas/`, so they do not depend on platform-level
custom-agent registration. Planning research and code-review personas are still
packaged as `cvg-*` agents for Claude Code and Codex.

| Agent | Used by |
| --- | --- |
| `cvg-best-practices-researcher` | `/cvg-plan` |
| `cvg-repo-research-analyst` | `/cvg-plan` |
| `cvg-correctness-reviewer` | `/cvg-code-review` |
| `cvg-testing-reviewer` | `/cvg-code-review` |
| `cvg-security-reviewer` | `/cvg-code-review` |
| `cvg-adversarial-reviewer` | `/cvg-code-review` |
| `cvg-reliability-reviewer` | `/cvg-code-review` |

## Install

> Note: the project is named **Convergo**, but its marketplace / package id is
> still `convergo` (the repository has not been renamed yet). Use the
> ids exactly as shown in the commands below.

### Claude Code

```text
/plugin marketplace add gomilesf/convergo
/plugin install convergo
```

The Claude plugin exposes only the six base skills: `/cvg-plan`, `/cvg-plan-review`, `/cvg-plan-review-feedback`, `/cvg-work`, `/cvg-code-review`, and `/cvg-code-review-feedback`.

### Codex App

Convergo is installed as a custom plugin marketplace:

1. In the Codex app, open **Plugins** from the sidebar.
2. Click **Add** or **Add plugin marketplace**.
3. Enter:

   | Field | Value |
   | --- | --- |
   | Source | `gomilesf/convergo` |
   | Git ref | `main` |
   | Sparse paths | leave blank |

4. Click **Add marketplace**.
5. Select **Convergo** and install **convergo**.
6. From this repository checkout, install the auxiliary Codex agents:

   ```bash
   bun run install:codex-agents
   ```

7. Restart Codex.

### Codex CLI

Register the marketplace, then install through the Codex `/plugins` TUI:

```bash
codex plugin marketplace add gomilesf/convergo
codex
```

Inside Codex, run `/plugins`, choose **Convergo**, install **convergo**, then restart Codex.

Install the auxiliary Codex agents from this repository checkout before restarting:

```bash
bun run install:codex-agents
```

For a non-default Codex profile, run each step against the same `CODEX_HOME`:

```bash
CODEX_HOME="$HOME/.codex/profiles/work" codex plugin marketplace add gomilesf/convergo
CODEX_HOME="$HOME/.codex/profiles/work" codex
CODEX_HOME="$HOME/.codex/profiles/work" bun run install:codex-agents
```

### Cursor

In Cursor Agent chat, install from the plugin marketplace:

```text
/add-plugin convergo
```

### OpenCode

Add the plugin to your global or project `opencode.json`:

```json
{
  "plugin": ["convergo@git+https://github.com/gomilesf/convergo.git"]
}
```

Restart OpenCode after changing the config. The OpenCode plugin registers the base-only generated skills under `plugins/generic/skills`.

### Pi

```bash
pi install git:github.com/gomilesf/convergo
```

### Gemini CLI

```bash
gemini extensions install https://github.com/gomilesf/convergo
```

## Local Development

```bash
bun install
bun run sync
bun run validate
bun test
bun run plugin:validate
```

### Load This Checkout Directly

Claude Code:

```bash
claude --plugin-dir "$PWD/plugins/claude"
```

Codex CLI:

```bash
codex plugin marketplace add "$PWD"
codex
```

Then run `/plugins`, choose **Convergo**, and install **convergo**.

OpenCode:

```json
{
  "plugin": ["/path/to/convergo"]
}
```

Pi:

```bash
pi -e "$PWD"
```

Gemini CLI:

```bash
gemini extensions install "$PWD"
```

## License and Attribution

Convergo is MIT licensed. Portions of the skill and agent prompt
content are adapted from the MIT-licensed
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
plugin. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Repository Layout

```text
skills-src/        Canonical skill sources
agents-src/        Canonical auxiliary agent sources
plugins/codex/     Codex plugin root with all nine skills and Codex agents
plugins/claude/    Claude Code plugin root with six base skills and Claude agents
plugins/generic/   Base-only skill root for generic hosts
.claude-plugin/    Claude Code marketplace metadata
.agents/plugins/   Codex custom marketplace descriptor
.cursor-plugin/    Cursor marketplace metadata
.opencode/         OpenCode package entrypoint
.pi/               Pi extension entrypoint
src/               Productization validation library
scripts/           Sync and validation text interfaces
tests/             Metadata and skill convention tests
docs/              Productization notes
```
