<div align="center">

<img src="docs/assets/logo.png" alt="Convergo logo" width="120"/>

# Convergo

**Plan → review → build loops for coding agents — that actually terminate.**

[![License: MIT](https://img.shields.io/badge/license-MIT-e8442e)](LICENSE)
[![Skills](https://img.shields.io/badge/skills-11-2b2b28)](#skills)
[![Platforms](https://img.shields.io/badge/platforms-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20OpenCode%20%C2%B7%20Pi%20%C2%B7%20Gemini-8a7a5c)](#install)

[Quick Start](#quick-start) · [Why](#why-convergo-exists) · [How It Works](#the-rules-that-make-it-converge) · [Hybrid Loops](#hybrid-loops-fable-plans-codex-builds) · [Skills](#skills) · [Install](#install)

</div>

![Convergo hero](docs/assets/hero.webp)

Agent-written code needs review, and agent review needs a loop: find issues,
fix them, review again. The dirty secret is that this loop often **doesn't
converge** — each round adds patches, prose, and pseudo-code instead of
closing in on done. Convergo is a plugin that bounds that loop by
construction. **The original user outcome anchors scope. One independent full
review is followed by focused repair checks; a clean recheck can finish the
review. Further full reviews need material change, new evidence or an explicit
requirement. Three repair rounds without resolving real blockers stop with an
honest unfinished result.**

It is a convergence-focused fork of
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin):
CE gets the plan-first, review-everything shape right; Convergo makes the
loops terminate.

**Built for** correctness-critical, reviewable work with AI coding agents.
Not for quick spikes or throwaway prototypes — see [Cost and Fit](#cost-and-fit).

## Quick Start

Claude Code — everything ships with the plugin:

```text
/plugin marketplace add gomilesf/convergo
/plugin install convergo
```

Codex and every other host: see [Install](#install) — every host is a
single plugin install.

Then, in a repo with an issue to work on:

```text
/cvg-plan-loop create a plan for issue #42
... review the plan yourself ...
/cvg-build-loop docs/plans/42-plan.md
```

## Why Convergo Exists

![Diverging vs converging review loops](docs/assets/problem.webp)

An unbounded agent review loop can fail to settle — and the failure mode is
not "the reviewer found a bug" (that's the loop working). The failure mode is
**divergence**:

- Plan review discovers one symptom per round instead of the missing surface,
  invariant, or behavior decision underneath them all.
- The planner responds by adding more text instead of repairing the plan's
  structure.
- Code review pushes the worker into local patches even when the finding is
  really a plan gap, a contract gap, or a systemic design gap.
- Every round makes the artifact larger, vaguer, and more likely to
  accumulate pseudo-code — which spawns a new class of review findings.

One missing invariant across eight surfaces should become **one plan repair,
not eight rounds of local patches**. Convergo's rules exist to force exactly
that.

## What a Run Looks Like

`/cvg-build-loop docs/plans/rate-limit-plan.md` on Claude Code, condensed:

```text
orchestrator  records base commit and worktree state,
              spawns a WORKER session with the plan, ends its turn (no polling)

worker        implements behavior slices with regression evidence,
              keeps impl notes for the reviewer
              -> "Implementation round complete. Base a1b2c3, head d4e5f6.
                  Verification: 41 tests pass. Known gaps: none."

orchestrator  spawns a FRESH REVIEWER session

reviewer      checks original intent + plan + diff, selecting auxiliaries
              only for relevant risk or required independent coverage
              -> "Not ready. F1 (P1): retry path drops the rate-limit header.
                  F2: plan never decided burst behavior — contract gap."

orchestrator  adjudicates scope/severity against the goal and evidence,
              returns original findings + reasons to the SAME worker

worker        intake first, then repair: F1 is implementation-owned -> fixes it
              F2 needs a product decision -> pauses dependent work and reports
              while independent authorized work continues

planner       resolves source-backed omissions; asks you only if a real
              product or risk decision is missing

worker        finishes the repair -> new head commit

reviewer      (same session) focused re-review of the fixes -> pass

orchestrator  confirms required acceptance and original intent are satisfied,
              exits with the review result and any non-blocking P2 notes
```

Feedback preserves the original goal, the actor considers removing unnecessary
mechanisms before adding patches, and focused verification can close the loop.

## The Rules That Make It Converge

Every rule below is written into the skills, not just described here. What
can be machine-checked is — the findings schema is validated per finding,
and the generated platform builds are byte-checked by tests; the behavioral
rules are prompt contracts, exercised end-to-end by the release smoke test.

**Original intent governs the plan.** The user outcome, explicit non-goals,
authorized changes and current product/safety constraints govern scope. Candidate
surfaces are investigated before becoming requirements. Completion checks for
omissions, unnecessary additions and changed semantics.

**Consider removal before adding machinery.** Before a materially new mechanism
or a repair, identify what required behavior fails without it. Removing a cache,
state or accidental capability may eliminate an entire failure class. Use an
isolated ablation experiment only when uncertainty warrants it; keep necessary
protections. This adds no mandatory artifact or review round.

**Feedback goes through evidence-based intake.** The orchestrator can adjudicate
scope and severity, preserving original findings and reasons. Workers repair
implementation; planners revise plans. Only dependent work pauses for a material
unresolved decision. Ordinary technical omissions do not automatically require
another user approval.

**Findings carry evidence, not vibes.** Sub-reviewers return findings against
a shared schema: `P0`–`P3` severity, discrete confidence anchors, a
quote-the-line gate for high-confidence claims. Low-confidence findings are
dropped at merge unless they are critical, and P3 style findings are never
emitted at all — style belongs to tooling, not the loop. Reviewers run under
a fresh-review evidence boundary — no project memory, no prior sessions, no
rollout history; only the plan, the diff, and the repo. The worker's impl
notes are the one
deliberate exception: they ship with the diff so the reviewer sees declared
deviations, assumptions, and accepted gaps. The notes carry decisions, never
review provenance — no round numbers, finding IDs, or fix-status claims — so
a fresh reviewer inherits the decision record, not the previous reviewer's
search map.

**Independent review has a stable exit.** A complete independent review and any
needed focused rechecks can satisfy the gate. A new full pass needs material
change, new evidence or an explicit requirement. Required signatures and actual
acceptance cannot be replaced by inline checks or a green build.

**The loop is capped.** Each substantive repair plus recheck counts, including
repeated fixes by the same reviewer. The default is three; changing roles or
models does not reset it. Settled findings cannot re-block without new evidence,
including at a final gate. Remaining P2 notes do not cause another loop; real
unresolved blockers mean unfinished work, not success at the cap.

**One loop covers one repo.** The loop's base/head and diff bookkeeping
spans a single repo, so changes outside it would escape review. When a
plan's slices span multiple repos, the orchestrator declares the repo split
up front, runs one loop per repo, and reports every uncovered repo as a
blocking known gap — a single-repo exit is never presented as plan
completion.

**Plans are right-sized decision artifacts.** `/cvg-plan` classifies
complexity first (brief / standard / full); only cross-cutting work gets the
full surfaces + invariant-matrix treatment. Plans never contain code. Open
behavior decisions that bind multiple slices go into a behavior contract
rather than being invented downstream.

**The loop asks for material decisions.** The
build loop starts only when you explicitly trigger it on a reviewed plan —
this gate is where your judgment counts most: check that the behavior
contract records decisions you actually want, that each slice's "done when"
is verifiable, and that the invariant matrix covers every surface you know
about. Mid-loop, source-backed omissions return to the planner; only a missing product
choice, new risk or broader authorization needs you. If the cap is reached with
real blockers, the report names what remains and the smallest next step.

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
-> /cvg-plan-loop        planner <-> independent review and focused rechecks
-> human reviews and questions the plan
-> /cvg-build-loop       worker <-> independent review and focused rechecks
-> required QA gates, if any
-> done
```

The loop skills share one protocol (`cvg-multi-session`), bound to the host
platform before anything else runs: Codex specialists are native Desktop tasks;
Claude Code specialists are background agents. Each platform's build ships only
its own transport mechanics — the copies under `plugins/codex` and
`plugins/claude` are generated from one canonical source. Specialist identity
always comes from the platform response, never from the specialist's own prose.
Repair rounds reuse the same worker, focused re-reviews reuse the same reviewer,
and only a full fresh review creates a new task.

Codex repository specialists use Desktop `create_thread` with a native project
worktree. Repairs and focused checks use `send_message_to_thread` on the same
task; `wait_threads` and heartbeat handoffs monitor completion. A callback is
both sent to the orchestrator task and retained as the specialist's final answer
for recovery. Convergo does not start a standalone App Server or introduce a
second task writer.

Full Access is intentionally broad local authority. The release smoke verifies
that native project-worktree creation and same-task continuation both retain
`approval_policy=never` and `sandbox_policy.type=danger-full-access` without an
approval prompt. Run orchestrated Codex loops only in trusted worktrees. Review
gates and role boundaries remain contractual rather than sandbox boundaries.

On Claude Code there is a third option: the same loops with a split-engine
routing — see [Hybrid Loops](#hybrid-loops-fable-plans-codex-builds).

## Hybrid Loops: Fable Plans, Codex Builds

*(Claude Code only.)* The loop protocol doesn't care which model plays which
role — the two hybrid presets pin a deliberate split that matches today's
model economics: **Claude Fable** has the best taste and judgment but scarce
quota; **GPT-5.6 Sol through the Codex CLI at high reasoning effort** is nearly
as capable at execution and effectively free at typical subscription limits.
So the presets spend Fable only where judgment has leverage, and let Codex
burn every iteration. These are defaults, not hardcoded — any invocation can
override either engine.

| Role | Engine | Why |
| --- | --- | --- |
| Planner, plan revisions | Fable | direction-setting is where taste pays most |
| Plan reviewers | Codex (gpt-5.6-sol high) | completeness-vs-codebase checking is execution work — and cross-model review exposes blind spots same-model self-review shares |
| Worker, first-pass code reviews, QA | Codex (gpt-5.6-sol high) | all the iteration burn lands here |
| Final independent reviewer | Fable | required signature, including focused rechecks |

**The hybrid split includes a final Fable signature.** A clean Codex review
promotes to an independent Fable review. If Fable finds blockers, the worker
repairs them and the same Fable reviewer performs a focused recheck; a clean
result can satisfy that signature without returning to the Codex tier. A new
full review needs material design or risk changes, new evidence, or an explicit
requirement. Required independent identities must be verified from dispatch
results; optional auxiliary reviews do not become extra exit gates.

**Hybrid Codex CLI specialists use the user's own permissions.** Unlike the
native Codex loop transport above, the Claude-only hybrid wrapper passes no
sandbox or permission flags. Its `codex exec` sessions resolve capabilities
from the user's Codex configuration, and Claude-side agents run under the
user's Claude Code permission settings. The loop's protection is contractual
— review gates, git reversibility, and phase-gated external side effects — and
role boundaries (reviewers do not modify the repo) are contract lines in the
role skills. The relay-wrapper mechanics are regression-tested by the
[wrapper-behavior evals](evals/wrapper-behavior/README.md).

**Prerequisites.** A working, logged-in `codex` CLI with the convergo codex
plugin installed on that side (codex specialists load role skills by name),
plus Fable access on the Claude side. A missing prerequisite stops the loop
with a blocker instead of silently degrading to one engine.

```text
/cvg-hybrid-plan-loop docs/briefs/topic.md
... review the plan yourself ...
/cvg-hybrid-build-loop docs/plans/topic-plan.md
```

## Skills

| Skill | Purpose | Platforms |
| --- | --- | --- |
| `/cvg-plan` | Read an issue and codebase, then write a sliced plan with an invariant matrix when needed | Claude Code, Codex, generic |
| `/cvg-plan-review` | Review a plan against the actual codebase for missing surfaces, incomplete slices, and wrong invariants | Claude Code, Codex, generic |
| `/cvg-plan-review-feedback` | Classify and handle plan-review blockers inside the planner session | Claude Code, Codex, generic |
| `/cvg-work` | Implement behavior slices with appropriate verification and scope checks | Claude Code, Codex, generic |
| `/cvg-code-review` | Review implementation against the plan and contract, separating code bugs from contract gaps | Claude Code, Codex, generic |
| `/cvg-code-review-feedback` | Classify and handle code-review blockers inside the worker session | Claude Code, Codex, generic |
| `/cvg-plan-loop` | Orchestrate planner -> independent plan review -> repair -> focused recheck | Claude Code, Codex |
| `/cvg-build-loop` | Orchestrate worker -> independent review -> repair -> focused recheck -> acceptance | Claude Code, Codex |
| `/cvg-hybrid-plan-loop` | Plan loop preset: Fable plans, Codex (gpt-5.6-sol high) reviews | Claude Code |
| `/cvg-hybrid-build-loop` | Build loop preset: Codex implements and reviews first, Fable holds the final exit gate | Claude Code |

One more skill, `cvg-multi-session`, ships alongside these: the shared
protocol (transport binding, callbacks, waiting, feedback routing, exit
gates) that the loop skills bind to. It is internal — you never invoke
it directly.

### Auxiliary Personas

`/cvg-plan`, `/cvg-plan-review`, and `/cvg-code-review` fan out to a small
reviewer/researcher set adapted from CE. Every persona is a skill-local prompt
asset under the owning skill's `references/personas/`, dispatched as a generic
subagent — no platform agent registration on any host. Code-review personas
return raw JSON against the shared findings schema
(`cvg-code-review/references/findings-schema.md`).

| Persona | Used by | When |
| --- | --- | --- |
| `best-practices-researcher` | `/cvg-plan` | non-obvious design work |
| `repo-research-analyst` | `/cvg-plan` | bounded codebase uncertainty |
| `correctness-reviewer` | `/cvg-code-review` | complex state or ownership risk |
| `testing-reviewer` | `/cvg-code-review` | uncertain behavioral evidence |
| `security-reviewer` | `/cvg-code-review` | auth, input, permissions, data handling |
| `adversarial-reviewer` | `/cvg-code-review` | severe failure or abuse consequences |
| `reliability-reviewer` | `/cvg-code-review` | error handling, retries, timeouts, jobs |
| `feasibility-reviewer` | `/cvg-plan-review` | uncertain feasibility or dependencies |
| `security-lens-reviewer` | `/cvg-plan-review` | auth, data, external APIs, secrets |
| `scope-guardian-reviewer` | `/cvg-plan-review` | many slices or scope creep |

### Working Artifacts

Convergo leaves a durable paper trail in the repo:

- `docs/plans/<issue-id>-plan.md` — the plan (`<issue-id>` is the issue
  number or a slug); `<issue-id>-contract.md` beside it when a behavior
  contract is warranted
- `docs/impl-notes/<issue-id>.md` — worker decisions, deviations, and flagged
  assumptions the reviewer needs

Per-run review scratch deliberately lives outside the repo — inside the
worktree it would leak earlier rounds' findings to the next fresh reviewer:

- `/tmp/convergo/cvg-code-review/<run-id>/` and
  `/tmp/convergo/cvg-plan-review/<run-id>/` — `review.json` (verdict, merged
  findings, auxiliary coverage) plus one JSON per sub-reviewer. Ephemeral;
  inspect during or right after a run.

## Cost and Fit

**What a loop spends.** A worker and an independent reviewer, with focused
rechecks for repairs. Auxiliaries are risk-selected; further full reviews are
conditional. Cost depends on the work and evidence required, so no fixed token
multiplier is promised. Standalone role skills remain available for bounded
work that does not need orchestration.

**What the loops require.** Orchestration needs real sub-session primitives:
background agents on Claude Code, threads on Codex. If the host cannot
provide them, the skills stop with a tool-layer blocker rather than
role-playing the specialists inline. Generic hosts (Cursor, OpenCode, Pi,
Gemini) get the six base skills only.

**When to use something else.** Quick spikes, throwaway experiments, and
rapid visual UI iteration do not need a bounded review loop. Use the base
planning and review skills selectively, or skip Convergo entirely.

## Install

### Claude Code

```text
/plugin marketplace add gomilesf/convergo
/plugin install convergo
```

Ships all eleven skills. Specialist reviewer and researcher behavior lives
inside the skills as local persona prompts, so the plugin install is
self-contained.
`claude plugin details convergo` shows the component inventory and the
projected token cost per skill.

### Codex App

1. Open **Plugins** from the sidebar, click **Add plugin marketplace**.
2. Source: `gomilesf/convergo`, Git ref: `main`, sparse paths blank.
3. Add the marketplace, select **Convergo**, install **convergo**, then
   restart Codex. The install is self-contained; no extra agent setup step.

Codex installs ship the nine base and loop skills; the two hybrid presets
are Claude Code-only (they need the `Agent` tool's per-role model routing).

### Codex CLI

```bash
codex plugin marketplace add gomilesf/convergo
codex   # inside: /plugins -> Convergo -> install convergo
```

Restart Codex after the install completes. For a non-default profile, run
every step against the same `CODEX_HOME`:

```bash
CODEX_HOME="$HOME/.codex/profiles/work" codex plugin marketplace add gomilesf/convergo
CODEX_HOME="$HOME/.codex/profiles/work" codex
```

Earlier convergo versions installed typed `cvg-*` agents into
`$CODEX_HOME/agents/convergo/`. Current skills no longer use them; remove that
directory (and `$CODEX_HOME/convergo/install-manifest.json`) if present.

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
side and an explicit update on yours. (`convergo-plugin` is the marketplace's
registered name; `convergo` is the plugin inside it.)

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
bun run eval:wrapper   # wrapper-compliance scenarios + per-rule ablation
bun run eval:repin     # codex ground truth: resume drops the -m pin; -c re-pin holds
bun run eval:scoping   # orchestrator cross-repo scoping scenarios
bun run eval:convergence # intent, repair and exit decision fixtures
```

### Source layout and generated builds

`skills-src/` is the single source of skill content. `bun run sync` generates
the platform roots: it strips `<!-- codex -->` / `<!-- claude -->` marker
blocks so each platform build carries only its own transport mechanics, and
it renders the loop skills' `references/cvg-multi-session-protocol.md` copies
from the canonical `skills-src/cvg-multi-session/SKILL.md`. Never edit
generated files by hand; `bun test` byte-checks every platform copy against
the transformed source.

The other static tests guard the contracts that keep the loop sound: the
findings schema ships with every `cvg-code-review` copy, the
stage-calibration block stays identical across skills, and agent prompts
contain no dangling references.

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

### Wrapper-behavior evals

The hybrid loops' codex wrapper pattern is covered by two behavioral eval
layers under `evals/wrapper-behavior/`: wrapper-compliance scenarios against
a stub codex with per-rule ablation, and orchestrator cross-repo scoping
scenarios. Both are manual, cost-bearing runs — see
[evals/wrapper-behavior/README.md](evals/wrapper-behavior/README.md) for
scenarios, baselines, and ablation results.

### End-to-end smoke test

Before releases that touch the loop skills, run the manual gate:
[docs/loop-smoke-test.md](docs/loop-smoke-test.md), a seeded-bug micro
build-loop that exercises spawn, fresh review, feedback-to-same-worker,
focused re-review, and the bounded exit decision on the Claude Code transport.

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

## Repository Layout

```text
skills-src/        Canonical skill sources (with platform marker blocks)
plugins/codex/     Codex plugin root: nine Codex-stripped skills
plugins/claude/    Claude Code plugin root: eleven Claude-stripped skills (adds the hybrid presets)
plugins/generic/   Base-only skill root for generic hosts
evals/             Trigger-routing + wrapper-behavior evals (eval:trigger / eval:wrapper / eval:repin / eval:scoping)
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

## License and Attribution

Convergo is MIT licensed. Portions of the skill and agent prompt content are
adapted from the MIT-licensed
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
plugin. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">
<sub>README art is AI-generated — prompts and style system in <a href="docs/assets/art-prompts.md">docs/assets/art-prompts.md</a>.</sub>
</div>
