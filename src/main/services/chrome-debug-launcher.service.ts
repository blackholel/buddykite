import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { get as httpGet } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'

const DEFAULT_REMOTE_DEBUGGING_PORT = 9222
const ENDPOINT_PROBE_TIMEOUT_MS = 1200
const ENDPOINT_WAIT_AFTER_LAUNCH_MS = 10000
const ENDPOINT_POLL_INTERVAL_MS = 500
const CHROME_DEBUG_PROFILE_DIR = join(tmpdir(), 'kite-chrome-devtools-profile')

type PlainObject = Record<string, unknown>

interface ChromeDebugTarget {
  port: number
}

interface SpawnCandidate {
  command: string
  args: string[]
  label: string
}

const ensureLocks = new Map<number, Promise<void>>()

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function hasOption(args: string[], names: string[]): boolean {
  return args.some((arg) => names.some((name) => arg === name || arg.startsWith(`${name}=`)))
}

function hasTruthyFlag(args: string[], names: string[]): boolean {
  return args.some((arg) =>
    names.some((name) => {
      if (arg === name) return true
      if (!arg.startsWith(`${name}=`)) return false
      const value = arg.slice(name.length + 1).trim().toLowerCase()
      return value !== 'false' && value !== '0' && value !== 'no'
    })
  )
}

function readOptionValue(args: string[], names: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i]
    for (const name of names) {
      if (current === name) {
        const next = args[i + 1]
        return typeof next === 'string' ? next : null
      }
      if (current.startsWith(`${name}=`)) {
        return current.slice(name.length + 1)
      }
    }
  }
  return null
}

function isLocalDebugHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  )
}

export function parseLocalDebugPortFromBrowserUrl(browserUrl: string): number | null {
  const trimmed = browserUrl.trim()
  if (!trimmed) return null

  const normalizedUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(normalizedUrl)
    if (!isLocalDebugHost(url.hostname)) {
      return null
    }
    const parsedPort = url.port ? Number(url.port) : DEFAULT_REMOTE_DEBUGGING_PORT
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      return null
    }
    return parsedPort
  } catch {
    return null
  }
}

export function resolveChromeDevtoolsDebugTarget(
  sdkOptions: Record<string, unknown>
): ChromeDebugTarget | null {
  if (!isPlainObject(sdkOptions.mcpServers)) {
    return null
  }

  const rawServer = sdkOptions.mcpServers['chrome-devtools']
  if (!isPlainObject(rawServer)) {
    return null
  }

  if (rawServer.disabled === true) {
    return null
  }

  if (typeof rawServer.type === 'string' && rawServer.type !== 'stdio') {
    return null
  }

  if (typeof rawServer.command !== 'string') {
    return null
  }

  const args = toStringArgs(rawServer.args)
  const hasChromeDevtoolsPackage =
    rawServer.command.toLowerCase().includes('chrome-devtools-mcp') ||
    args.some((arg) => arg.toLowerCase().includes('chrome-devtools-mcp'))
  if (!hasChromeDevtoolsPackage) {
    return null
  }

  if (hasOption(args, ['--ws-endpoint', '--wsEndpoint'])) {
    return null
  }

  const browserUrl = readOptionValue(args, ['--browser-url', '--browserUrl'])
  if (browserUrl) {
    const port = parseLocalDebugPortFromBrowserUrl(browserUrl)
    if (port === null) {
      return null
    }
    return { port }
  }

  const hasAutoConnect = hasTruthyFlag(args, ['--autoConnect', '--auto-connect'])
  if (!hasAutoConnect) {
    return null
  }

  return { port: DEFAULT_REMOTE_DEBUGGING_PORT }
}

function stripOptionArgs(args: string[], names: string[]): string[] {
  const output: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i]
    const matched = names.find((name) => current === name || current.startsWith(`${name}=`))
    if (!matched) {
      output.push(current)
      continue
    }

    if (current === matched) {
      const next = args[i + 1]
      if (typeof next === 'string' && !next.startsWith('-')) {
        i += 1
      }
    }
  }

  return output
}

export function forceChromeDevtoolsUseBrowserUrl(
  sdkOptions: Record<string, unknown>
): Record<string, unknown> {
  const target = resolveChromeDevtoolsDebugTarget(sdkOptions)
  if (!target) {
    return sdkOptions
  }

  if (!isPlainObject(sdkOptions.mcpServers)) {
    return sdkOptions
  }

  const rawServer = sdkOptions.mcpServers['chrome-devtools']
  if (!isPlainObject(rawServer)) {
    return sdkOptions
  }

  const args = toStringArgs(rawServer.args)
  const hasWsEndpoint = hasOption(args, ['--ws-endpoint', '--wsEndpoint'])
  if (hasWsEndpoint) {
    return sdkOptions
  }

  const browserUrlArg = `--browser-url=http://127.0.0.1:${target.port}`
  const strippedArgs = stripOptionArgs(args, [
    '--browser-url',
    '--browserUrl',
    '--autoConnect',
    '--auto-connect'
  ])

  const nextArgs = [...strippedArgs, browserUrlArg]
  const nextServer: PlainObject = {
    ...rawServer,
    args: nextArgs
  }
  const nextMcpServers: PlainObject = {
    ...(sdkOptions.mcpServers as PlainObject),
    'chrome-devtools': nextServer
  }

  return {
    ...sdkOptions,
    mcpServers: nextMcpServers
  }
}

