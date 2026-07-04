import { promises as fs } from "node:fs"
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

const PLUGIN_NAME = "convergo"
const EXPECTED_REPOSITORY = "https://github.com/gomilesf/convergo"
export const BASE_SKILLS = ["cvg-code-review", "cvg-code-review-feedback", "cvg-plan", "cvg-plan-review", "cvg-plan-review-feedback", "cvg-work"].sort()
export const LOOP_SKILLS = ["cvg-build-loop", "cvg-multi-session", "cvg-plan-loop"].sort()
export const CODEX_SKILLS = [...BASE_SKILLS, ...LOOP_SKILLS].sort()
export const CLAUDE_SKILLS = [...BASE_SKILLS, ...LOOP_SKILLS].sort()
export const PLATFORM_SKILL_ROOTS = {
  source: "skills-src",
  codex: "plugins/codex/skills",
  claude: "plugins/claude/skills",
  generic: "plugins/generic/skills",
} as const

const REQUIRED_FILES = [
  "package.json",
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  ".cursor-plugin/marketplace.json",
  "plugins/claude/.claude-plugin/plugin.json",
  "plugins/codex/.codex-plugin/plugin.json",
  "plugins/generic/.cursor-plugin/plugin.json",
  "gemini-extension.json",
  ".opencode/plugins/convergo.js",
  ".pi/extensions/convergo.ts",
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

  if (packageJson?.main !== ".opencode/plugins/convergo.js") {
    errors.push("package.json: main must point at the OpenCode plugin entrypoint")
  }
  if (JSON.stringify(packageJson?.pi?.extensions ?? []) !== JSON.stringify(["./.pi/extensions/convergo.ts"])) {
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
  await validateSkillSurface(root, errors, PLATFORM_SKILL_ROOTS.claude, CLAUDE_SKILLS)
  await validateSkillSurface(root, errors, PLATFORM_SKILL_ROOTS.generic, BASE_SKILLS)

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
