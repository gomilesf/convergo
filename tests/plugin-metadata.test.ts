import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import {
  AUXILIARY_AGENT_NAMES,
  BASE_SKILLS,
  CLAUDE_SKILLS,
  CODEX_SKILLS,
  PLATFORM_AGENT_ROOTS,
  PLATFORM_SKILL_ROOTS,
  validateProductization,
} from "../src/metadata"
import {
  PROTOCOL_CONSUMER_SKILLS,
  renderProtocolReference,
  stripPlatform,
  type Platform,
} from "../src/platform-content"

const ROOT = process.cwd()
const PLUGIN_NAME = "convergo"
const EXPECTED_VERSION = "0.2.3"
const EXPECTED_REPOSITORY = "https://github.com/gomilesf/convergo"

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8")) as T
}

function listSkillDirs(relativeRoot: string): string[] {
  return readdirSync(path.join(ROOT, relativeRoot), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(ROOT, relativeRoot, name, "SKILL.md")))
    .sort()
}

function listAgentNames(relativeRoot: string, extension: ".agent.md" | ".toml"): string[] {
  return readdirSync(path.join(ROOT, relativeRoot), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length))
    .sort()
}

function listFiles(relativeRoot: string): string[] {
  const rootPath = path.join(ROOT, relativeRoot)
  const files: string[] = []

  function walk(currentPath: string): void {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
      } else if (entry.isFile()) {
        files.push(path.relative(rootPath, entryPath))
      }
    }
  }

  walk(rootPath)
  return files.sort()
}

const PROTOCOL_REFERENCE_FILE = path.join("references", "cvg-multi-session-protocol.md")

function expectSkillCopyMatchesSource(skillName: string, targetRoot: string, platform?: Platform): void {
  const sourceRoot = path.join(PLATFORM_SKILL_ROOTS.source, skillName)
  const targetSkillRoot = path.join(targetRoot, skillName)
  const sourceFiles = listFiles(sourceRoot)
  const generatesProtocolReference =
    platform !== undefined && (PROTOCOL_CONSUMER_SKILLS as readonly string[]).includes(skillName)
  const expectedFiles = generatesProtocolReference ? [...sourceFiles, PROTOCOL_REFERENCE_FILE].sort() : sourceFiles

  expect(listFiles(targetSkillRoot), targetSkillRoot).toEqual(expectedFiles)
  for (const file of sourceFiles) {
    const sourceContent = readFileSync(path.join(ROOT, sourceRoot, file), "utf8")
    const targetContent = readFileSync(path.join(ROOT, targetSkillRoot, file), "utf8")
    const expected =
      platform !== undefined && file.endsWith(".md") ? stripPlatform(sourceContent, platform) : sourceContent
    expect(targetContent, `${targetSkillRoot}/${file}`).toBe(expected)
  }

  if (generatesProtocolReference) {
    const canonical = readFileSync(
      path.join(ROOT, PLATFORM_SKILL_ROOTS.source, "cvg-multi-session", "SKILL.md"),
      "utf8",
    )
    const targetContent = readFileSync(path.join(ROOT, targetSkillRoot, PROTOCOL_REFERENCE_FILE), "utf8")
    expect(targetContent, `${targetSkillRoot}/${PROTOCOL_REFERENCE_FILE}`).toBe(
      stripPlatform(renderProtocolReference(canonical, skillName), platform!),
    )
  }
}

function expectAgentCopiesMatchSource(
  sourceRoot: string,
  targetRoot: string,
  extension: ".agent.md" | ".toml",
): void {
  expect(listAgentNames(sourceRoot, extension), sourceRoot).toEqual(AUXILIARY_AGENT_NAMES)
  expect(listAgentNames(targetRoot, extension), targetRoot).toEqual(AUXILIARY_AGENT_NAMES)

  for (const agentName of AUXILIARY_AGENT_NAMES) {
    const fileName = `${agentName}${extension}`
    const sourceContent = readFileSync(path.join(ROOT, sourceRoot, fileName), "utf8")
    const targetContent = readFileSync(path.join(ROOT, targetRoot, fileName), "utf8")
    expect(targetContent, `${targetRoot}/${fileName}`).toBe(sourceContent)
  }
}

