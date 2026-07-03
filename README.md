# Convergo

<img src="plugins/codex/assets/logo.png" alt="Convergo logo" width="88" align="right"/>

> Disciplined software engineering for coding agents:
> **plan → review → build** loops that actually terminate.

<!-- hero image: diverging-vs-converging loop diagram (docs/assets/convergo-hero.png) — pending from Iris -->

**Convergo** is an opinionated, convergence-focused fork of
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
(CE): sliced plans with done-when criteria, TDD implementation, and review
loops that exit only when an independent fresh reviewer reports no blockers.
**Who it's for:** engineers doing correctness-critical, reviewable work with AI
coding agents — not quick spikes or throwaway prototypes.

## Quick Start

Claude Code:

```text
/plugin marketplace add gomilesf/convergo
/plugin install convergo
```

Codex CLI:

```bash
codex plugin marketplace add gomilesf/convergo
codex   # then /plugins -> Convergo -> install convergo, restart
bun run install:codex-agents   # auxiliary agents, from a checkout of this repo
```

Every supported host and option: [Install](#install).

## The Problem

CE's discipline is right: plan before implementation, execute with tests,
review to catch issues. But in real codebases an unbounded review loop can fail
to settle, and the failure mode is not "the reviewer found a bug" — that is
expected. The failure mode is non-convergence:

- plan review discovers one symptom at a time instead of the underlying missing
  surface, invariant, or behavior decision;
- the planner responds by adding more text instead of repairing the structure
  of the plan;
- code review pushes the worker into local patches even when the feedback is
  really a plan gap, contract gap, or systemic design gap;
- repeated rounds make the artifact larger, less precise, and more likely to
  accumulate pseudo-code — which then creates a new class of review failures.

One missing invariant across eight surfaces should become one plan repair, not
eight rounds of local patches.

## How Convergo Converges

Every rule below exists to bound the loop. They are enforced in the skills, not
just described here.

**Feedback goes through intake, not straight to edits.** When review blockers
arrive, the same planner or worker that produced the artifact first classifies
each finding — local code bug, pattern bug, verification gap, plan gap,
contract gap, systemic design gap, stale, or blocked on a missing decision —
and only then repairs what its role owns. Workers stop and call back on plan,
contract, and systemic gaps instead of patching forward. This intake step is
the core difference from a naive review loop.

**Findings carry evidence, not vibes.** Code-review sub-reviewers return
findings against a shared schema (`P0`–`P3` severity, discrete confidence
anchors `0/25/50/75/100`, a quote-the-line gate for high-confidence claims).
Low-confidence findings are dropped at merge unless they are critical.
Reviewers run under a fresh-review evidence boundary: no project memory, no
prior sessions, no rollout history — only the plan, the diff, and the repo.

**Exit requires a fresh reviewer.** A same-reviewer pass is never the exit
condition. After repairs, the original reviewer does a focused re-review; the
loop exits only when a *newly spawned* reviewer with no prior review context
completes a full first pass with no blockers. "Ready with fixes" (only
non-blocking P2 notes remain) counts as passing — the loop does not churn on
nitpicks.

**The loop is capped.** Three review rounds without a clean fresh pass stops
the loop and escalates to the human with all open findings. Findings already
adjudicated invalid cannot re-block a later round without new evidence (the
adjudication ratchet). "Bounded convergence" is a rule, not a hope.

**Plans are right-sized decision artifacts.** `/cvg-plan` classifies complexity
first (brief / standard / full) and only cross-cutting work gets the full
surfaces + invariant-matrix treatment. Plans never contain code or function
signatures. When open behavior decisions bind multiple slices or surfaces, they
are recorded in a behavior contract rather than invented downstream.

**A human sits between planning and building.** The plan loop produces a plan;
the build loop starts only when the user explicitly triggers it.

## Two Ways to Use It

**Standalone skills** (any supported host): drive each step yourself.

```text
/cvg-plan -> /cvg-plan-review -> (fix via /cvg-plan-review-feedback)
-> /cvg-work -> /cvg-code-review -> (fix via /cvg-code-review-feedback)
```

When there is no orchestrator, the skills route blocking questions to you
directly.

**Orchestrated loops** (Claude Code and Codex): the session becomes an
orchestrator that spawns and supervises real specialist sessions.

```text
discuss goal
-> /cvg-plan-loop        planner <-> fresh plan reviewers, until clean
-> human reviews and questions the plan
-> /cvg-build-loop       worker <-> fresh code reviewers, until clean
-> final fresh code review
-> required QA gates, if any
-> done
```

The loop skills share one protocol (`cvg-multi-session`), bound to the host
platform before anything else runs: specialists are Codex threads (callbacks
via `send_message_to_thread`, heartbeat waiting) or Claude Code background
agents (final-message callbacks, task-notification waiting). Each platform's
build ships only its own transport mechanics — the copies under
`plugins/codex` and `plugins/claude` are generated from one canonical source.
Specialist identity always comes from the platform tool result, never from the
specialist's own prose. Generic hosts get the six base skills only — they lack
specialist-session primitives.

## Skills

| Skill | Purpose | Platforms |
| --- | --- | --- |
| `/cvg-plan` | Read an issue and codebase, then write a sliced plan with an invariant matrix when needed | Claude Code, Codex, generic |
| `/cvg-plan-review` | Review a plan against the actual codebase for missing surfaces, incomplete slices, and wrong invariants | Claude Code, Codex, generic |
| `/cvg-plan-review-feedback` | Classify and handle plan-review blockers inside the planner session | Claude Code, Codex, generic |
| `/cvg-work` | Execute a plan slice by slice with TDD and implementation notes | Claude Code, Codex, generic |
| `/cvg-code-review` | Review implementation against the plan and contract, separating code bugs from contract gaps | Claude Code, Codex, generic |
| `/cvg-code-review-feedback` | Classify and handle code-review blockers inside the worker session | Claude Code, Codex, generic |
| `/cvg-plan-loop` | Orchestrate planner -> fresh plan review -> repair -> final fresh review | Claude Code, Codex |
| `/cvg-build-loop` | Orchestrate worker -> fresh code review -> repair -> final fresh review -> QA gates | Claude Code, Codex |
| `/cvg-multi-session` | Shared multi-session protocol: transport binding, callbacks, waiting, feedback routing, exit gates | Claude Code, Codex |

## Auxiliary Agents

`/cvg-plan` and `/cvg-code-review` fan out to a small reviewer/researcher set
adapted from CE. Code-review agents return raw JSON against the shared findings
schema (`cvg-code-review/references/findings-schema.md`). Plan-review personas
are skill-local prompt assets under `cvg-plan-review/references/personas/` and
need no platform agent registration.

| Agent | Used by | When |
| --- | --- | --- |
| `cvg-best-practices-researcher` | `/cvg-plan` | non-obvious design work |
| `cvg-repo-research-analyst` | `/cvg-plan` | always |
| `cvg-correctness-reviewer` | `/cvg-code-review` | always |
| `cvg-testing-reviewer` | `/cvg-code-review` | always |
| `cvg-security-reviewer` | `/cvg-code-review` | auth, input, permissions, data handling |
| `cvg-adversarial-reviewer` | `/cvg-code-review` | large or high-risk diffs |
| `cvg-reliability-reviewer` | `/cvg-code-review` | error handling, retries, timeouts, jobs |

## Working Artifacts

Convergo leaves a reviewable paper trail:

- `docs/plans/<issue-id>-plan.md` — the plan; `<issue-id>-contract.md` beside
  it when a behavior contract is warranted
- `docs/impl-notes/<issue-id>.md` — worker decisions, deviations, and flagged
  assumptions the reviewer needs
- `/tmp/convergo/cvg-code-review/<run-id>/` and
  `/tmp/convergo/cvg-plan-review/<run-id>/` — per-run audit artifacts:
  `review.json` (verdict, merged findings, auxiliary coverage) plus one JSON
  per sub-reviewer

## Does It Fit Your Case?

Convergo is optimized for work where correctness, testability, and
reviewability matter more than iteration speed: a TDD-oriented workflow for
code changes with explicit acceptance criteria. It is deliberately heavier than
a prototype workflow — for quick spikes, throwaway experiments, or rapid visual
UI iteration, use the base planning and review skills selectively or skip it.

## Install

### Claude Code

```text
/plugin marketplace add gomilesf/convergo
/plugin install convergo
```

The Claude plugin ships all nine skills (base + orchestrated loops) and the
auxiliary `cvg-*` agents. `claude plugin details convergo` shows the component
inventory and the projected token cost per skill.

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

### Upgrading

Installs resolve by version, so upgrades require a version bump on the
marketplace side and an explicit update on yours:

```text
/plugin marketplace update convergo-plugin    (Claude Code)
/plugin update convergo
```

```bash
codex plugin marketplace upgrade convergo-plugin   # Codex CLI
codex plugin add convergo@convergo-plugin
```

## Local Development

```bash
bun install
bun run sync           # regenerate plugins/*/skills from skills-src/
bun run validate       # productization metadata checks
bun test               # metadata + skill convention tests
bun run plugin:validate
bun run eval:trigger   # LLM eval: skill descriptions route the right prompts
```

### Source layout and generated builds

`skills-src/` is the single source of skill content. `bun run sync` generates
the platform roots: it strips `<!-- codex -->` / `<!-- claude -->` marker
blocks so each platform build carries only its own transport mechanics, and it
renders the loop skills' `references/cvg-multi-session-protocol.md` copies
from the canonical `skills-src/cvg-multi-session/SKILL.md`. Never edit
generated files by hand; `bun test` byte-checks every platform copy against
the transformed source.

The other static tests guard the contracts that keep the loop sound: the
findings schema ships with every `cvg-code-review` copy, the stage-calibration
block stays identical across skills, and agent prompts contain no dangling
references.

### Trigger-routing evals

`eval:trigger` replays the routing prompts in `evals/trigger/cases.json`
against the current `skills-src/` descriptions through `claude -p`, with
frozen descriptions of real competing skills (compound-engineering, built-in
review commands) in the candidate list, so convergo must win against a
realistic install. Cases cover per-skill positives, paraphrases that avoid
convergo vocabulary, boundary prompts with accept-either answers, calibration
prompts a distractor must win, and no-skill negatives. Run it after changing
any skill `description`; add `-- --runs 3` to check stability and
`EVAL_MODEL=sonnet` to cross-check with a stronger judge. It costs a few LLM
calls, so it is not part of `bun test`.

### End-to-end smoke test

Before releases that touch the loop skills, run the manual gate:
[docs/loop-smoke-test.md](docs/loop-smoke-test.md), a seeded-bug micro
build-loop that exercises spawn, fresh review, feedback-to-same-worker,
focused re-review, and the final fresh exit on the Claude Code transport.

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
skills-src/        Canonical skill sources (with platform marker blocks)
agents-src/        Canonical auxiliary agent sources
plugins/codex/     Codex plugin root: nine Codex-stripped skills + Codex agents
plugins/claude/    Claude Code plugin root: nine Claude-stripped skills + Claude agents
plugins/generic/   Base-only skill root for generic hosts
evals/             Trigger-routing eval cases (run with bun run eval:trigger)
.claude-plugin/    Claude Code marketplace metadata
.agents/plugins/   Codex custom marketplace descriptor
.cursor-plugin/    Cursor marketplace metadata
.opencode/         OpenCode package entrypoint
.pi/               Pi extension entrypoint
src/               Productization validation library + platform-content transforms
scripts/           Sync, validation, and eval text interfaces
tests/             Metadata and skill convention tests
docs/              Productization notes and the loop smoke-test runbook
```
