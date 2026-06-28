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

      expect(skillContent).toContain("/tmp/compound-converge/cvg-plan-review/$RUN_ID")
      expect(skillContent).toContain("/tmp/compound-converge/cvg-plan-review/<run-id>/<reviewer-name>.json")
      expect(skillContent).toContain("The returned response must be one raw JSON object only")
      expect(skillContent).toContain("/tmp/compound-converge/cvg-plan-review/<run-id>/review.json")
      expect(skillContent).toContain("/tmp/compound-converge/cvg-plan-review/<run-id>/metadata.json")
      expect(skillContent).toContain("Main reviewer must not consult project memory, prior sessions, rollout summaries, or external history.")
      expect(skillContent).toContain("Do not consult project memory, prior sessions, rollout summaries, or external history.")
      expect(skillContent).toContain("Do not cite memory or include memory citations.")
      expect(skillContent).toContain("Auxiliary coverage must be an object keyed by reviewer name")
      expect(skillContent).toContain("Do not collapse selected reviewers to plain status strings")
      expect(skillContent).toContain('"agent_role": "generic-subagent"')
      expect(skillContent).toContain('"agent_id": "<subagent id, child session id, or null>"')
      expect(skillContent).toContain('"thread_id": "<child thread/session id when exposed, or null>"')
      expect(skillContent).toContain('"artifact_written": true')

      for (const persona of ["feasibility-reviewer", "security-lens-reviewer", "scope-guardian-reviewer"]) {
        const personaContent = readFileSync(
          path.join(planReviewDir, "references", "personas", `${persona}.md`),
          "utf8",
        )

        expect(
          personaContent.trim().length,
          `${relativeRoot}/${persona}`,
        ).toBeGreaterThan(0)
        expect(personaContent, `${relativeRoot}/${persona}`).toContain("raw JSON output contract")
        expect(skillContent, `${relativeRoot}/${persona}`).toContain(`references/personas/<reviewer-name>.md`)
      }

      expect(skillContent).not.toContain("cvg-feasibility-reviewer")
      expect(skillContent).not.toContain("cvg-security-lens-reviewer")
      expect(skillContent).not.toContain("cvg-scope-guardian-reviewer")
      expect(skillContent).toContain("Do not use typed agent names")
    }
  })

  test("code review auxiliary reviewers keep raw JSON output boundaries", () => {
    for (const relativeRoot of SKILL_ROOTS) {
      const skillContent = readFileSync(path.join(ROOT, relativeRoot, "cvg-code-review", "SKILL.md"), "utf8")

      expect(skillContent).toContain("Also include this output contract verbatim")
      expect(skillContent).toContain("Main reviewer must not consult project memory, prior sessions, rollout summaries, or external history.")
      expect(skillContent).toContain("Do not cite memory or include memory citations.")
      expect(skillContent).toContain("Do not consult project memory, prior sessions, rollout summaries, or")
      expect(skillContent).toContain("/tmp/compound-converge/cvg-code-review/$RUN_ID")
      expect(skillContent).toContain("/tmp/compound-converge/cvg-code-review/<run-id>/<reviewer-name>.json")
      expect(skillContent).toContain("/tmp/compound-converge/cvg-code-review/<run-id>/review.json")
      expect(skillContent).toContain("/tmp/compound-converge/cvg-code-review/<run-id>/metadata.json")
      expect(skillContent).toContain("Return exactly one raw JSON object matching the findings")
      expect(skillContent).toContain("treat that auxiliary result as failed")
      expect(skillContent).toContain("Auxiliary coverage must be an object keyed by reviewer name")
      expect(skillContent).toContain("Do not collapse selected reviewers to plain status strings")
      expect(skillContent).toContain("Final fresh exit mode")
      expect(skillContent).toContain("inline auxiliary coverage cannot produce a final exit pass")
      expect(skillContent).toContain("degraded auxiliary coverage")
      expect(skillContent).toContain("Skip this step for `Review mode: focused-re-review`")
      expect(skillContent).toContain("Do not write inline auxiliary reviewer artifacts")
      expect(skillContent).toContain('"agent_role": "<requested agent_type, for example cvg-security-reviewer>"')
      expect(skillContent).toContain('"agent_id": "<spawn_agent id, child session id, or null>"')
      expect(skillContent).toContain('"thread_id": "<child thread/session id when exposed, or null>"')
      expect(skillContent).toContain('"artifact_written": true')
    }

    const reviewerAgents = AUXILIARY_AGENT_NAMES.filter((name) => name.endsWith("-reviewer"))
    const agentRoots = [
      { extension: ".agent.md", root: "agents-src/claude" },
      { extension: ".toml", root: "agents-src/codex" },
      { extension: ".agent.md", root: "plugins/claude/agents" },
      { extension: ".toml", root: "plugins/codex/.codex/agents/compound-converge" },
    ]

    for (const agentRoot of agentRoots) {
      for (const agentName of reviewerAgents) {
        const content = readFileSync(path.join(ROOT, agentRoot.root, `${agentName}${agentRoot.extension}`), "utf8")

        expect(content).toContain("do not consult project memory, prior sessions, rollout summaries, or")
        expect(content).toContain("Return exactly one raw JSON object matching the findings schema")
        expect(content).toContain("memory citations, or any text after the JSON")
      }
    }
  })

  test("build loop fresh reviewer prompts stay independent", () => {
    for (const relativeRoot of [PLATFORM_SKILL_ROOTS.source, PLATFORM_SKILL_ROOTS.codex]) {
      const skillContent = readFileSync(path.join(ROOT, relativeRoot, "cvg-build-loop", "SKILL.md"), "utf8")

      expect(skillContent).toContain("Fresh reviewer prompts must not include a `Relevant review history` narrative")
      expect(skillContent).toContain("Do not consult project memory, prior sessions, rollout summaries, or external history.")
      expect(skillContent).toContain("After verifying the reviewer thread with `read_thread`, send the reviewer its")
      expect(skillContent).toContain("Review mode: focused-re-review")
      expect(skillContent).toContain("Do not ask the focused")
      expect(skillContent).toContain("`Risk areas to inspect independently:`")
      expect(skillContent).toContain("reviewer verdicts, blocker text, focused re-review results")
      expect(skillContent).toContain("Review mode: final-fresh-exit")
      expect(skillContent).toContain("inline auxiliary coverage cannot satisfy the final implementation exit condition")
      expect(skillContent).not.toContain("not exposed")
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
      "Your verified Codex thread id is <specialist-thread-id>",
      "Do not use multi-agent subagents, task agents, context-fork agents, local shell jobs, or background processes as substitutes.",
      "If `read_thread` cannot read the id, stop the workflow and retry with Codex thread tools or report a tool-layer blocker.",
      "The specialist must send its callback to the orchestrator thread.",
      "If the specialist creates or receives an audit artifact, the callback must include `Audit artifact: <absolute path>`.",
      "Destination orchestrator Codex thread id: <orchestrator-thread-id>",
      "Do not emulate a heartbeat with `sleep`, repeated `read_thread`, shell loops, timers, or repeated status checks in the same assistant turn.",
      "do not replace the missing heartbeat with manual polling.",
      "Same-reviewer pass is never the final exit condition.",
      "inline auxiliary coverage cannot satisfy the final fresh-reviewer exit condition.",
      "Plan-review blockers return to the planner with the `cvg-plan-review-feedback` skill.",
      "Code-review blockers return to the worker with the `cvg-code-review-feedback` skill.",
    ]) {
      expect(canonical).toContain(requiredText)
    }

    expect(canonical).not.toContain("not exposed")
  })
})
