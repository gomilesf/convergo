# Compound Converge Productization

## Goal

Package Compound Converge as a public coding-agent plugin while keeping Codex-only orchestration skills out of non-Codex installs.

## Reference Model

The reference implementation in `compound-engineering-plugin` uses a root-native distribution shape:

```text
repo root
|-- skills/             runtime skills
|-- .claude-plugin/     Claude Code plugin and marketplace metadata
|-- .codex-plugin/      Codex native plugin manifest
|-- .agents/plugins/    Codex custom marketplace descriptor
|-- .cursor-plugin/     Cursor plugin metadata
|-- .opencode/          OpenCode package entrypoint
|-- .pi/                Pi extension entrypoint
|-- src/                development and validation code
|-- scripts/            text-interface wrappers
|-- tests/              regression checks
`-- docs/               specs, plans, and solution notes
```

That root-native shape works when every platform should receive the same skills. Compound Converge has a different constraint: `cvg-plan-loop`, `cvg-build-loop`, and `cvg-multi-session` depend on Codex thread tools, callback transport, heartbeat handoff, and fresh-reviewer gates. They must not be exposed as Claude, Cursor, OpenCode, Pi, or Gemini skills.

## Target Architecture

Compound Converge therefore keeps one repository but uses separate platform plugin roots:

```text
compound-converge
|-- skills-src/
|   |-- cvg-plan/
|   |-- cvg-plan-review/
|   |-- cvg-plan-review-feedback/
|   |-- cvg-work/
|   |-- cvg-code-review/
|   |-- cvg-code-review-feedback/
|   |-- cvg-plan-loop/
|   |-- cvg-build-loop/
|   `-- cvg-multi-session/
|-- agents-src/
|   |-- claude/          auxiliary agents as Claude agent markdown
|   `-- codex/           auxiliary agents as Codex TOML
|-- plugins/
|   |-- codex/
|   |   |-- .codex-plugin/plugin.json
|   |   |-- .codex/agents/compound-converge/
|   |   `-- skills/        all nine skills
|   |-- claude/
|   |   |-- .claude-plugin/plugin.json
|   |   |-- agents/        auxiliary Claude agents
|   |   `-- skills/        six base skills
|   `-- generic/
|       |-- .cursor-plugin/plugin.json
|       `-- skills/        six base skills
|-- .claude-plugin/         marketplace descriptor
|-- .agents/plugins/        Codex marketplace descriptor
|-- .cursor-plugin/         Cursor marketplace descriptor
|-- .opencode/
|-- .pi/
|-- src/
|-- scripts/
|-- tests/
`-- docs/
```

## Key Decisions

### Platform roots enforce product boundaries

Native plugin loaders discover skills from a plugin root. Compound Converge uses different plugin roots so each host receives only the skills it can run:

- Claude Code marketplace source points at `./plugins/claude`, which contains only base skills.
- Codex marketplace source points at `./plugins/codex`, whose `.codex-plugin/plugin.json` points at `./skills/` and exposes all nine skills.
- Cursor, OpenCode, Pi, and Gemini-facing surfaces use the base-only generated skills under `./plugins/generic/skills`.

### Auxiliary agents are vendored as a minimal closure

The base DD-derived skills dispatch a small set of Compound Engineering auxiliary agents. Compound Converge vendors only the platform agents directly referenced by its public skills:

```text
cvg-best-practices-researcher
cvg-repo-research-analyst
cvg-correctness-reviewer
cvg-testing-reviewer
cvg-security-reviewer
cvg-adversarial-reviewer
cvg-reliability-reviewer
```

Claude Code receives these under `plugins/claude/agents/*.agent.md`. Codex keeps the equivalent TOML agents under `plugins/codex/.codex/agents/compound-converge/*.toml`, and `bun run install:codex-agents` installs them into the active Codex root at `agents/compound-converge/*.toml` with `compound-converge/install-manifest.json`. Generic hosts still receive the base skills; when auxiliary delegation is unavailable, the skills instruct the active agent to perform the same checks itself.

Plan-review personas are vendored differently: `cvg-plan-review` reads
skill-local prompt assets from `references/personas/` and dispatches generic
subagents when available. This keeps feasibility, security-lens, and
scope-guardian review self-contained without depending on platform-level custom
agent registration.

### Generated skill roots are committed

`skills-src/` and `agents-src/` are the canonical source trees. `scripts/sync-platform-skills.ts` generates the platform roots:

```bash
bun run sync
```

The generated roots are committed because users install directly from GitHub and should not need to run a build step before plugin discovery.

### Text interface for verification

`scripts/validate.ts` is the text interface for productization checks. It verifies platform metadata, repository identity, marketplace sources, Codex's native skills path, and platform skill surfaces:

```text
skills-src/               9 skills
agents-src/claude         10 agents
agents-src/codex          10 agents
plugins/codex/skills      9 skills
plugins/codex/.codex      10 agents
plugins/claude/skills     6 skills
plugins/claude/agents     10 agents
plugins/generic/skills    6 skills
```

### Self-contained skills

Marketplace installs use versioned cache directories. A skill cannot rely on sibling skill paths such as `../cvg-multi-session/SKILL.md`. When loop skills need the cvg-multi-session protocol, they carry a skill-local copy under `references/cvg-multi-session-protocol.md`.

## Verification

Use these checks after changing product surfaces:

```bash
bun run sync
bun run validate
tmpdir=$(mktemp -d -t compound-converge-agents-XXXXXX)
bun run install:codex-agents -- --codex-home "$tmpdir"
test -f "$tmpdir/agents/compound-converge/cvg-correctness-reviewer.toml"
rm -rf "$tmpdir"
bun test
bun run plugin:validate
```

For Codex, use a temporary profile to verify that the custom marketplace descriptor is accepted without changing the user's real Codex config:

```bash
tmpdir=$(mktemp -d -t compound-converge-codex-XXXXXX)
CODEX_HOME="$tmpdir" codex plugin marketplace add "$PWD" --json
CODEX_HOME="$tmpdir" codex plugin marketplace list --json
rm -rf "$tmpdir"
```

Current Codex CLI builds can register a local marketplace through this path while still requiring the Codex app or `/plugins` TUI for the actual plugin installation flow.
