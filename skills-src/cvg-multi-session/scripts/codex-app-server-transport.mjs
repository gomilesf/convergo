#!/usr/bin/env node

import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import readline from "node:readline"

const APPROVAL_POLICY = "never"
const SANDBOX_MODE = "danger-full-access"
const SANDBOX_POLICY_TYPE = "dangerFullAccess"
const CALLBACK_TOOL_NAME = "convergo_callback"
const REQUEST_TIMEOUT_MS = 30_000

const CALLBACK_TOOL = {
  type: "function",
  name: CALLBACK_TOOL_NAME,
  description: "Deliver the final specialist callback to the attached Convergo orchestrator. Call exactly once when the assigned work is complete or blocked, using the exact callback text required by the prompt.",
  inputSchema: {
    type: "object",
    properties: {
      callback: {
        type: "string",
        minLength: 1,
        description: "The complete callback text required by the specialist prompt.",
      },
    },
    required: ["callback"],
    additionalProperties: false,
  },
}

function usage() {
  return [
    "Usage:",
    "  codex-app-server-transport.mjs start --cwd <path> --prompt-file <path> [--model <id>] [--effort <level>] [--require-callback] [--ephemeral]",
    "  codex-app-server-transport.mjs resume --thread-id <id> --cwd <path> --prompt-file <path> [--model <id>] [--effort <level>] [--require-callback]",
  ].join("\n")
}

function parseArgs(argv) {
  const [operation, ...rest] = argv
  if (operation !== "start" && operation !== "resume") {
    throw new Error(`Expected operation "start" or "resume".\n${usage()}`)
  }

  const options = { operation, ephemeral: false, requireCallback: false }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === "--ephemeral") {
      options.ephemeral = true
      continue
    }
    if (arg === "--require-callback") {
      options.requireCallback = true
      continue
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}\n${usage()}`)
    }
    const value = rest[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}\n${usage()}`)
    }
    index += 1
    switch (arg) {
      case "--cwd":
        options.cwd = value
        break
      case "--prompt-file":
        options.promptFile = value
        break
      case "--thread-id":
        options.threadId = value
        break
      case "--model":
        options.model = value
        break
      case "--effort":
        options.effort = value
        break
      default:
        throw new Error(`Unknown option: ${arg}\n${usage()}`)
    }
  }

  if (!options.cwd) throw new Error(`--cwd is required.\n${usage()}`)
  if (!options.promptFile) throw new Error(`--prompt-file is required.\n${usage()}`)
  if (operation === "resume" && !options.threadId) {
    throw new Error(`--thread-id is required for resume.\n${usage()}`)
  }
  if (operation === "resume" && options.ephemeral) {
    throw new Error("--ephemeral is valid only for start")
  }

  return options
}

function commandParts() {
  const binary = process.env.CONVERGO_CODEX_BIN || "codex"
  let prefix = []
  if (process.env.CONVERGO_CODEX_PREFIX_ARGS_JSON) {
    const parsed = JSON.parse(process.env.CONVERGO_CODEX_PREFIX_ARGS_JSON)
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new Error("CONVERGO_CODEX_PREFIX_ARGS_JSON must be a JSON array of strings")
    }
    prefix = parsed
  }
  return { binary, args: [...prefix, "app-server", "--stdio"] }
}

class RpcClient {
  constructor(proc) {
    this.proc = proc
    this.nextId = 1
    this.pending = new Map()
    this.waiters = []
    this.handlers = new Map()
    this.closed = false
    this.disposed = false

    this.lines = readline.createInterface({ input: proc.stdout })
    this.lines.on("line", (line) => this.handleLine(line))
    proc.stderr.on("data", (chunk) => process.stderr.write(chunk))
    proc.on("error", (error) => this.failAll(error))
    proc.on("exit", (code, signal) => {
      if (!this.closed) {
        this.failAll(new Error(`codex app-server exited before transport completion (code=${code}, signal=${signal})`))
      }
    })
  }

  handleLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      this.failAll(new Error(`codex app-server emitted invalid JSON: ${error.message}`))
      return
    }

    if (message.id !== undefined && message.method) {
      this.handleRequest(message)
      return
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error) {
        pending.reject(new Error(`${pending.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (!message.method) return
    const remaining = []
    for (const waiter of this.waiters) {
      if (waiter.method === message.method && waiter.predicate(message.params)) {
        waiter.resolve(message.params)
      } else {
        remaining.push(waiter)
      }
    }
    this.waiters = remaining
  }

  handleRequest(message) {
    const handler = this.handlers.get(message.method)
    if (!handler) {
      const error = new Error(`Unsupported App Server request: ${message.method}`)
      this.write({ id: message.id, error: { code: -32601, message: error.message } })
      this.failAll(error)
      return
    }

    Promise.resolve()
      .then(() => handler(message.params))
      .then(
        (result) => this.write({ id: message.id, result }),
        (error) => this.write({
          id: message.id,
          error: { code: -32602, message: error instanceof Error ? error.message : String(error) },
        }),
      )
  }

  onRequest(method, handler) {
    this.handlers.set(method, handler)
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error("App Server transport is closed"))
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { method, resolve, reject, timeout })
      this.write({ method, id, params })
    })
  }

  notify(method, params) {
    this.write({ method, params })
  }

  waitFor(method, predicate) {
    if (this.closed) return Promise.reject(new Error("App Server transport is closed"))
    return new Promise((resolve, reject) => {
      this.waiters.push({ method, predicate, resolve, reject })
    })
  }

  write(message) {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`)
  }

  failAll(error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiter of this.waiters) waiter.reject(error)
    this.waiters = []
  }

  close() {
    if (this.disposed) return
    this.disposed = true
    this.closed = true
    this.lines.close()
    if (!this.proc.stdin.destroyed) this.proc.stdin.end()
    if (this.proc.exitCode === null && !this.proc.killed) this.proc.kill("SIGTERM")
  }
}

function assertRequirementsAllowFullAccess(requirements) {
  if (!requirements) return
  const approvalPolicies = requirements.allowedApprovalPolicies
  if (Array.isArray(approvalPolicies) && !approvalPolicies.includes(APPROVAL_POLICY)) {
    throw new Error(`Managed requirements do not allow approval policy ${APPROVAL_POLICY}`)
  }
  const sandboxModes = requirements.allowedSandboxModes
  if (Array.isArray(sandboxModes) && !sandboxModes.includes(SANDBOX_MODE)) {
    throw new Error(`Managed requirements do not allow sandbox mode ${SANDBOX_MODE}`)
  }
}

