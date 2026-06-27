import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { AUXILIARY_AGENT_NAMES, PLATFORM_SKILL_ROOTS } from "../src/metadata"

const ROOT = process.cwd()
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/
const SKILL_ROOTS = [
  PLATFORM_SKILL_ROOTS.source,
  PLATFORM_SKILL_ROOTS.codex,
  PLATFORM_SKILL_ROOTS.claude,
  PLATFORM_SKILL_ROOTS.generic,
] as const

type Skill = {
  name: string
  dir: string
  path: string
  content: string
}

function listSkills(): Skill[] {
  return SKILL_ROOTS.flatMap((relativeRoot) => {
    const skillsRoot = path.join(ROOT, relativeRoot)
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillPath = path.join(skillsRoot, entry.name, "SKILL.md")
        return {
          name: entry.name,
          dir: path.dirname(skillPath),
          path: skillPath,
          content: readFileSync(skillPath, "utf8"),
        }
      })
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(FRONTMATTER_RE)
  expect(match, "SKILL.md must start with YAML frontmatter").not.toBeNull()
  const out: Record<string, string> = {}
  for (const line of match![1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) continue
    out[field[1]] = field[2].replace(/^["']|["']$/g, "")
  }
  return out
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length
}

function contentAfterMarker(content: string, marker: string): string {
  const start = content.indexOf(marker)
  expect(start, `missing marker: ${marker}`).toBeGreaterThanOrEqual(0)
  return content.slice(start).trimEnd()
}

function referencedAuxiliaryAgents(): string[] {
  const agentRefs = new Set<string>()
  for (const skill of listSkills()) {
    for (const match of skill.content.matchAll(/`(cvg-[a-z0-9-]+(?:reviewer|researcher|analyst))`/g)) {
      agentRefs.add(match[1])
    }
  }

  return [...agentRefs].sort()
}

describe("skill conventions", () => {
  test("every skill has portable frontmatter", () => {
    for (const skill of listSkills()) {
      const frontmatter = parseFrontmatter(skill.content)

      expect(frontmatter.name, skill.path).toBe(skill.name)
      expect(frontmatter.name, skill.path).toMatch(NAME_RE)
      expect(frontmatter.name.length, skill.path).toBeLessThanOrEqual(64)
      expect(frontmatter.description, skill.path).toBeTruthy()
      expect(frontmatter.description.length, skill.path).toBeLessThanOrEqual(500)
    }
  })

  test("skill markdown does not reference sibling skill files", () => {
    for (const skill of listSkills()) {
      const crossSkillRefs = [...skill.content.matchAll(/`(\.\.\/[^`]+)`/g)]
        .map((match) => ({
          line: lineNumberAt(skill.content, match.index ?? 0),
          ref: match[1],
        }))
        .filter(({ ref }) => ref.includes("/SKILL.md") || ref.includes("/references/"))

      expect(crossSkillRefs, skill.path).toEqual([])
    }
  })

  test("skill markdown is English-only for public distribution", () => {
    for (const skill of listSkills()) {
      expect(skill.content.match(/[一-龥]/g), skill.path).toBeNull()
    }
  })

  test("skill auxiliary agent references are packaged", () => {
    expect(referencedAuxiliaryAgents()).toEqual(AUXILIARY_AGENT_NAMES)
  })

  test("plan review vendors CE-style persona prompt assets", () => {
    for (const relativeRoot of SKILL_ROOTS) {
      const planReviewDir = path.join(ROOT, relativeRoot, "cvg-plan-review")
      const skillContent = readFileSync(path.join(planReviewDir, "SKILL.md"), "utf8")

      for (const persona of ["feasibility-reviewer", "security-lens-reviewer", "scope-guardian-reviewer"]) {
        expect(
          readFileSync(path.join(planReviewDir, "references", "personas", `${persona}.md`), "utf8").trim().length,
          `${relativeRoot}/${persona}`,
        ).toBeGreaterThan(0)
        expect(skillContent, `${relativeRoot}/${persona}`).toContain(`references/personas/<reviewer-name>.md`)
      }

      expect(skillContent).not.toContain("cvg-feasibility-reviewer")
      expect(skillContent).not.toContain("cvg-security-lens-reviewer")
      expect(skillContent).not.toContain("cvg-scope-guardian-reviewer")
      expect(skillContent).toContain("Do not use typed agent names")
    }
  })

  test("loop protocol references preserve canonical cvg-multi-session gates", () => {
    const canonical = contentAfterMarker(
      readFileSync(path.join(ROOT, PLATFORM_SKILL_ROOTS.source, "cvg-multi-session", "SKILL.md"), "utf8"),
      "## Non-Negotiable Protocol Gates",
    )

    for (const relativePath of [
      path.join(PLATFORM_SKILL_ROOTS.source, "cvg-plan-loop", "references", "cvg-multi-session-protocol.md"),
      path.join(PLATFORM_SKILL_ROOTS.source, "cvg-build-loop", "references", "cvg-multi-session-protocol.md"),
      path.join(PLATFORM_SKILL_ROOTS.codex, "cvg-plan-loop", "references", "cvg-multi-session-protocol.md"),
      path.join(PLATFORM_SKILL_ROOTS.codex, "cvg-build-loop", "references", "cvg-multi-session-protocol.md"),
    ]) {
      const content = readFileSync(path.join(ROOT, relativePath), "utf8")

      expect(contentAfterMarker(content, "## Non-Negotiable Protocol Gates"), relativePath).toBe(canonical)
    }
  })

  test("canonical cvg-multi-session protocol preserves hard orchestration gates", () => {
    const canonical = contentAfterMarker(
      readFileSync(path.join(ROOT, PLATFORM_SKILL_ROOTS.source, "cvg-multi-session", "SKILL.md"), "utf8"),
      "## Non-Negotiable Protocol Gates",
    )

    for (const requiredText of [
      "Use `create_thread` to create a new specialist thread unless the user explicitly named an existing Codex thread.",
      "Use `send_message_to_thread` to continue an existing specialist thread.",
      "Use `read_thread` to verify every specialist thread id immediately after creation or selection.",
      "Do not use multi-agent subagents, task agents, context-fork agents, local shell jobs, or background processes as substitutes.",
      "If `read_thread` cannot read the id, stop the workflow and retry with Codex thread tools or report a tool-layer blocker.",
      "The specialist must send its callback to the orchestrator thread.",
      "Destination orchestrator Codex thread id: <orchestrator-thread-id>",
      "Do not emulate a heartbeat with `sleep`, repeated `read_thread`, shell loops, timers, or repeated status checks in the same assistant turn.",
      "do not replace the missing heartbeat with manual polling.",
      "Same-reviewer pass is never the final exit condition.",
      "Plan-review blockers return to the planner with the `cvg-plan-review-feedback` skill.",
      "Code-review blockers return to the worker with the `cvg-code-review-feedback` skill.",
    ]) {
      expect(canonical).toContain(requiredText)
    }
  })
})
