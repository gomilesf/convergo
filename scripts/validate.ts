#!/usr/bin/env bun
import {
  AUXILIARY_AGENT_NAMES,
  CLAUDE_SKILLS,
  CODEX_SKILLS,
  PLATFORM_AGENT_ROOTS,
  PLATFORM_SKILL_ROOTS,
  listAgentFiles,
  listSkillDirectories,
  validateProductization,
} from "../src/metadata"

const root = process.cwd()
const result = await validateProductization(root)

if (result.errors.length > 0) {
  console.error("Productization validation failed:")
  for (const error of result.errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

for (const warning of result.warnings) {
  console.warn(`Warning: ${warning}`)
}

const sourceSkills = await listSkillDirectories(root, PLATFORM_SKILL_ROOTS.source)

const readme = await Bun.file(`${root}/README.md`).text()
const badgeCount = readme.match(/badge\/skills-(\d+)-/)?.[1]
if (badgeCount !== String(sourceSkills.length)) {
  console.error(
    `README skills badge says ${badgeCount ?? "nothing"}, but skills-src has ${sourceSkills.length} skills.`,
  )
  process.exit(1)
}

const codexSkills = await listSkillDirectories(root, PLATFORM_SKILL_ROOTS.codex)
const claudeSkills = await listSkillDirectories(root, PLATFORM_SKILL_ROOTS.claude)
const codexAgents = await listAgentFiles(root, PLATFORM_AGENT_ROOTS.codex, ".toml")
const claudeAgents = await listAgentFiles(root, PLATFORM_AGENT_ROOTS.claude, ".agent.md")

console.log(
  [
    "Productization metadata is valid.",
    `source=${sourceSkills.length}/${CODEX_SKILLS.length}`,
    `codex=${codexSkills.length}/${CODEX_SKILLS.length}`,
    `claude=${claudeSkills.length}/${CLAUDE_SKILLS.length}`,
    `codexAgents=${codexAgents.length}/${AUXILIARY_AGENT_NAMES.length}`,
    `claudeAgents=${claudeAgents.length}/${AUXILIARY_AGENT_NAMES.length}`,
  ].join(" "),
)
