# Convergo

<img src="plugins/codex/assets/logo.png" alt="Convergo logo" width="88" align="right"/>

> Disciplined software engineering for coding agents:
> **plan → review → build** loops that actually terminate.

<!-- hero image: diverging-vs-converging loop diagram (docs/assets/convergo-hero.png) — pending from Iris -->

**Convergo** is a convergence-focused fork of
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
(CE) — the plan-first, test-first, review-everything discipline for coding
agents. CE gets the shape right; Convergo makes the loops terminate. Its one
non-negotiable exit rule: nothing ships until a **fresh reviewer** — a newly
spawned reviewer session with no prior review context — completes a full pass
and reports no blockers.

**Who it's for:** engineers doing correctness-critical, reviewable work with
AI coding agents. Not for quick spikes or throwaway prototypes — see
[Cost and Fit](#cost-and-fit).

## Quick Start

Claude Code — everything ships with the plugin:

```text
/plugin marketplace add gomilesf/convergo
/plugin install convergo
```

Codex — the plugin installs from the marketplace, but the auxiliary reviewer
agents need a one-time install from a checkout (they cannot ship through the
Codex marketplace):

```bash
codex plugin marketplace add gomilesf/convergo
codex        # inside: /plugins -> Convergo -> install convergo

git clone https://github.com/gomilesf/convergo && cd convergo
bun install && bun run install:codex-agents
# restart Codex
```

Then, in a repo with an issue to work on:

```text
/cvg-plan-loop create a plan for issue #42
... review the plan yourself ...
/cvg-build-loop docs/plans/42-plan.md
```

Every other host and option: [Install](#install).

## The Problem

An unbounded agent review loop can fail to settle, and the failure mode is not
"the reviewer found a bug" — that is expected. The failure mode is
non-convergence:

- plan review discovers one symptom at a time instead of the underlying
  missing surface, invariant, or behavior decision;
- the planner responds by adding more text instead of repairing the structure
  of the plan;
- code review pushes the worker into local patches even when the feedback is
  really a plan gap, contract gap, or systemic design gap;
- repeated rounds make the artifact larger, less precise, and more likely to
  accumulate pseudo-code — which creates a new class of review failures.

One missing invariant across eight surfaces should become one plan repair, not
eight rounds of local patches.

## What a Run Looks Like

`/cvg-build-loop docs/plans/rate-limit-plan.md` on Claude Code, condensed:

```text
orchestrator  records base commit and worktree state,
              spawns a WORKER session with the plan, ends its turn (no polling)

worker        implements slice by slice with TDD, one commit per slice,
              keeps impl notes for the reviewer
              -> "Implementation round complete. Base a1b2c3, head d4e5f6.
                  Verification: 41 tests pass. Known gaps: none."

orchestrator  spawns a FRESH REVIEWER session

reviewer      reads plan + diff, dispatches correctness/testing sub-reviewers,
              merges their JSON findings
              -> "Not ready. F1 (P1): retry path drops the rate-limit header.
                  F2: plan never decided burst behavior — contract gap."

orchestrator  returns the findings verbatim to the SAME worker session

worker        intake first, then repair: F1 is implementation-owned -> fixes it
              F2 is a contract gap -> STOPS and reports instead of patching
              around the missing decision

you           decide burst behavior (or send it back through the planner)

worker        finishes the repair -> new head commit
reviewer      same session, focused re-review of the fixes -> pass
orchestrator  spawns a NEW fresh reviewer for a full first pass
fresh review  -> "Ready with fixes. No blockers. Two P2 notes."
orchestrator  exits the loop: base -> head, findings history, P2 list for you
```

Three properties make this a loop and not a spiral: the worker never patches
around a missing decision, review feedback goes back to the session that has
the context, and the exit judgment always comes from a reviewer who has never
seen the code before.

## How Convergo Converges

Every rule below is enforced in the skills, not just described here.

**Feedback goes through intake, not straight to edits.** The planner or worker
that produced the artifact classifies each finding first — code bug, plan gap,
contract gap, systemic design gap, stale, or blocked on a missing decision —
and repairs only what its role owns. Workers stop and call back on plan,
contract, and systemic gaps instead of patching forward.

**Findings carry evidence, not vibes.** Sub-reviewers return findings against
a shared schema: `P0`–`P3` severity, discrete confidence anchors, a
quote-the-line gate for high-confidence claims. Low-confidence findings are
dropped at merge unless they are critical. Reviewers run under a fresh-review
evidence boundary — no project memory, no prior sessions, no rollout history;
only the plan, the diff, and the repo.

**Exit requires a fresh reviewer.** A same-reviewer pass is never the exit
condition. After repairs, the original reviewer re-reviews the fixes; the loop
exits only when a newly spawned reviewer completes a full first pass with no
blockers. "Ready with fixes" (only non-blocking P2 notes remain) counts as
passing — the loop does not churn on nitpicks.

**The loop is capped.** Three rounds without a clean fresh pass stops the loop
and escalates to you with all open findings. Findings already adjudicated
invalid cannot re-block a later round without new evidence (the adjudication
ratchet). Bounded convergence is a rule, not a hope.

**Plans are right-sized decision artifacts.** `/cvg-plan` classifies
complexity first (brief / standard / full); only cross-cutting work gets the
full surfaces + invariant-matrix treatment. Plans never contain code. Open
behavior decisions that bind multiple slices go into a behavior contract
rather than being invented downstream.

**A human sits between planning and building.** The plan loop produces a plan;
the build loop starts only when you explicitly trigger it.

## Two Ways to Use It

**Standalone skills** (any supported host): drive each step yourself. With no
orchestrator, the skills route blocking questions to you directly.

```text
/cvg-plan -> /cvg-plan-review -> (fix via /cvg-plan-review-feedback)
-> /cvg-work -> /cvg-code-review -> (fix via /cvg-code-review-feedback)
```

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
specialist's own prose.

## Cost and Fit

**What a loop spends.** A build-loop run is one worker session, a fresh
reviewer per round (each dispatching two or more sub-reviewer agents), focused
re-reviews, and a final fresh pass — expect an order of magnitude more tokens
than telling an agent to "just implement it". That is the price of
independent review, and it is why the loop is capped at three rounds. The six
base skills used standalone cost roughly what any single-session skill costs;
`claude plugin details convergo` shows the per-skill token numbers.

**What the loops require.** Orchestration needs real sub-session primitives:
background agents on Claude Code, threads on Codex. If the host cannot provide
them, the skills stop with a tool-layer blocker rather than role-playing the
specialists inline. Generic hosts (Cursor, OpenCode, Pi, Gemini) get the six
base skills only.

**When to use something else.** Quick spikes, throwaway experiments, and rapid
visual UI iteration do not need a bounded review loop. Use the base planning
and review skills selectively, or skip Convergo entirely.

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
adapted from CE. Code-review agents return raw JSON against the shared
findings schema (`cvg-code-review/references/findings-schema.md`). Plan-review
personas are skill-local prompt assets under
`cvg-plan-review/references/personas/` and need no platform agent
registration.

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

## Install

### Claude Code

```text
/plugin marketplace add gomilesf/convergo
/plugin install convergo
```

Ships all nine skills and the auxiliary `cvg-*` agents.
`claude plugin details convergo` shows the component inventory and the
projected token cost per skill.

### Codex App

1. Open **Plugins** from the sidebar, click **Add plugin marketplace**.
2. Source: `gomilesf/convergo`, Git ref: `main`, sparse paths blank.
3. Add the marketplace, select **Convergo**, install **convergo**.
4. Install the auxiliary agents from a checkout, then restart Codex:

   ```bash
   git clone https://github.com/gomilesf/convergo && cd convergo
   bun install && bun run install:codex-agents
   ```

### Codex CLI

```bash
codex plugin marketplace add gomilesf/convergo
codex   # inside: /plugins -> Convergo -> install convergo
```

Install the auxiliary agents from a checkout (as above), then restart Codex.
For a non-default profile, run every step against the same `CODEX_HOME`:

```bash
CODEX_HOME="$HOME/.codex/profiles/work" codex plugin marketplace add gomilesf/convergo
CODEX_HOME="$HOME/.codex/profiles/work" codex
CODEX_HOME="$HOME/.codex/profiles/work" bun run install:codex-agents
```

### Cursor

```text
/add-plugin convergo
```

### OpenCode

Add to your global or project `opencode.json`, then restart OpenCode. The
OpenCode plugin registers the base-only skills under `plugins/generic/skills`.

```json
{
  "plugin": ["convergo@git+https://github.com/gomilesf/convergo.git"]
}
```

### Pi

```bash
pi install git:github.com/gomilesf/convergo
```

### Gemini CLI

```bash
gemini extensions install https://github.com/gomilesf/convergo
```

### Upgrading

Installs resolve by version: upgrades need a version bump on the marketplace
side and an explicit update on yours.

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
codex   # /plugins -> Convergo -> install convergo
```

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

Convergo is MIT licensed. Portions of the skill and agent prompt content are
adapted from the MIT-licensed
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
