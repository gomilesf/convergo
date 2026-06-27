import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

export type ProductizationValidation = {
  errors: string[]
  warnings: string[]
}

type PackageJson = {
  name?: string
  version?: string
  repository?: string
  main?: string
  scripts?: Record<string, string>
  pi?: {
    extensions?: string[]
    skills?: string[]
  }
}

type PluginManifest = {
  name?: string
  version?: string
  description?: string
  repository?: string
  skills?: string
}

type GeminiManifest = {
  name?: string
  version?: string
}

type MarketplaceManifest = {
  plugins?: Array<{
    name?: string
    source?: unknown
  }>
}

const PLUGIN_NAME = "compound-converge"
const CODEX_INSTALL_MANIFEST = "install-manifest.json"
const EXPECTED_REPOSITORY = "https://github.com/gomilesfd/compound-converge"
export const BASE_SKILLS = ["cvg-code-review", "cvg-code-review-feedback", "cvg-plan", "cvg-plan-review", "cvg-plan-review-feedback", "cvg-work"].sort()
export const CODEX_ONLY_SKILLS = ["cvg-build-loop", "cvg-multi-session", "cvg-plan-loop"].sort()
export const CODEX_SKILLS = [...BASE_SKILLS, ...CODEX_ONLY_SKILLS].sort()
export const AUXILIARY_AGENT_NAMES = [
  "cvg-adversarial-reviewer",
  "cvg-best-practices-researcher",
  "cvg-correctness-reviewer",
  "cvg-reliability-reviewer",
  "cvg-repo-research-analyst",
  "cvg-security-reviewer",
  "cvg-testing-reviewer",
].sort()
export const PLATFORM_SKILL_ROOTS = {
  source: "skills-src",
  codex: "plugins/codex/skills",
  claude: "plugins/claude/skills",
  generic: "plugins/generic/skills",
} as const
export const PLATFORM_AGENT_ROOTS = {
  sourceClaude: "agents-src/claude",
  sourceCodex: "agents-src/codex",
  codex: "plugins/codex/.codex/agents/compound-converge",
  claude: "plugins/claude/agents",
} as const

export type CodexAgentInstallOptions = {
  repoRoot?: string
  codexRoot?: string
}

export type CodexAgentInstallResult = {
  codexRoot: string
  agentsRoot: string
  manifestPath: string
  agents: string[]
}

type CodexInstallManifest = {
  version: 1
  pluginName: string
  skills: string[]
  prompts: string[]
  agents: string[]
}

const REQUIRED_FILES = [
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
  "plugins/codex/.codex/agents/compound-converge",
  "gemini-extension.json",
  ".opencode/plugins/compound-converge.js",
  ".pi/extensions/compound-converge.ts",
]

const LEGACY_ROOT_PLUGIN_PATHS = [
  "skills",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
]

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export function resolveCodexRoot(codexRoot?: string): string {
  return path.resolve(codexRoot || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"))
}

export function expectedCodexAgentFiles(): string[] {
  return AUXILIARY_AGENT_NAMES.map((agentName) => `${agentName}.toml`).sort()
}

export async function installCodexAgents(
  options: CodexAgentInstallOptions = {},
): Promise<CodexAgentInstallResult> {
  const repoRoot = options.repoRoot ?? process.cwd()
  const codexRoot = resolveCodexRoot(options.codexRoot)
  const sourceRoot = path.join(repoRoot, PLATFORM_AGENT_ROOTS.codex)
  const agentsRoot = path.join(codexRoot, "agents", PLUGIN_NAME)
  const manifestPath = path.join(codexRoot, PLUGIN_NAME, CODEX_INSTALL_MANIFEST)
  const agents = expectedCodexAgentFiles()

  await fs.mkdir(agentsRoot, { recursive: true })
  await cleanupRemovedCodexAgents(agentsRoot, manifestPath, agents)

  for (const agentFile of agents) {
    await fs.copyFile(path.join(sourceRoot, agentFile), path.join(agentsRoot, agentFile))
  }

  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      version: 1,
      pluginName: PLUGIN_NAME,
      skills: CODEX_SKILLS,
      prompts: [],
      agents,
    } satisfies CodexInstallManifest, null, 2) + "\n",
  )

  return { codexRoot, agentsRoot, manifestPath, agents }
}

