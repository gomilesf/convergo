#!/usr/bin/env bun
// Trigger-routing eval: for each case prompt, ask a model (via `claude -p`,
// using the developer's existing Claude Code auth) which convergo skill an
// agent should invoke, and compare against the expected skill. Descriptions
// are read from skills-src frontmatter at runtime, so this always evaluates
// the current source. Usage: bun run eval:trigger [-- --runs 3]
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { PLATFORM_SKILL_ROOTS } from "../src/metadata"

const ROOT = process.cwd()

type TriggerCase = { id: string; prompt: string; expect: string | null }

const runsFlag = process.argv.indexOf("--runs")
const runs = runsFlag === -1 ? 1 : Number(process.argv[runsFlag + 1])
const model = process.env.EVAL_MODEL ?? "haiku"

const { cases } = JSON.parse(readFileSync(path.join(ROOT, "evals", "trigger", "cases.json"), "utf8")) as {
  cases: TriggerCase[]
}

const skillList = readdirSync(path.join(ROOT, PLATFORM_SKILL_ROOTS.source), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const content = readFileSync(path.join(ROOT, PLATFORM_SKILL_ROOTS.source, entry.name, "SKILL.md"), "utf8")
    const description = content.match(/^description: (.*)$/m)?.[1]?.replace(/^"|"$/g, "")
    if (!description) {
      throw new Error(`missing description frontmatter: ${entry.name}`)
    }
    return `- ${entry.name}: ${description}`
  })
  .sort()
  .join("\n")

function route(prompt: string): string {
  const question = `You are an AI coding agent deciding whether to invoke a skill for the user's message.

Available skills:
${skillList}

User message:
"""
${prompt}
"""

Reply with exactly one line: the name of the single skill to invoke, or "none" if no skill applies. No explanation.`

  const proc = Bun.spawnSync(["claude", "-p", "--model", model, question], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (proc.exitCode !== 0) {
    throw new Error(`claude -p failed: ${proc.stderr.toString().slice(0, 300)}`)
  }
  const lines = proc.stdout.toString().trim().split("\n")
  return lines[lines.length - 1].trim().toLowerCase().replace(/[`*."']/g, "")
}

let failures = 0
for (const testCase of cases) {
  const expected = testCase.expect ?? "none"
  for (let run = 1; run <= runs; run++) {
    const got = route(testCase.prompt)
    const pass = got === expected
    if (!pass) failures++
    const runLabel = runs > 1 ? ` (run ${run}/${runs})` : ""
    console.log(`${pass ? "PASS" : "FAIL"} ${testCase.id}${runLabel}: expected ${expected}, got ${got}`)
  }
}

const total = cases.length * runs
console.log(failures === 0 ? `all ${total} trigger runs passed` : `${failures}/${total} trigger runs failed`)
process.exit(failures === 0 ? 0 : 1)