describe("plugin metadata", () => {
  test("ships the expected package and platform metadata files", () => {
    for (const relativePath of [
      "package.json",
      ".claude-plugin/marketplace.json",
      ".agents/plugins/marketplace.json",
      ".cursor-plugin/marketplace.json",
      "plugins/claude/.claude-plugin/plugin.json",
      "plugins/codex/.codex-plugin/plugin.json",
      "plugins/generic/.cursor-plugin/plugin.json",
      "scripts/install-codex-agents.ts",
      "agents-src/claude",
      "agents-src/codex",
      "plugins/claude/agents",
      "plugins/codex/.codex/agents/convergo",
      "gemini-extension.json",
      ".opencode/plugins/convergo.js",
      ".pi/extensions/convergo.ts",
    ]) {
      expect(existsSync(path.join(ROOT, relativePath)), relativePath).toBe(true)
    }
  })

  test("keeps package and plugin manifest identity in sync", () => {
    const packageJson = readJson<{
      name: string
      version: string
      repository: string
      main: string
      scripts: Record<string, string>
      pi: { extensions: string[]; skills: string[] }
    }>("package.json")
    const claudePlugin = readJson<{ name: string; version: string; repository: string }>(
      "plugins/claude/.claude-plugin/plugin.json",
    )
    const codexPlugin = readJson<{
      name: string
      version: string
      repository: string
      skills: string
    }>("plugins/codex/.codex-plugin/plugin.json")
    const geminiExtension = readJson<{ name: string; version: string }>("gemini-extension.json")
    const cursorPlugin = readJson<{ name: string; version: string; repository: string }>(
      "plugins/generic/.cursor-plugin/plugin.json",
    )

    expect(packageJson.name).toBe(PLUGIN_NAME)
    expect(packageJson.version).toBe(EXPECTED_VERSION)
    expect(packageJson.repository).toBe(EXPECTED_REPOSITORY)
    expect(packageJson.main).toBe(".opencode/plugins/convergo.js")
    expect(packageJson.scripts["install:codex-agents"]).toBe("bun run scripts/install-codex-agents.ts")
    expect(packageJson.pi.extensions).toEqual(["./.pi/extensions/convergo.ts"])
    expect(packageJson.pi.skills).toEqual(["./plugins/generic/skills"])

    expect(claudePlugin).toMatchObject({
      name: PLUGIN_NAME,
      version: EXPECTED_VERSION,
      repository: EXPECTED_REPOSITORY,
    })
    expect(codexPlugin).toMatchObject({
      name: PLUGIN_NAME,
      version: EXPECTED_VERSION,
      repository: EXPECTED_REPOSITORY,
      skills: "./skills/",
    })
    expect(cursorPlugin).toMatchObject({
      name: PLUGIN_NAME,
      version: EXPECTED_VERSION,
      repository: EXPECTED_REPOSITORY,
    })
    expect(geminiExtension).toMatchObject({
      name: PLUGIN_NAME,
      version: EXPECTED_VERSION,
    })
  })

  test("declares isolated skill surfaces per platform", () => {
    const codexPlugin = readJson<{ skills: string }>("plugins/codex/.codex-plugin/plugin.json")
    const skillsPath = path.resolve(ROOT, "plugins/codex", codexPlugin.skills)

    expect(statSync(skillsPath).isDirectory()).toBe(true)
    expect(listSkillDirs(PLATFORM_SKILL_ROOTS.source)).toEqual(CODEX_SKILLS)
    expect(listSkillDirs(PLATFORM_SKILL_ROOTS.codex)).toEqual(CODEX_SKILLS)
    expect(listSkillDirs(PLATFORM_SKILL_ROOTS.claude)).toEqual(CLAUDE_SKILLS)
    expect(listSkillDirs(PLATFORM_SKILL_ROOTS.generic)).toEqual(BASE_SKILLS)
    expect(existsSync(path.join(ROOT, "skills"))).toBe(false)
  })

  test("declares auxiliary agent surfaces for supported agent hosts", () => {
    expect(listAgentNames(PLATFORM_AGENT_ROOTS.sourceClaude, ".agent.md")).toEqual(AUXILIARY_AGENT_NAMES)
    expect(listAgentNames(PLATFORM_AGENT_ROOTS.sourceCodex, ".toml")).toEqual(AUXILIARY_AGENT_NAMES)
    expect(listAgentNames(PLATFORM_AGENT_ROOTS.claude, ".agent.md")).toEqual(AUXILIARY_AGENT_NAMES)
    expect(listAgentNames(PLATFORM_AGENT_ROOTS.codex, ".toml")).toEqual(AUXILIARY_AGENT_NAMES)
  })

  test("keeps generated skill copies in sync with source skills", () => {
    for (const skillName of CODEX_SKILLS) {
      expectSkillCopyMatchesSource(skillName, PLATFORM_SKILL_ROOTS.codex, "codex")
    }
    for (const skillName of CLAUDE_SKILLS) {
      expectSkillCopyMatchesSource(skillName, PLATFORM_SKILL_ROOTS.claude, "claude")
    }
    for (const skillName of BASE_SKILLS) {
      expectSkillCopyMatchesSource(skillName, PLATFORM_SKILL_ROOTS.generic)
    }
  })

  test("keeps generated agent copies in sync with source agents", () => {
    expectAgentCopiesMatchSource(PLATFORM_AGENT_ROOTS.sourceClaude, PLATFORM_AGENT_ROOTS.claude, ".agent.md")
    expectAgentCopiesMatchSource(PLATFORM_AGENT_ROOTS.sourceCodex, PLATFORM_AGENT_ROOTS.codex, ".toml")
  })

  test("keeps marketplace plugin lists and platform sources aligned", () => {
    const claudeMarketplace = readJson<{ plugins: Array<{ name: string; source: string }> }>(
      ".claude-plugin/marketplace.json",
    )
    const codexMarketplace = readJson<{ plugins: Array<{ name: string; source: { path: string } }> }>(
      ".agents/plugins/marketplace.json",
    )
    const cursorMarketplace = readJson<{ plugins: Array<{ name: string; source: string }> }>(
      ".cursor-plugin/marketplace.json",
    )

    expect(claudeMarketplace.plugins.map((plugin) => plugin.name).sort()).toEqual([PLUGIN_NAME])
    expect(codexMarketplace.plugins.map((plugin) => plugin.name).sort()).toEqual([PLUGIN_NAME])
    expect(cursorMarketplace.plugins.map((plugin) => plugin.name).sort()).toEqual([PLUGIN_NAME])
    expect(claudeMarketplace.plugins[0].source).toBe("./plugins/claude")
    expect(codexMarketplace.plugins[0].source.path).toBe("./plugins/codex")
    expect(cursorMarketplace.plugins[0].source).toBe("./plugins/generic")
  })

  test("passes the productization validator", async () => {
    const result = await validateProductization(ROOT)

    expect(result.errors).toEqual([])
  })
})