async function cleanupRemovedCodexAgents(
  agentsRoot: string,
  manifestPath: string,
  currentAgents: string[],
): Promise<void> {
  const manifest = await readCodexInstallManifest(manifestPath)
  if (!manifest) return

  const current = new Set(currentAgents)
  for (const agentFile of manifest.agents) {
    if (current.has(agentFile) || !isSafeCodexAgentEntry(agentFile)) continue
    await fs.rm(path.join(agentsRoot, agentFile), { force: true })
    await fs.rm(path.join(agentsRoot, path.basename(agentFile, ".toml")), { recursive: true, force: true })
  }
}

async function readCodexInstallManifest(manifestPath: string): Promise<CodexInstallManifest | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Partial<CodexInstallManifest>
    if (
      parsed.version === 1 &&
      parsed.pluginName === PLUGIN_NAME &&
      Array.isArray(parsed.skills) &&
      Array.isArray(parsed.prompts) &&
      Array.isArray(parsed.agents)
    ) {
      return {
        version: 1,
        pluginName: PLUGIN_NAME,
        skills: parsed.skills.filter((entry): entry is string => typeof entry === "string"),
        prompts: parsed.prompts.filter((entry): entry is string => typeof entry === "string"),
        agents: parsed.agents.filter((entry): entry is string => typeof entry === "string"),
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }
  return null
}

function isSafeCodexAgentEntry(agentFile: string): boolean {
  return (
    agentFile.endsWith(".toml") &&
    path.basename(agentFile) === agentFile &&
    !path.isAbsolute(agentFile) &&
    !agentFile.includes("..")
  )
}

async function readJson<T>(
  root: string,
  relativePath: string,
  errors: string[],
): Promise<T | undefined> {
  const fullPath = path.join(root, relativePath)
  try {
    return JSON.parse(await fs.readFile(fullPath, "utf8")) as T
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      errors.push(`${relativePath} is missing`)
      return undefined
    }
    errors.push(`${relativePath} could not be parsed: ${(err as Error).message}`)
    return undefined
  }
}

export async function listSkillDirectories(
  root = process.cwd(),
  relativeRoot = PLATFORM_SKILL_ROOTS.source,
): Promise<string[]> {
  const skillsRoot = path.join(root, relativeRoot)
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  const skillNames: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(skillsRoot, entry.name, "SKILL.md")
    if (await pathExists(skillPath)) skillNames.push(entry.name)
  }

  return skillNames.sort()
}

function validateIdentity(
  errors: string[],
  relativePath: string,
  manifest: PluginManifest | GeminiManifest | PackageJson | undefined,
  expectedVersion: string | undefined,
): void {
  if (!manifest) return
  if (manifest.name !== PLUGIN_NAME) {
    errors.push(`${relativePath}: name must be ${PLUGIN_NAME}`)
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    errors.push(`${relativePath}: version must match package.json (${expectedVersion})`)
  }
  if ("repository" in manifest && manifest.repository !== EXPECTED_REPOSITORY) {
    errors.push(`${relativePath}: repository must be ${EXPECTED_REPOSITORY}`)
  }
}

function pluginNames(manifest: MarketplaceManifest | undefined): string[] {
  return (manifest?.plugins ?? [])
    .map((plugin) => plugin.name)
    .filter((name): name is string => Boolean(name))
    .sort()
}

function sameList(actual: string[] | undefined, expected: string[]): boolean {
  return JSON.stringify(actual ?? []) === JSON.stringify(expected)
}

