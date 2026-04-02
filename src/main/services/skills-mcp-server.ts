/**
 * Skills SDK MCP Server
 *
 * Provides on-demand access to skills without preloading them into context.
 */

import { z } from 'zod'
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { listSkills, getSkillContent } from './skills.service'

export const SKILLS_LAZY_SYSTEM_PROMPT = `
## Lazy Skills / Commands / Agents
Skills, commands, and agents are not preloaded.
- If the user includes a line: /name → the system may inject a <skill> or <command> block.
- If the user includes a line: @agent → the system will inject a <task-request> block.

When you see:
- <skill name="X">...</skill> → treat as authoritative skill instructions.
- <command name="X">...</command> → treat as authoritative command instructions.
- <task-request name="X">...</task-request> → YOU MUST call the Task tool with:
  { "description": "X", "prompt": "<content>", "subagent_type": "X" }.
`

const SKILLS_QUERY_TIMEOUT_MS = 1500
const SKILLS_CIRCUIT_WINDOW_MS = 60_000
const SKILLS_CIRCUIT_THRESHOLD = 5
const SKILLS_CIRCUIT_OPEN_MS = 60_000
const SKILLS_METADATA_CACHE_TTL_MS = 60_000
const SKILLS_CONTENT_CACHE_TTL_MS = 10 * 60_000
const SKILLS_STALE_MAX_AGE_MS = 24 * 60 * 60_000
const MAX_DURATION_SAMPLES = 512

interface CacheEntry<T> {
  value: T
  updatedAt: number
}

interface SkillsMcpMetricsState {
  requestCount: number
  timeoutCount: number
  failureCount: number
  circuitOpenCount: number
  cacheHitCount: number
  staleFallbackHitCount: number
  cacheMissCount: number
  durationsMs: number[]
}

const skillsMetadataCache = new Map<string, CacheEntry<ReturnType<typeof listSkills>>>()
const skillsContentCache = new Map<string, CacheEntry<ReturnType<typeof getSkillContent>>>()
const recentFailureTimestamps: number[] = []
const metricsState: SkillsMcpMetricsState = {
  requestCount: 0,
  timeoutCount: 0,
  failureCount: 0,
  circuitOpenCount: 0,
  cacheHitCount: 0,
  staleFallbackHitCount: 0,
  cacheMissCount: 0,
  durationsMs: []
}

let circuitOpenUntil = 0
let lastTelemetryMetricsEmitAt = 0

class SkillsQueryTimeoutError extends Error {
  errorCode = 'SKILLS_QUERY_TIMEOUT'
}

class SkillsCircuitOpenError extends Error {
  errorCode = 'SKILLS_QUERY_CIRCUIT_OPEN'
}

function nowMs(): number {
  return Date.now()
}

function pushDurationSample(durationMs: number): void {
  metricsState.durationsMs.push(durationMs)
  if (metricsState.durationsMs.length > MAX_DURATION_SAMPLES) {
    metricsState.durationsMs.shift()
  }
}

function calculateP95(samples: number[]): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return sorted[index]
}

function getFailureRateDenominator(): number {
  return Math.max(1, metricsState.requestCount)
}

function getCacheRateDenominator(): number {
  return Math.max(1, metricsState.cacheHitCount + metricsState.cacheMissCount)
}

function emitSkillsMcpTelemetry(
  kind: 'metrics_snapshot' | 'stale_fallback' | 'query_error' | 'circuit_open',
  fields: Record<string, unknown> = {}
): void {
  console.warn('[telemetry] skills_mcp_server', {
    kind,
    ...fields,
    metrics: getSkillsMcpServerMetrics()
  })
}

function maybeEmitMetricsSnapshot(): void {
  const now = nowMs()
  if (now - lastTelemetryMetricsEmitAt < 30_000) {
    return
  }
  lastTelemetryMetricsEmitAt = now
  emitSkillsMcpTelemetry('metrics_snapshot', { snapshotOnly: true })
}

