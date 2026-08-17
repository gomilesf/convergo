#!/usr/bin/env node

import { appendFileSync } from "node:fs"
import readline from "node:readline"

const scenario = process.env.FAKE_CODEX_SCENARIO || "success"
const tracePath = process.env.FAKE_CODEX_TRACE
const lines = readline.createInterface({ input: process.stdin })
let activeThreadId
let activeTurnId

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function trace(message) {
  if (tracePath) appendFileSync(tracePath, `${JSON.stringify(message)}\n`)
}

lines.on("line", (line) => {
  const message = JSON.parse(line)
  trace(message)

  if (message.id === "server-callback" && !message.method) {
    setTimeout(() => {
      send({
        method: "turn/completed",
        params: {
          threadId: activeThreadId,
          turn: { id: activeTurnId, status: "completed", items: [], error: null },
        },
      })
    }, 5)
    return
  }

  if (message.method === "initialize") {
    if (scenario === "invalid-json") {
      process.stdout.write("not-json\n")
      return
    }
    send({ id: message.id, result: { userAgent: "fake", platformFamily: "unix", platformOs: "macos" } })
    return
  }
  if (message.method === "initialized") return
  if (message.method === "configRequirements/read") {
    const requirements = scenario === "blocked"
      ? { allowedApprovalPolicies: ["on-request"], allowedSandboxModes: ["workspace-write"] }
      : null
    send({ id: message.id, result: { requirements } })
    return
  }
  if (message.method === "thread/start") {
    const threadId = "thread-full-access"
    const fullAccess = scenario !== "downgraded"
    send({
      id: message.id,
      result: {
        thread: { id: threadId, ephemeral: Boolean(message.params.ephemeral) },
        approvalPolicy: fullAccess ? "never" : "on-request",
        approvalsReviewer: "user",
        cwd: message.params.cwd,
        model: message.params.model || "gpt-test",
        modelProvider: "openai",
        sandbox: { type: fullAccess ? "dangerFullAccess" : "workspaceWrite" },
      },
    })
    return
  }
  if (message.method === "thread/unsubscribe") {
    send({
      id: message.id,
      result: { status: scenario === "unsubscribe-failure" ? "stillSubscribed" : "unsubscribed" },
    })
    return
  }
  if (message.method === "turn/start") {
    activeThreadId = message.params.threadId
    activeTurnId = "turn-full-access"
    send({ id: message.id, result: { turn: { id: activeTurnId, status: "inProgress", items: [], error: null } } })
    if (scenario === "callback") {
      setTimeout(() => {
        send({
          id: "server-callback",
          method: "item/tool/call",
          params: {
            threadId: activeThreadId,
            turnId: activeTurnId,
            callId: "call-callback",
            tool: "convergo_callback",
            arguments: { callback: "STATUS: complete\nSUMMARY: Callback delivered." },
          },
        })
      }, 5)
      return
    }
    setTimeout(() => {
      send({
        method: "turn/completed",
        params: {
          threadId: message.params.threadId,
          turn: { id: activeTurnId, status: scenario === "turn-failed" ? "failed" : "completed", items: [], error: null },
        },
      })
    }, 5)
  }
})
