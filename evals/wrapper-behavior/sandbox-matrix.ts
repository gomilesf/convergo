#!/usr/bin/env bun
// Layer B: sandbox ground-truth matrix for the hybrid-loop codex wrapper
// pattern (cvg-hybrid-plan-loop / cvg-hybrid-build-loop).
//
// Runs real `codex exec` micro-prompts against throwaway git fixtures and
// asserts effects on the FILESYSTEM, not model prose. Doubles as a canary
// for codex CLI upgrades silently changing sandbox semantics.
//
// Cost: ~10 short codex calls at low reasoning effort. Run manually:
//   bun run eval:sandbox

import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const EFFORT = ["-c", 'model_reasoning_effort="low"']
const TIMEOUT_MS = 240_000

type Cell = { name: string; run: () => string | null } // returns failure reason or null

const results: Array<{ name: string; ok: boolean; note: string }> = []

function sh(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: "utf8" }).trim()
}

function codex(args: string[], cwd: string): { stdout: string; status: number } {
  const r = spawnSync("codex", ["exec", ...EFFORT, ...args], {
    cwd,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { stdout: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status ?? -1 }
}

function exactPrompt(cmd: string): string {
  return `Run exactly this shell command and nothing else: ${cmd}\nThen reply with exactly one word: DONE. If the command fails, reply with exactly one word: FAILED.`
}

// ---------- fixtures ----------
// NOT under /tmp or $TMPDIR: both are default writable roots of every
// workspace-write run, which would falsify all the "denied" cells. Real
// repos live under $HOME, so the fixtures must too.
const root = mkdtempSync(path.join(homedir(), ".cvg-sandbox-eval-"))
const repoA = path.join(root, "repoA")
const repoB = path.join(root, "repoB")
const wt = path.join(root, "wtA")
const scratch = path.join(root, "scratch")
const token = `TOKEN-${Math.random().toString(36).slice(2, 10)}`

for (const d of [repoA, repoB, scratch]) sh(`mkdir -p ${d}`)
sh(`git init -q && git commit -q --allow-empty -m init`, repoA)
writeFileSync(path.join(repoA, "token.txt"), token + "\n")
sh(`git add -A && git commit -q -m token`, repoA)
sh(`git init -q && git commit -q --allow-empty -m init`, repoB)
sh(`git -C ${repoA} worktree add -q -b evalbranch ${wt} HEAD`)
const wtBase = sh(`git -C ${wt} rev-parse HEAD`)
const commonDir = sh(`git -C ${wt} rev-parse --git-common-dir`)

console.log(`fixtures: ${root}`)
console.log(`git common dir: ${commonDir}\n`)

// ---------- cells ----------
const cells: Cell[] = [
  {
    // reviewer sandbox must NOT be read-only: it blocks /tmp entirely
    name: "read-only denies /tmp write (why reviewers must not use it)",
    run: () => {
      const probe = `/tmp/cvg-eval-ro-${process.pid}.txt`
      codex(["--sandbox", "read-only", "--skip-git-repo-check", exactPrompt(`echo x > ${probe}`)], scratch)
      return existsSync(probe) ? `unexpected: ${probe} was written under read-only` : null
    },
  },
  {
    // reviewer sandbox: workspace-write from scratch cwd cannot write the repo
    name: "reviewer sandbox: repo write denied (workspace-write -C scratch)",
    run: () => {
      const probe = path.join(repoA, "reviewer-should-not-write.txt")
      codex(["--sandbox", "workspace-write", "--skip-git-repo-check", exactPrompt(`echo x > ${probe}`)], scratch)
      return existsSync(probe) ? "unexpected: reviewer wrote into the repo" : null
    },
  },
  {
    // reviewer sandbox: /tmp writable (audit artifacts)
    name: "reviewer sandbox: /tmp write allowed (audit artifacts)",
    run: () => {
      const probe = `/tmp/cvg-eval-ws-${process.pid}.txt`
      codex(["--sandbox", "workspace-write", "--skip-git-repo-check", exactPrompt(`echo x > ${probe}`)], scratch)
      const ok = existsSync(probe)
      if (ok) rmSync(probe)
      return ok ? null : "reviewer could not write /tmp"
    },
  },
  {
    // reviewer sandbox: repo stays readable
    name: "reviewer sandbox: repo read allowed",
    run: () => {
      const out = path.join(scratch, "read-probe.txt")
      codex(
        ["--sandbox", "workspace-write", "--skip-git-repo-check", "-o", out,
          `Read the file ${path.join(repoA, "token.txt")} and reply with exactly its contents.`],
        scratch,
      )
      const got = existsSync(out) ? readFileSync(out, "utf8") : ""
      return got.includes(token) ? null : `token not read back (got: ${got.slice(0, 80)})`
    },
  },
  {
    // worker in linked worktree WITHOUT git common dir: commit must fail
    name: "linked worktree: commit denied without git common dir",
    run: () => {
      codex(["--sandbox", "workspace-write",
        exactPrompt(`cd ${wt} && echo c1 >> f.txt && git add -A && git commit -m eval-denied`)], wt)
      const head = sh(`git -C ${wt} rev-parse HEAD`)
      sh(`git -C ${wt} checkout -q -- . 2>/dev/null || true; rm -f ${wt}/f.txt`)
      return head === wtBase ? null : "unexpected: commit succeeded without the git common dir"
    },
  },
  {
    // 0.3.6 fix: --add-dir <git-common-dir> makes worktree commits work
    name: "linked worktree: commit allowed with --add-dir git-common-dir",
    run: () => {
      codex(["--sandbox", "workspace-write", "--add-dir", commonDir,
        exactPrompt(`cd ${wt} && echo c2 >> f.txt && git add -A && git commit -m eval-allowed`)], wt)
      const head = sh(`git -C ${wt} rev-parse HEAD`)
      return head !== wtBase ? null : "commit still failed with --add-dir git-common-dir"
    },
  },
  {
    // cross-repo write denied without --add-dir
    name: "cross-repo: second repo write denied without --add-dir",
    run: () => {
      const probe = path.join(repoB, "cross-denied.txt")
      codex(["--sandbox", "workspace-write", exactPrompt(`echo x > ${probe}`)], wt)
      return existsSync(probe) ? "unexpected: cross-repo write succeeded without --add-dir" : null
    },
  },
  {
    // cross-repo write allowed with --add-dir
    name: "cross-repo: second repo write allowed with --add-dir",
    run: () => {
      const probe = path.join(repoB, "cross-allowed.txt")
      codex(["--sandbox", "workspace-write", "--add-dir", repoB, exactPrompt(`echo x > ${probe}`)], wt)
      return existsSync(probe) ? null : "cross-repo write failed despite --add-dir"
    },
  },
  {
    // resume re-pin: sandbox_mode + writable_roots config overrides work on resume
    name: "resume: re-pinned sandbox_mode + writable_roots enforced",
    run: () => {
      const header = codex(["--sandbox", "workspace-write", "--skip-git-repo-check", "Reply with exactly one word: READY."], scratch).stdout
      const sid = header.match(/session id:\s*([0-9a-f-]{36})/)?.[1]
      if (!sid) return `no session id in header (${header.slice(0, 120)})`
      const probeB = path.join(repoB, "resume-allowed.txt")
      const probeA = path.join(repoA, "resume-should-not-write.txt")
      const r = spawnSync("codex",
        ["exec", "resume", sid, "--skip-git-repo-check", ...EFFORT,
          "-c", 'sandbox_mode="workspace-write"',
          "-c", `sandbox_workspace_write.writable_roots=["${repoB}"]`,
          exactPrompt(`echo x > ${probeB}; echo x > ${probeA}`)],
        { cwd: scratch, encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] })
      const resumedSandbox = ((r.stdout ?? "") + (r.stderr ?? "")).match(/sandbox:\s*([^\n]+)/)?.[1] ?? "?"
      if (!existsSync(probeB)) return `writable_roots not honored on resume (sandbox: ${resumedSandbox})`
      if (existsSync(probeA)) return `unexpected: repoA writable on resume (sandbox: ${resumedSandbox})`
      return null
    },
  },
  {
    // informational canary: what does a resume WITHOUT overrides resolve to?
    name: "canary: resume without overrides (informational)",
    run: () => {
      const header = codex(["--sandbox", "workspace-write", "--skip-git-repo-check", "Reply with exactly one word: READY."], scratch).stdout
      const sid = header.match(/session id:\s*([0-9a-f-]{36})/)?.[1]
      if (!sid) return "no session id"
      const r = spawnSync("codex", ["exec", "resume", sid, "--skip-git-repo-check", ...EFFORT, "Reply with exactly one word: OK."],
        { cwd: scratch, encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] })
      const mode = ((r.stdout ?? "") + (r.stderr ?? "")).match(/sandbox:\s*([^\n]+)/)?.[1]?.trim() ?? "unknown"
      results.push({ name: `  -> unoverridden resume resolves to: ${mode}`, ok: true, note: "" })
      return mode.startsWith("workspace-write") ? null : `WARN: resume without override resolved to "${mode}" — re-pinning is mandatory`
    },
  },
]

// ---------- run ----------
let failures = 0
for (const cell of cells) {
  let note: string | null
  try {
    note = cell.run()
  } catch (err) {
    note = `error: ${(err as Error).message}`
  }
  const warn = note?.startsWith("WARN:") ?? false
  const ok = note === null || warn
  if (!ok) failures++
  results.push({ name: cell.name, ok, note: note ?? "" })
  console.log(`${ok ? (warn ? "⚠︎" : "✔") : "✘"} ${cell.name}${note ? ` — ${note}` : ""}`)
}

rmSync(root, { recursive: true, force: true })

console.log(`\n${cells.length - failures}/${cells.length} cells passed`)
process.exit(failures === 0 ? 0 : 1)