async function validateSkillSurface(
  root: string,
  errors: string[],
  relativeRoot: string,
  expectedSkills: string[],
): Promise<void> {
  let skills: string[]
  try {
    skills = await listSkillDirectories(root, relativeRoot)
  } catch (err: unknown) {
    errors.push(`${relativeRoot}: could not read skills: ${(err as Error).message}`)
    return
  }

  if (!sameList(skills, expectedSkills)) {
    errors.push(`${relativeRoot}: expected ${expectedSkills.join(", ")}, found ${skills.join(", ")}`)
  }
}

export async function listAgentFiles(
  root: string,
  relativeRoot: string,
  extension: ".agent.md" | ".toml",
): Promise<string[]> {
  const agentRoot = path.join(root, relativeRoot)
  const entries = await fs.readdir(agentRoot, { withFileTypes: true })
  const suffixLength = extension.length
  const agentNames: string[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) continue
    agentNames.push(entry.name.slice(0, -suffixLength))
  }

  return agentNames.sort()
}

async function validateAgentSurface(
  root: string,
  errors: string[],
  relativeRoot: string,
  extension: ".agent.md" | ".toml",
): Promise<void> {
  let agents: string[]
  try {
    agents = await listAgentFiles(root, relativeRoot, extension)
  } catch (err: unknown) {
    errors.push(`${relativeRoot}: could not read agents: ${(err as Error).message}`)
    return
  }

  if (!sameList(agents, AUXILIARY_AGENT_NAMES)) {
    errors.push(`${relativeRoot}: expected ${AUXILIARY_AGENT_NAMES.join(", ")}, found ${agents.join(", ")}`)
  }
}

function marketplaceSourcePath(plugin: MarketplaceManifest["plugins"][number] | undefined): string | undefined {
  const source = plugin?.source
  if (typeof source === "string") return source
  if (source && typeof source === "object" && "path" in source) {
    const pathValue = (source as { path?: unknown }).path
    if (typeof pathValue === "string") return pathValue
  }
  return undefined
}