function buildEndpoint(port: number): string {
  return `http://127.0.0.1:${port}/json/version`
}

function probeDebugEndpoint(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpGet(
      {
        hostname: '127.0.0.1',
        port,
        path: '/json/version',
        timeout: timeoutMs
      },
      (response) => {
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
          response.resume()
          resolve(false)
          return
        }

        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          if (body.length < 8192) {
            body += chunk
          }
        })
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body) as PlainObject
            const webSocketDebuggerUrl = parsed.webSocketDebuggerUrl
            const browser = parsed.Browser
            resolve(
              (typeof webSocketDebuggerUrl === 'string' && webSocketDebuggerUrl.length > 0) ||
                (typeof browser === 'string' && browser.length > 0)
            )
          } catch {
            resolve(false)
          }
        })
      }
    )

    request.on('timeout', () => {
      request.destroy(new Error('timeout'))
    })
    request.on('error', () => {
      resolve(false)
    })
  })
}

async function waitForDebugEndpoint(port: number, maxWaitMs: number): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < maxWaitMs) {
    if (await probeDebugEndpoint(port, ENDPOINT_PROBE_TIMEOUT_MS)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, ENDPOINT_POLL_INTERVAL_MS))
  }
  return false
}

function getSharedChromeArgs(port: number): string[] {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${CHROME_DEBUG_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check'
  ]
}

function resolveSpawnCandidates(port: number): SpawnCandidate[] {
  const sharedArgs = getSharedChromeArgs(port)

  if (process.platform === 'darwin') {
    const macCandidates: SpawnCandidate[] = [
      {
        command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: sharedArgs,
        label: 'Google Chrome'
      },
      {
        command: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        args: sharedArgs,
        label: 'Google Chrome Canary'
      }
    ]

    const existing = macCandidates.filter((candidate) => existsSync(candidate.command))
    if (existing.length > 0) {
      return existing
    }

    return [
      {
        command: 'open',
        args: ['-na', 'Google Chrome', '--args', ...sharedArgs],
        label: 'open -na Google Chrome'
      }
    ]
  }

  if (process.platform === 'win32') {
    const env = process.env
    const windowsCandidates = [
      env['PROGRAMFILES'] ? join(env['PROGRAMFILES'], 'Google/Chrome/Application/chrome.exe') : '',
      env['PROGRAMFILES(X86)'] ? join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe') : '',
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : ''
    ].filter(Boolean)

    const existing = windowsCandidates.filter((candidate) => existsSync(candidate))
    if (existing.length > 0) {
      return existing.map((command) => ({ command, args: sharedArgs, label: command }))
    }

    return [{ command: 'chrome', args: sharedArgs, label: 'chrome' }]
  }

  return [
    { command: 'google-chrome', args: sharedArgs, label: 'google-chrome' },
    { command: 'google-chrome-stable', args: sharedArgs, label: 'google-chrome-stable' },
    { command: 'chromium-browser', args: sharedArgs, label: 'chromium-browser' },
    { command: 'chromium', args: sharedArgs, label: 'chromium' }
  ]
}

function spawnDetached(candidate: SpawnCandidate): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const child = spawn(candidate.command, candidate.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.once('error', (error) => {
      const code = typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code?: string }).code
        : 'UNKNOWN'
      console.warn(
        `[MCP][chrome-devtools] Failed to spawn ${candidate.label} (${code})`
      )
      finish(false)
    })

    child.once('spawn', () => {
      child.unref()
      finish(true)
    })
  })
}

async function launchChromeWithRemoteDebugging(port: number): Promise<boolean> {
  const candidates = resolveSpawnCandidates(port)
  for (const candidate of candidates) {
    const launched = await spawnDetached(candidate)
    if (launched) {
      console.log(`[MCP][chrome-devtools] Spawned Chrome candidate: ${candidate.label}`)
      return true
    }
  }
  return false
}

async function ensureChromeDebugEndpoint(port: number): Promise<void> {
  if (await probeDebugEndpoint(port, ENDPOINT_PROBE_TIMEOUT_MS)) {
    return
  }

  console.warn(
    `[MCP][chrome-devtools] Debug endpoint unavailable, launching Chrome: ${buildEndpoint(port)}`
  )

  const launched = await launchChromeWithRemoteDebugging(port)
  if (!launched) {
    console.warn('[MCP][chrome-devtools] Unable to launch Chrome in debugging mode automatically')
    return
  }

  const ready = await waitForDebugEndpoint(port, ENDPOINT_WAIT_AFTER_LAUNCH_MS)
  if (!ready) {
    console.warn(
      `[MCP][chrome-devtools] Chrome launched but debug endpoint still unavailable: ${buildEndpoint(port)}`
    )
    return
  }

  console.log(`[MCP][chrome-devtools] Debug endpoint is ready: ${buildEndpoint(port)}`)
}

export async function ensureChromeDebugModeReadyForMcp(
  sdkOptions: Record<string, unknown>
): Promise<void> {
  const target = resolveChromeDevtoolsDebugTarget(sdkOptions)
  if (!target) {
    return
  }

  const existingLock = ensureLocks.get(target.port)
  if (existingLock) {
    await existingLock
    return
  }

  const task = ensureChromeDebugEndpoint(target.port).finally(() => {
    if (ensureLocks.get(target.port) === task) {
      ensureLocks.delete(target.port)
    }
  })
  ensureLocks.set(target.port, task)
  await task
}
