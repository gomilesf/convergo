#!/usr/bin/env bun
// Trigger-routing eval: for each case prompt, ask a model (via `claude -p`,
// using the developer's existing Claude Code auth) which skill an agent should
// invoke, and compare against the expected answers. Convergo descriptions are
// read from skills-src frontmatter at runtime, so this always evaluates the
// current source; distractor descriptions from evals/trigger/cases.json
// compete in every case so convergo must win against a realistic skill list.
// Usage: bun run eval:trigger [-- --runs 3]
import { readFileSync, readdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PLATFORM_SKILL_ROOTS } from "../src/metadata"

const ROOT = process.cwd()
const evalCwd = mkdtempSync(path.join(tmpdir(), "cvg-trigger-"))

type TriggerCase = { id: string; tags?: string[]; prompt: string; expect: string | string[] | null }
type Distractor = { name: string; description: string }

const runsFlag = process.argv.indexOf("--runs")
const runs = runsFlag === -1 ? 1 : Number(process.argv[runsFlag + 1])
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs must be a positive integer, got: ${process.argv[runsFlag + 1]}`)
}
const model = process.env.EVAL_MODEL ?? "haiku"

const { cases, distractors } = JSON.parse(readFileSync(path.join(ROOT, "evals", "trigger", "cases.json"), "utf8")) as {
  cases: TriggerCase[]
  distractors: Distractor[]
}

const convergoSkills = readdirSync(path.join(ROOT, PLATFORM_SKILL_ROOTS.source), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const content = readFileSync(path.join(ROOT, PLATFORM_SKILL_ROOTS.source, entry.name, "SKILL.md"), "utf8")
    const description = content.match(/^description: (.*)$/m)?.[1]?.replace(/^"|"$/g, "")
    if (!description) {
      throw new Error(`missing description frontmatter: ${entry.name}`)
    }
    return { name: entry.name, description }
  })

const knownNames = new Set([...convergoSkills, ...distractors].map((skill) => skill.name))
const skillList = [...convergoSkills, ...distractors]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((skill) => `- ${skill.name}: ${skill.description}`)
  .join("\n")

function normalizeExpect(expect: TriggerCase["expect"]): string[] {
  if (expect === null) return ["none"]
  return Array.isArray(expect) ? expect : [expect]
}

for (const testCase of cases) {
  for (const name of normalizeExpect(testCase.expect)) {
    if (name !== "none" && !knownNames.has(name)) {
      throw new Error(`case ${testCase.id}: expected skill is not in the candidate list: ${name}`)
    }
  }
}

function ask(question: string): string {
  const proc = Bun.spawnSync(["claude", "-p", "--model", model, "--output-format", "json",
    "--permission-mode", "dontAsk", "--tools", "", "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--no-session-persistence", question], {
    cwd: evalCwd,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (proc.exitCode !== 0) {
    throw new Error(`claude -p failed: ${proc.stderr.toString().slice(0, 300)}`)
  }
  const envelope = JSON.parse(proc.stdout.toString())
  if (envelope.is_error || envelope.subtype !== "success" || envelope.permission_denials?.length)
    throw new Error(`CLI did not complete cleanly: ${envelope.subtype}`)
  const lines = String(envelope.result ?? "").trim().split("\n")
  const raw = lines[lines.length - 1].trim().toLowerCase().replace(/[`*."']/g, "")
  // accept plugin-qualified answers like "convergo:cvg-plan"
  return raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw
}

function route(prompt: string): string {
  const question = `You are an AI coding agent deciding whether to invoke a skill for the user's message.

Available skills:
${skillList}

User message:
"""
${prompt}
"""

Reply with exactly one line: the name of the single skill to invoke, chosen from the list above, or "none" if none of the listed skills applies. Do not invent skill names. No explanation.`

  const answer = ask(question)
  if (knownNames.has(answer) || answer === "none") return answer
  // A real harness constrains answers to the installed skill set; a model
  // cannot invoke a name that does not exist. Mimic that with one retry.
  const retry = ask(`${question}\n\nYour previous answer "${answer}" is not in the list. Answer again with a skill name from the list, or "none".`)
  return knownNames.has(retry) || retry === "none" ? retry : `unparseable(${retry.slice(0, 60)})`
}

const failuresByTag = new Map<string, number>()
const runsByTag = new Map<string, number>()
let failures = 0

for (const testCase of cases) {
  const expected = normalizeExpect(testCase.expect)
  const tag = testCase.tags?.[0] ?? "untagged"
  for (let run = 1; run <= runs; run++) {
    const got = route(testCase.prompt)
    const pass = expected.includes(got)
    if (!pass) failures++
    runsByTag.set(tag, (runsByTag.get(tag) ?? 0) + 1)
    if (!pass) failuresByTag.set(tag, (failuresByTag.get(tag) ?? 0) + 1)
    const runLabel = runs > 1 ? ` (run ${run}/${runs})` : ""
    console.log(`${pass ? "PASS" : "FAIL"} ${testCase.id}${runLabel}: expected ${expected.join("|")}, got ${got}`)
  }
}

const total = cases.length * runs
for (const [tag, tagRuns] of [...runsByTag.entries()].sort()) {
  const tagFailures = failuresByTag.get(tag) ?? 0
  console.log(`${tag}: ${tagRuns - tagFailures}/${tagRuns}`)
}
console.log(failures === 0 ? `all ${total} trigger runs passed` : `${failures}/${total} trigger runs failed`)
process.exit(failures === 0 ? 0 : 1)
