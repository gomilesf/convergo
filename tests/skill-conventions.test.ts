import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { PLATFORM_SKILL_ROOTS } from "../src/metadata"

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

  test("loop protocol references preserve canonical multi-session gates", () => {
    const canonical = contentAfterMarker(
      readFileSync(path.join(ROOT, PLATFORM_SKILL_ROOTS.source, "multi-session", "SKILL.md"), "utf8"),
      "## Non-Negotiable Protocol Gates",
    )

    for (const relativePath of [
      path.join(PLATFORM_SKILL_ROOTS.source, "plan-loop", "references", "multi-session-protocol.md"),
      path.join(PLATFORM_SKILL_ROOTS.source, "build-loop", "references", "multi-session-protocol.md"),
      path.join(PLATFORM_SKILL_ROOTS.codex, "plan-loop", "references", "multi-session-protocol.md"),
      path.join(PLATFORM_SKILL_ROOTS.codex, "build-loop", "references", "multi-session-protocol.md"),
    ]) {
      const content = readFileSync(path.join(ROOT, relativePath), "utf8")

      expect(contentAfterMarker(content, "## Non-Negotiable Protocol Gates"), relativePath).toBe(canonical)
    }
  })
})