function assertFullAccess(result, operation) {
  if (result?.approvalPolicy !== APPROVAL_POLICY) {
    throw new Error(`${operation} returned approval policy ${JSON.stringify(result?.approvalPolicy)} instead of ${APPROVAL_POLICY}`)
  }
  if (result?.sandbox?.type !== SANDBOX_POLICY_TYPE) {
    throw new Error(`${operation} returned sandbox ${JSON.stringify(result?.sandbox)} instead of ${SANDBOX_POLICY_TYPE}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const prompt = await readFile(options.promptFile, "utf8")
  if (!prompt.trim()) throw new Error("Prompt file must not be empty")

  const command = commandParts()
  const proc = spawn(command.binary, command.args, {
    stdio: ["pipe", "pipe", "pipe"],
  })
  const rpc = new RpcClient(proc)
  const callbacks = []
  let activeThreadId

  rpc.onRequest("item/tool/call", (params) => {
    if (params?.tool !== CALLBACK_TOOL_NAME || params?.namespace) {
      throw new Error(`Unsupported dynamic tool: ${params?.namespace ? `${params.namespace}.` : ""}${params?.tool}`)
    }
    if (activeThreadId && params.threadId !== activeThreadId) {
      throw new Error(`Callback came from unexpected thread ${params.threadId}`)
    }
    if (callbacks.length > 0) {
      throw new Error("The specialist callback was already delivered")
    }
    const callback = params?.arguments?.callback
    if (typeof callback !== "string" || !callback.trim()) {
      throw new Error("convergo_callback requires a non-empty callback string")
    }
    callbacks.push(callback)
    console.log(JSON.stringify({
      event: "specialist_callback",
      threadId: params.threadId,
      turnId: params.turnId,
      callback,
    }))
    return {
      contentItems: [{ type: "inputText", text: "Callback delivered to the attached Convergo orchestrator." }],
      success: true,
    }
  })

  try {
    await rpc.request("initialize", {
      clientInfo: {
        name: "convergo",
        title: "Convergo",
        version: "0.5.1",
      },
      capabilities: { experimentalApi: true },
    })
    rpc.notify("initialized", {})

    const requirementsResult = await rpc.request("configRequirements/read", {})
    assertRequirementsAllowFullAccess(requirementsResult?.requirements)

    let threadResult
    if (options.operation === "start") {
      const params = {
        cwd: options.cwd,
        approvalPolicy: APPROVAL_POLICY,
        sandbox: SANDBOX_MODE,
        serviceName: "convergo",
        dynamicTools: [CALLBACK_TOOL],
      }
      if (options.model) params.model = options.model
      if (options.ephemeral) params.ephemeral = true
      threadResult = await rpc.request("thread/start", params)
    } else {
      const params = {
        threadId: options.threadId,
        cwd: options.cwd,
        approvalPolicy: APPROVAL_POLICY,
        sandbox: SANDBOX_MODE,
        dynamicTools: [CALLBACK_TOOL],
      }
      if (options.model) params.model = options.model
      threadResult = await rpc.request("thread/resume", params)
    }

    assertFullAccess(threadResult, `thread/${options.operation}`)
    const threadId = threadResult?.thread?.id
    if (!threadId) throw new Error(`thread/${options.operation} did not return a thread id`)
    if (options.operation === "resume" && threadId !== options.threadId) {
      throw new Error(`thread/resume returned unexpected thread id ${threadId}`)
    }
    activeThreadId = threadId

    const completed = rpc.waitFor(
      "turn/completed",
      (params) => params?.threadId === threadId,
    )
    const renderedPrompt = prompt.replaceAll("<specialist-thread-id>", threadId)
    const turnParams = {
      threadId,
      cwd: options.cwd,
      input: [{ type: "text", text: renderedPrompt }],
      approvalPolicy: APPROVAL_POLICY,
      sandboxPolicy: { type: SANDBOX_POLICY_TYPE },
    }
    if (options.model) turnParams.model = options.model
    if (options.effort) turnParams.effort = options.effort
    const turnResult = await rpc.request("turn/start", turnParams)
    const turnId = turnResult?.turn?.id
    if (!turnId) throw new Error("turn/start did not return a turn id")

    console.log(JSON.stringify({
      event: "thread_started",
      threadId,
      turnId,
      approvalPolicy: APPROVAL_POLICY,
      sandbox: SANDBOX_POLICY_TYPE,
    }))

    const completedParams = await completed
    const status = completedParams?.turn?.status
    console.log(JSON.stringify({ event: "turn_completed", threadId, turnId, status }))
    if (status !== "completed") {
      const detail = completedParams?.turn?.error?.message ?? `status=${JSON.stringify(status)}`
      throw new Error(`Codex turn did not complete successfully: ${detail}`)
    }
    if (options.requireCallback && callbacks.length !== 1) {
      throw new Error(`Expected exactly one ${CALLBACK_TOOL_NAME} call, received ${callbacks.length}`)
    }
  } finally {
    rpc.close()
  }
}

main().catch((error) => {
  console.error(`convergo transport error: ${error.message}`)
  process.exitCode = 1
})