export function getSkillsMcpServerMetrics(): {
  requestCount: number
  timeoutRate: number
  circuitOpenCount: number
  cacheHitRate: number
  staleFallbackHitCount: number
  queryP95Ms: number
} {
  return {
    requestCount: metricsState.requestCount,
    timeoutRate: metricsState.timeoutCount / getFailureRateDenominator(),
    circuitOpenCount: metricsState.circuitOpenCount,
    cacheHitRate: metricsState.cacheHitCount / getCacheRateDenominator(),
    staleFallbackHitCount: metricsState.staleFallbackHitCount,
    queryP95Ms: calculateP95(metricsState.durationsMs)
  }
}

export function resetSkillsMcpServerState(): void {
  skillsMetadataCache.clear()
  skillsContentCache.clear()
  recentFailureTimestamps.length = 0
  circuitOpenUntil = 0
  metricsState.requestCount = 0
  metricsState.timeoutCount = 0
  metricsState.failureCount = 0
  metricsState.circuitOpenCount = 0
  metricsState.cacheHitCount = 0
  metricsState.staleFallbackHitCount = 0
  metricsState.cacheMissCount = 0
  metricsState.durationsMs.length = 0
  lastTelemetryMetricsEmitAt = 0
}

function pruneFailures(timestampMs: number): void {
  while (recentFailureTimestamps.length > 0) {
    if (timestampMs - recentFailureTimestamps[0] <= SKILLS_CIRCUIT_WINDOW_MS) break
    recentFailureTimestamps.shift()
  }
}