export async function validateProductization(root = process.cwd()): Promise<ProductizationValidation> {
  const errors: string[] = []
  const warnings: string[] = []

  for (const relativePath of REQUIRED_FILES) {
    if (!(await pathExists(path.join(root, relativePath)))) {
      errors.push(`${relativePath} is missing`)
    }
  }

  for (const relativePath of LEGACY_ROOT_PLUGIN_PATHS) {
    if (await pathExists(path.join(root, relativePath))) {
      errors.push(`${relativePath}: root-level plugin surface is forbidden; use platform plugin roots under plugins/`)
    }
  }

  const packageJson = await readJson<PackageJson>(root, "package.json", errors)
  const expectedVersion = packageJson?.version
  validateIdentity(errors, "package.json", packageJson, expectedVersion)

  if (packageJson?.main !== ".opencode/plugins/compound-converge.js") {
    errors.push("package.json: main must point at the OpenCode plugin entrypoint")
  }
  if (packageJson?.scripts?.["install:codex-agents"] !== "bun run scripts/install-codex-agents.ts") {
    errors.push("package.json: install:codex-agents must run scripts/install-codex-agents.ts")
  }
  if (JSON.stringify(packageJson?.pi?.extensions ?? []) !== JSON.stringify(["./.pi/extensions/compound-converge.ts"])) {
    errors.push("package.json: pi.extensions must expose the Pi extension")
  }
  if (JSON.stringify(packageJson?.pi?.skills ?? []) !== JSON.stringify(["./plugins/generic/skills"])) {
    errors.push("package.json: pi.skills must expose ./plugins/generic/skills")
  }

  const claudePlugin = await readJson<PluginManifest>(
    root,
    "plugins/claude/.claude-plugin/plugin.json",
    errors,
  )
  const codexPlugin = await readJson<PluginManifest>(
    root,
    "plugins/codex/.codex-plugin/plugin.json",
    errors,
  )
  const cursorPlugin = await readJson<PluginManifest>(
    root,
    "plugins/generic/.cursor-plugin/plugin.json",
    errors,
  )
  const geminiManifest = await readJson<GeminiManifest>(root, "gemini-extension.json", errors)

  validateIdentity(errors, "plugins/claude/.claude-plugin/plugin.json", claudePlugin, expectedVersion)
  validateIdentity(errors, "plugins/codex/.codex-plugin/plugin.json", codexPlugin, expectedVersion)
  validateIdentity(errors, "plugins/generic/.cursor-plugin/plugin.json", cursorPlugin, expectedVersion)
  validateIdentity(errors, "gemini-extension.json", geminiManifest, expectedVersion)

  if (codexPlugin?.skills !== "./skills/") {
    errors.push('plugins/codex/.codex-plugin/plugin.json: skills must be "./skills/"')
  } else {
    const skillsPath = path.resolve(root, "plugins/codex", codexPlugin.skills)
    try {
      const stat = await fs.stat(skillsPath)
      if (!stat.isDirectory()) errors.push("plugins/codex/.codex-plugin/plugin.json: skills path is not a directory")
    } catch {
      errors.push("plugins/codex/.codex-plugin/plugin.json: skills path does not exist")
    }
  }

  await validateSkillSurface(root, errors, PLATFORM_SKILL_ROOTS.source, CODEX_SKILLS)
  await validateSkillSurface(root, errors, PLATFORM_SKILL_ROOTS.codex, CODEX_SKILLS)
  await validateSkillSurface(root, errors, PLATFORM_SKILL_ROOTS.claude, BASE_SKILLS)
  await validateSkillSurface(root, errors, PLATFORM_SKILL_ROOTS.generic, BASE_SKILLS)
  await validateAgentSurface(root, errors, PLATFORM_AGENT_ROOTS.sourceClaude, ".agent.md")
  await validateAgentSurface(root, errors, PLATFORM_AGENT_ROOTS.sourceCodex, ".toml")
  await validateAgentSurface(root, errors, PLATFORM_AGENT_ROOTS.claude, ".agent.md")
  await validateAgentSurface(root, errors, PLATFORM_AGENT_ROOTS.codex, ".toml")

  const claudeMarketplace = await readJson<MarketplaceManifest>(
    root,
    ".claude-plugin/marketplace.json",
    errors,
  )
  const codexMarketplace = await readJson<MarketplaceManifest>(
    root,
    ".agents/plugins/marketplace.json",
    errors,
  )
  const cursorMarketplace = await readJson<MarketplaceManifest>(
    root,
    ".cursor-plugin/marketplace.json",
    errors,
  )
  const expectedNames = [PLUGIN_NAME]
  for (const [relativePath, names] of [
    [".claude-plugin/marketplace.json", pluginNames(claudeMarketplace)],
    [".agents/plugins/marketplace.json", pluginNames(codexMarketplace)],
    [".cursor-plugin/marketplace.json", pluginNames(cursorMarketplace)],
  ] as const) {
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      errors.push(`${relativePath}: plugin list must contain only ${PLUGIN_NAME}`)
    }
  }

  if (marketplaceSourcePath(claudeMarketplace?.plugins?.[0]) !== "./plugins/claude") {
    errors.push(".claude-plugin/marketplace.json: plugin source must be ./plugins/claude")
  }
  if (marketplaceSourcePath(codexMarketplace?.plugins?.[0]) !== "./plugins/codex") {
    errors.push(".agents/plugins/marketplace.json: plugin source path must be ./plugins/codex")
  }
  if (marketplaceSourcePath(cursorMarketplace?.plugins?.[0]) !== "./plugins/generic") {
    errors.push(".cursor-plugin/marketplace.json: plugin source must be ./plugins/generic")
  }

  return { errors, warnings }
}
