#!/usr/bin/env bun
// Bounded decision regression checks, not proof of a real multi-agent run.
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Case = { id: string; skills: string[]; prompt: string; choices: string[]; expect: string }
const ROOT = path.resolve(import.meta.dir, "../..")
function option(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i === -1) return undefined
  const value = process.argv[i + 1]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return value
}
const skillRoot = path.resolve(option("--skills-root") ?? path.join(ROOT, "skills-src"))
const ablate = process.argv.includes("--ablate")
const selected = option("--case")
const model = process.env.EVAL_MODEL ?? "sonnet"
const out = mkdtempSync(path.join(tmpdir(), "cvg-convergence-"))
const all: Case[] = JSON.parse(readFileSync(path.join(import.meta.dir, "cases.json"), "utf8"))
const cases = all.filter(c => (!selected || c.id === selected) &&
  (!ablate || ["cached-container", "provisional-ack"].includes(c.id)))
if (!cases.length) throw new Error("No matching cases")
const results: object[] = []
let failed = 0
console.log(`Results: ${out}; model=${model}; skills=${skillRoot}; ablated=${ablate}`)

for (const c of cases) {
  const rules = c.skills.map(name => {
    let text = readFileSync(path.join(skillRoot, name, "SKILL.md"), "utf8")
    if (ablate) {
      const removed = text.replace(/For materially added mechanisms,[\s\S]*?deletion quota\./, "")
      if (removed === text) throw new Error(`Ablation matched nothing in ${name}`)
      text = removed
    }
    return `<skill name="${name}">\n${text}\n</skill>`
  }).join("\n")
  const prompt = `Evaluate the next decision in the supplied fixture. User intent and
explicit constraints govern the task; skills guide the workflow within them.
This is a decision-only fixture, so do not invoke tools, create agents or claim
that you executed any check. All code/runtime facts needed are supplied below.

${rules}

<task>\n${c.prompt}\n</task>

Return one JSON object with "decision" chosen from ${JSON.stringify(c.choices)}
and "reason" explaining the concrete evidence for your choice. No markdown.`
  writeFileSync(path.join(out, `${c.id}.prompt.txt`), prompt)
  const started = Date.now()
  const schema = JSON.stringify({ type: "object", properties: {
    decision: { type: "string", enum: c.choices }, reason: { type: "string" },
  }, required: ["decision", "reason"], additionalProperties: false })
  const proc = Bun.spawn(["claude", "-p", "--output-format", "json", "--model", model,
    "--json-schema", schema,
    "--permission-mode", "dontAsk", "--tools", "", "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--no-session-persistence"], {
    cwd: out, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  })
  proc.stdin.write(prompt)
  proc.stdin.end()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; proc.kill() }, 180_000)
  let record: Record<string, unknown>
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ])
    writeFileSync(path.join(out, `${c.id}.stdout.json`), stdout)
    writeFileSync(path.join(out, `${c.id}.stderr.txt`), stderr)
    if (timedOut || exitCode !== 0) throw new Error(timedOut ? "timeout" : `CLI exit ${exitCode}`)
    const envelope = JSON.parse(stdout)
    if (envelope.is_error || envelope.subtype !== "success" || envelope.permission_denials?.length)
      throw new Error(`CLI did not complete cleanly: ${envelope.subtype}`)
    const answer = envelope.structured_output
    if (!answer || typeof answer !== "object") throw new Error("Missing structured output")
    if (!c.choices.includes(answer.decision) || typeof answer.reason !== "string" || !answer.reason.trim())
      throw new Error("Invalid decision or missing explanation")
    record = { id: c.id, pass: answer.decision === c.expect, answer,
      modelUsage: envelope.modelUsage, usage: envelope.usage, cost_usd: envelope.total_cost_usd }
  } catch (error) {
    record = { id: c.id, pass: false, error: String(error) }
  } finally {
    clearTimeout(timer)
  }
  record.elapsed_ms = Date.now() - started
  if (!record.pass) failed++
  results.push(record)
  writeFileSync(path.join(out, "results.json"), JSON.stringify({ skillRoot, model, ablate, results }, null, 2))
  console.log(`${record.pass ? "PASS" : "FAIL"} ${c.id}: ${JSON.stringify((record.answer as { decision?: string } | undefined)?.decision ?? record.error)}`)
}
console.log(`${cases.length - failed}/${cases.length} passed; decision coverage only; ${out}`)
process.exitCode = failed ? 1 : 0