function recordFailure(timestampMs: number, isTimeout: boolean): boolean {
  metricsState.failureCount += 1
  if (isTimeout) {
    metricsState.timeoutCount += 1
  }

  recentFailureTimestamps.push(timestampMs)
  pruneFailures(timestampMs)
  if (recentFailureTimestamps.length >= SKILLS_CIRCUIT_THRESHOLD && timestampMs >= circuitOpenUntil) {
    circuitOpenUntil = timestampMs + SKILLS_CIRCUIT_OPEN_MS
    metricsState.circuitOpenCount += 1
    emitSkillsMcpTelemetry('circuit_open', {
      windowFailures: recentFailureTimestamps.length,
      openUntil: new Date(circuitOpenUntil).toISOString()
    })
    return true
  }
  return false
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new SkillsQueryTimeoutError(`skills query timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

function getCacheEntry<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number
): CacheEntry<T> | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (nowMs() - entry.updatedAt > ttlMs) return null
  return entry
}

function getStaleCacheEntry<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): CacheEntry<T> | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (nowMs() - entry.updatedAt > SKILLS_STALE_MAX_AGE_MS) return null
  return entry
}

function getMetadataCacheKey(workDir: string | undefined, query: string, limit: number): string {
  return `skills_list:${workDir || ''}:${query}:${limit}`
}

function getContentCacheKey(workDir: string | undefined, name: string, maxChars?: number): string {
  return `skills_get:${workDir || ''}:${name}:${maxChars || 0}`
}

async function runSkillsQueryWithResilience<T>(params: {
  cache: Map<string, CacheEntry<T>>
  cacheKey: string
  ttlMs: number
  run: () => Promise<T>
}): Promise<{ value: T; stale: boolean }> {
  const fresh = getCacheEntry(params.cache, params.cacheKey, params.ttlMs)
  if (fresh) {
    metricsState.cacheHitCount += 1
    maybeEmitMetricsSnapshot()
    return { value: fresh.value, stale: false }
  }

  metricsState.cacheMissCount += 1

  if (nowMs() < circuitOpenUntil) {
    const stale = getStaleCacheEntry(params.cache, params.cacheKey)
    if (stale) {
      metricsState.staleFallbackHitCount += 1
      emitSkillsMcpTelemetry('stale_fallback', {
        reason: 'circuit_open',
        cacheKey: params.cacheKey
      })
      return { value: stale.value, stale: true }
    }
    emitSkillsMcpTelemetry('circuit_open', {
      reason: 'reject_without_stale',
      cacheKey: params.cacheKey,
      openUntil: new Date(circuitOpenUntil).toISOString()
    })
    throw new SkillsCircuitOpenError('skills query circuit is open')
  }

  const startedAt = nowMs()
  metricsState.requestCount += 1
  try {
    const value = await withTimeout(params.run(), SKILLS_QUERY_TIMEOUT_MS)
    pushDurationSample(nowMs() - startedAt)
    params.cache.set(params.cacheKey, {
      value,
      updatedAt: nowMs()
    })
    maybeEmitMetricsSnapshot()
    return { value, stale: false }
  } catch (error) {
    pushDurationSample(nowMs() - startedAt)
    const timestampMs = nowMs()
    const isTimeout = error instanceof SkillsQueryTimeoutError
    recordFailure(timestampMs, isTimeout)
    const stale = getStaleCacheEntry(params.cache, params.cacheKey)
    if (stale) {
      metricsState.staleFallbackHitCount += 1
      emitSkillsMcpTelemetry('stale_fallback', {
        reason: isTimeout ? 'timeout' : 'query_error',
        cacheKey: params.cacheKey,
        errorCode: (error as { errorCode?: string })?.errorCode || null
      })
      return { value: stale.value, stale: true }
    }
    emitSkillsMcpTelemetry('query_error', {
      cacheKey: params.cacheKey,
      errorCode: (error as { errorCode?: string })?.errorCode || null,
      isTimeout
    })
    throw error
  }
}

function buildSkillsTools(workDir?: string) {
  const skills_list = tool(
    'skills_list',
    'List available skills (name + short description). Use query to filter.',
    {
      query: z.string().optional().describe('Optional case-insensitive filter on skill name/description'),
      limit: z.number().optional().describe('Max results to return (default: 50)')
    },
    async (args) => {
      const query = (args.query || '').trim().toLowerCase()
      const limit = Math.max(1, Math.min(200, args.limit ?? 50))
      const cacheKey = getMetadataCacheKey(workDir, query, limit)
      const queryResult = await runSkillsQueryWithResilience({
        cache: skillsMetadataCache,
        cacheKey,
        ttlMs: SKILLS_METADATA_CACHE_TTL_MS,
        // skills_list is an internal model-facing inventory tool.
        // Include internal-only skills to avoid empty listings for global skills.
        run: async () => listSkills(workDir, 'runtime-command-dependency')
      })
      const skills = queryResult.value

      const filtered = query.length === 0
        ? skills
        : skills.filter((s) => {
            const name = s.name.toLowerCase()
            const desc = (s.descriptionBase || '').toLowerCase()
            return name.includes(query) || desc.includes(query)
          })

      const sliced = filtered.slice(0, limit)
      const lines = sliced.map((s) => {
        const shortDescription = s.descriptionBase
        const desc = shortDescription ? ` - ${shortDescription}` : ''
        return `/${s.name}${desc}`
      })

      const header = `Skills (${sliced.length}/${filtered.length} shown)`
      const staleSuffix = queryResult.stale ? '\n[stale-cache-fallback]' : ''
      return {
        content: [{ type: 'text' as const, text: `${[header, ...lines].join('\n')}${staleSuffix}` }]
      }
    }
  )

  const skills_get = tool(
    'skills_get',
    'Get full SKILL.md content for a skill by name.',
    {
      name: z.string().describe('Skill name (directory name)'),
      maxChars: z.number().optional().describe('Optional max characters to return')
    },
    async (args) => {
      const cacheKey = getContentCacheKey(workDir, args.name, args.maxChars)
      const queryResult = await runSkillsQueryWithResilience({
        cache: skillsContentCache,
        cacheKey,
        ttlMs: SKILLS_CONTENT_CACHE_TTL_MS,
        run: async () => getSkillContent(args.name, workDir)
      })
      const content = queryResult.value
      if (!content) {
        return {
          content: [{ type: 'text' as const, text: `Skill not found: ${args.name}` }],
          isError: true
        }
      }

      let text = content.content
      if (args.maxChars && args.maxChars > 0 && text.length > args.maxChars) {
        text = text.slice(0, args.maxChars) + '\n\n[truncated]'
      }
      if (queryResult.stale) {
        text = `${text}\n\n[stale-cache-fallback]`
      }

      return {
        content: [{ type: 'text' as const, text }]
      }
    }
  )

  return [skills_list, skills_get]
}

/**
 * Create Skills SDK MCP Server (in-process)
 */
export function createSkillsMcpServer(workDir?: string) {
  return createSdkMcpServer({
    name: 'skills',
    version: '1.0.0',
    tools: buildSkillsTools(workDir)
  })
}
