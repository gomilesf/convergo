import { promises as fs } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()

const BASE_SKILLS = ["cvg-plan", "cvg-plan-review", "cvg-plan-review-feedback", "cvg-work", "cvg-code-review", "cvg-code-review-feedback"].sort()
const CODEX_ONLY_SKILLS = ["cvg-plan-loop", "cvg-build-loop", "cvg-multi-session"].sort()
const CODEX_SKILLS = [...BASE_SKILLS, ...CODEX_ONLY_SKILLS].sort()
const AUXILIARY_AGENT_NAMES = [
  "cvg-adversarial-reviewer",
  "cvg-best-practices-researcher",
  "cvg-correctness-reviewer",
  "cvg-reliability-reviewer",
  "cvg-repo-research-analyst",
  "cvg-security-reviewer",
  "cvg-testing-reviewer",
].sort()

const PLATFORMS = [
  {
    name: "codex",
    skills: CODEX_SKILLS,
    target: "plugins/codex/skills",
  },
  {
    name: "claude",
    skills: BASE_SKILLS,
    target: "plugins/claude/skills",
  },
  {
    name: "generic",
    skills: BASE_SKILLS,
    target: "plugins/generic/skills",
  },
] as const

const AGENT_TARGETS = [
  {
    name: "claude",
    extension: ".agent.md",
    source: "agents-src/claude",
    target: "plugins/claude/agents",
  },
  {
    name: "codex",
    extension: ".toml",
    source: "agents-src/codex",
    target: "plugins/codex/.codex/agents/compound-converge",
  },
] as const

async function assertSourceSkill(skill: string): Promise<void> {
  const skillPath = path.join(ROOT, "skills-src", skill, "SKILL.md")
  const stat = await fs.stat(skillPath).catch(() => undefined)
  if (!stat?.isFile()) {
    throw new Error(`Missing source skill: skills-src/${skill}/SKILL.md`)
  }
}

async function copySkill(skill: string, targetRoot: string): Promise<void> {
  await assertSourceSkill(skill)
  await fs.cp(path.join(ROOT, "skills-src", skill), path.join(ROOT, targetRoot, skill), {
    recursive: true,
  })
}

async function copyAgent(agentName: string, extension: string, sourceRoot: string, targetRoot: string): Promise<void> {
  const sourcePath = path.join(ROOT, sourceRoot, `${agentName}${extension}`)
  const stat = await fs.stat(sourcePath).catch(() => undefined)
  if (!stat?.isFile()) {
    throw new Error(`Missing source agent: ${sourceRoot}/${agentName}${extension}`)
  }

  await fs.copyFile(sourcePath, path.join(ROOT, targetRoot, `${agentName}${extension}`))
}

for (const platform of PLATFORMS) {
  const targetRoot = path.join(ROOT, platform.target)
  await fs.rm(targetRoot, { recursive: true, force: true })
  await fs.mkdir(targetRoot, { recursive: true })

  for (const skill of platform.skills) {
    await copySkill(skill, platform.target)
  }

  console.log(`${platform.name}: synced ${platform.skills.length} skills to ${platform.target}`)
}

for (const target of AGENT_TARGETS) {
  const targetRoot = path.join(ROOT, target.target)
  await fs.rm(targetRoot, { recursive: true, force: true })
  await fs.mkdir(targetRoot, { recursive: true })

  for (const agentName of AUXILIARY_AGENT_NAMES) {
    await copyAgent(agentName, target.extension, target.source, target.target)
  }

  console.log(`${target.name}: synced ${AUXILIARY_AGENT_NAMES.length} agents to ${target.target}`)
}
