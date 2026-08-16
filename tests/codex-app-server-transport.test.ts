import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dir, "..")
const TRANSPORT = path.join(
  ROOT,
  "skills-src/cvg-multi-session/scripts/codex-app-server-transport.mjs",
)
const FAKE_CODEX = path.join(ROOT, "tests/fixtures/fake-codex-app-server.mjs")
const scratchDirs: string[] = []

afterEach(() => {
  for (const scratch of scratchDirs.splice(0)) rmSync(scratch, { recursive: true, force: true })
})

function runTransport(args: string[], scenario = "success") {
  const scratch = mkdtempSync(path.join(tmpdir(), "convergo-transport-test-"))
  scratchDirs.push(scratch)
  const promptFile = path.join(scratch, "prompt.txt")
  const traceFile = path.join(scratch, "trace.jsonl")
  writeFileSync(promptFile, "Your verified thread id is <specialist-thread-id>. Perform the bounded specialist task.")

  const result = spawnSync(process.execPath, [TRANSPORT, ...args, "--prompt-file", promptFile], {
    encoding: "utf8",
    env: {
      ...process.env,
      CONVERGO_CODEX_BIN: process.execPath,
      CONVERGO_CODEX_PREFIX_ARGS_JSON: JSON.stringify([FAKE_CODEX]),
      FAKE_CODEX_SCENARIO: scenario,
      FAKE_CODEX_TRACE: traceFile,
    },
  })
  const trace = readFileSync(traceFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  return { result, trace }
}

describe("Codex App Server specialist transport", () => {
  test("starts a thread and turn with explicit full access", () => {
    const { result, trace } = runTransport([
      "start",
      "--cwd", "/tmp/project",
      "--model", "gpt-test",
      "--effort", "high",
    ])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain('"event":"thread_started"')
    expect(result.stdout).toContain('"event":"turn_completed"')

    const initialize = trace.find((message) => message.method === "initialize")
    expect(initialize.params.capabilities).toEqual({ experimentalApi: true })
    const start = trace.find((message) => message.method === "thread/start")
    expect(start.params).toMatchObject({
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      model: "gpt-test",
      serviceName: "convergo",
    })
    expect(start.params.dynamicTools[0]).toMatchObject({
      type: "function",
      name: "convergo_callback",
    })
    const turn = trace.find((message) => message.method === "turn/start")
    expect(turn.params).toMatchObject({
      threadId: "thread-full-access",
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      model: "gpt-test",
      effort: "high",
    })
    expect(turn.params.input[0].text).toContain("thread-full-access")
    expect(turn.params.input[0].text).not.toContain("<specialist-thread-id>")
  })

  test("rebinds full access when resuming the same thread", () => {
    const { result, trace } = runTransport([
      "resume",
      "--thread-id", "thread-existing",
      "--cwd", "/tmp/project",
    ])

    expect(result.status).toBe(0)
    const resume = trace.find((message) => message.method === "thread/resume")
    expect(resume.params).toMatchObject({
      threadId: "thread-existing",
      cwd: "/tmp/project",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    })
    expect(resume.params.dynamicTools[0]).toMatchObject({
      type: "function",
      name: "convergo_callback",
    })
    const turn = trace.find((message) => message.method === "turn/start")
    expect(turn.params).toMatchObject({
      threadId: "thread-existing",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    })
  })

  test("fails before creating a thread when managed requirements forbid full access", () => {
    const { result, trace } = runTransport([
      "start",
      "--cwd", "/tmp/project",
    ], "blocked")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Managed requirements do not allow approval policy never")
    expect(trace.some((message) => message.method === "thread/start")).toBe(false)
  })

  test("fails closed when App Server returns downgraded permissions", () => {
    const { result, trace } = runTransport([
      "start",
      "--cwd", "/tmp/project",
    ], "downgraded")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("returned approval policy")
    expect(trace.some((message) => message.method === "turn/start")).toBe(false)
  })

  test("terminates the App Server process after malformed protocol output", () => {
    const { result } = runTransport([
      "start",
      "--cwd", "/tmp/project",
    ], "invalid-json")

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("codex app-server emitted invalid JSON")
  })

  test("returns the specialist callback through the attached transport", () => {
    const { result, trace } = runTransport([
      "start",
      "--cwd", "/tmp/project",
      "--require-callback",
    ], "callback")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('"event":"specialist_callback"')
    expect(result.stdout).toContain("STATUS: complete")
    const response = trace.find((message) => message.id === "server-callback" && !message.method)
    expect(response.result).toMatchObject({ success: true })
  })

  test("fails closed when a required callback is missing", () => {
    const { result } = runTransport([
      "start",
      "--cwd", "/tmp/project",
      "--require-callback",
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Expected exactly one convergo_callback call, received 0")
  })
})
