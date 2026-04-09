import { createHash } from 'crypto'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import {
  setLangfuseTracerProvider,
  startObservation,
  type LangfuseSpan
} from '@langfuse/tracing'
import { getConfig } from '../config.service'
import type { LangfuseMaskMode } from '../../../shared/types/observability'
import type {
  AgentRunObservationHandle,
  AgentRunObservationStartInput,
  AgentRunObservationFinalizeInput,
  ObservabilityPhase,
  ObservabilityRunSummary,
  ObservabilityToolSummary
} from './types'

interface PhaseState {
  startedAtMs: number
  span: LangfuseSpan | null
  ended: boolean
}

interface InternalRunContext {
  handle: AgentRunObservationHandle
  sampled: boolean
  rootSpan: LangfuseSpan | null
  startedAtMs: number
  phases: Map<ObservabilityPhase, PhaseState>
  summary: ObservabilityRunSummary
}

interface RuntimeState {
  signature: string | null
  provider: BasicTracerProvider | null
  enabled: boolean
  host: string
  sampleRate: number
  maskMode: LangfuseMaskMode
}

const MAX_RUN_HISTORY = 500

const runtimeState: RuntimeState = {
  signature: null,
  provider: null,
  enabled: false,
  host: 'https://cloud.langfuse.com',
  sampleRate: 1,
  maskMode: 'summary_hash'
}

const runContexts = new Map<string, InternalRunContext>()
const runSummaryById = new Map<string, ObservabilityRunSummary>()
const runSummaryOrder: string[] = []

function nowIso(): string {
  return new Date().toISOString()
}

function toRunKey(sessionKey: string, runId: string): string {
  return `${sessionKey}:${runId}`
}

function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, '')
}

function maskText(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 16)
  return `[masked len=${value.length} sha256=${hash}]`
}

function summarizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return {
      length: value.length,
      sha256: createHash('sha256').update(value).digest('hex')
    }
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length
    }
  }
  if (value && typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value as Record<string, unknown>).sort()
    }
  }
  return value
}

function maskUnknown(value: unknown, mode: LangfuseMaskMode, depth = 0): unknown {
  if (mode === 'off') return value
  if (value == null) return value
  if (depth > 5) return '[masked depth-limit]'

  if (typeof value === 'string') {
    return maskText(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskUnknown(item, mode, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskUnknown(item, mode, depth + 1)
    }
    return out
  }
  return `[masked ${typeof value}]`
}

function shouldSample(runId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  const hex = createHash('sha1').update(runId).digest('hex').slice(0, 8)
  const n = Number.parseInt(hex, 16)
  const max = 0xffffffff
  return n / max < sampleRate
}

function getLangfuseConfig() {
  const langfuse = getConfig().observability?.langfuse
  return {
    enabled: langfuse?.enabled === true,
    host: normalizeHost(langfuse?.host || 'https://cloud.langfuse.com'),
    publicKey: (langfuse?.publicKey || '').trim(),
    secretKey: (langfuse?.secretKey || '').trim(),
    sampleRate:
      typeof langfuse?.sampleRate === 'number' && Number.isFinite(langfuse.sampleRate)
        ? Math.min(1, Math.max(0, langfuse.sampleRate))
        : 1,
    maskMode: langfuse?.maskMode === 'off' ? 'off' as const : 'summary_hash' as const,
    devApiEnabled: langfuse?.devApiEnabled === true
  }
}

function upsertSummary(summary: ObservabilityRunSummary): void {
  const had = runSummaryById.has(summary.runId)
  runSummaryById.set(summary.runId, summary)
  if (!had) {
    runSummaryOrder.push(summary.runId)
  }

  while (runSummaryOrder.length > MAX_RUN_HISTORY) {
    const oldest = runSummaryOrder.shift()
    if (oldest) {
      runSummaryById.delete(oldest)
    }
  }
}

async function destroyRuntime(): Promise<void> {
  const provider = runtimeState.provider
  runtimeState.provider = null
  runtimeState.signature = null
  runtimeState.enabled = false
  setLangfuseTracerProvider(null)

  if (!provider) {
    return
  }

  try {
    await provider.forceFlush()
  } catch (error) {
    console.warn('[Observability] provider.forceFlush failed during destroy', error)
  }
  try {
    await provider.shutdown()
  } catch (error) {
    console.warn('[Observability] provider.shutdown failed during destroy', error)
  }
}

function ensureRuntime(): RuntimeState {
  const config = getLangfuseConfig()
  const signature = `${config.host}|${config.publicKey}|${config.secretKey}|${config.maskMode}`
  const enabled = config.enabled && config.publicKey.length > 0 && config.secretKey.length > 0

  runtimeState.host = config.host
  runtimeState.sampleRate = config.sampleRate
  runtimeState.maskMode = config.maskMode

  if (!enabled) {
    if (runtimeState.provider) {
      void destroyRuntime()
    } else {
      runtimeState.enabled = false
      runtimeState.signature = null
    }
    return runtimeState
  }

  if (runtimeState.provider && runtimeState.signature === signature) {
    runtimeState.enabled = true
    return runtimeState
  }

  if (runtimeState.provider) {
    void destroyRuntime()
  }

  try {
    const processor = new LangfuseSpanProcessor({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.host,
      environment: 'buddykite-main',
      mask: ({ data }) => maskUnknown(data, config.maskMode)
    })
    const provider = new BasicTracerProvider({
      spanProcessors: [processor]
    })
    setLangfuseTracerProvider(provider)

    runtimeState.provider = provider
    runtimeState.signature = signature
    runtimeState.enabled = true
  } catch (error) {
    runtimeState.provider = null
    runtimeState.signature = null
    runtimeState.enabled = false
    console.error('[Observability] Failed to initialize Langfuse runtime:', error)
  }

  return runtimeState
}

function buildToolSummary(toolsById?: Map<string, { status?: string }>): ObservabilityToolSummary {
  const summary: ObservabilityToolSummary = {
    total: 0,
    success: 0,
    error: 0,
    running: 0,
    waitingApproval: 0,
    cancelled: 0
  }
  if (!toolsById) return summary

  for (const tool of toolsById.values()) {
    summary.total += 1
    if (tool.status === 'success') summary.success += 1
    else if (tool.status === 'error') summary.error += 1
    else if (tool.status === 'running' || tool.status === 'pending') summary.running += 1
    else if (tool.status === 'waiting_approval') summary.waitingApproval += 1
    else if (tool.status === 'cancelled') summary.cancelled += 1
  }

  return summary
}

function getRunContext(handle: AgentRunObservationHandle): InternalRunContext | null {
  return runContexts.get(toRunKey(handle.sessionKey, handle.runId)) || null
}

function safeUpdateSpan(
  span: LangfuseSpan | null,
  payload: {
    metadata?: Record<string, unknown>
    input?: unknown
    output?: unknown
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR'
  }
): void {
  if (!span) return
  try {
    span.update(payload)
  } catch (error) {
    console.warn('[Observability] span.update failed:', error)
  }
}

function safeEndSpan(span: LangfuseSpan | null, endAtMs: number): void {
  if (!span) return
  try {
    span.end(new Date(endAtMs))
  } catch (error) {
    console.warn('[Observability] span.end failed:', error)
  }
}

export function startAgentRunObservation(
  input: AgentRunObservationStartInput
): AgentRunObservationHandle {
  const runtime = ensureRuntime()
  const handle: AgentRunObservationHandle = {
    sessionKey: input.sessionKey,
    spaceId: input.spaceId,
    conversationId: input.conversationId,
    runId: input.runId
  }

  const startedAtMs = Date.now()
  const sampled = runtime.enabled && shouldSample(input.runId, runtime.sampleRate)
  const summary: ObservabilityRunSummary = {
    sessionKey: input.sessionKey,
    spaceId: input.spaceId,
    conversationId: input.conversationId,
    runId: input.runId,
    mode: input.mode,
    provider: '',
    model: '',
    sampled,
    enabled: runtime.enabled,
    status: sampled ? 'running' : 'dropped',
    startedAt: new Date(startedAtMs).toISOString(),
    phaseDurationsMs: {},
    traceHost: runtime.host
  }

  let rootSpan: LangfuseSpan | null = null
  if (sampled) {
    try {
      rootSpan = startObservation(
        'agent.run',
        {
          input: {
            message: summarizeUnknown(input.message),
            responseLanguage: input.responseLanguage,
            imageCount: input.imageCount,
            fileContextCount: input.fileContextCount,
            thinkingEnabled: input.thinkingEnabled
          },
          metadata: {
            spaceId: input.spaceId,
            conversationId: input.conversationId,
            sessionKey: input.sessionKey,
            runId: input.runId,
            mode: input.mode
          }
        },
        { startTime: new Date(startedAtMs) }
      )
      summary.traceId = rootSpan.traceId
      summary.rootObservationId = rootSpan.id
    } catch (error) {
      summary.sampled = false
      summary.status = 'dropped'
      console.error('[Observability] Failed to create root observation:', error)
    }
  }

  runContexts.set(toRunKey(handle.sessionKey, handle.runId), {
    handle,
    sampled: summary.sampled,
    rootSpan,
    startedAtMs,
    phases: new Map(),
    summary
  })
  upsertSummary(summary)
  return handle
}

export function setAgentRunObservationProvider(
  handle: AgentRunObservationHandle,
  payload: {
    provider: string
    model: string
    providerId?: string
    authMethod?: string
    accountId?: string
    tokenSource?: string
    refreshState?: string
    killSwitch?: boolean
  }
): void {
  const context = getRunContext(handle)
  if (!context) return

  context.summary.provider = payload.provider
  context.summary.model = payload.model
  if (payload.providerId) context.summary.providerId = payload.providerId
  if (payload.authMethod) context.summary.authMethod = payload.authMethod
  if (payload.accountId) context.summary.accountId = payload.accountId
  if (payload.tokenSource) context.summary.tokenSource = payload.tokenSource
  if (payload.refreshState) context.summary.refreshState = payload.refreshState
  if (typeof payload.killSwitch === 'boolean') context.summary.killSwitch = payload.killSwitch
  upsertSummary(context.summary)

  safeUpdateSpan(context.rootSpan, {
    metadata: {
      provider: payload.provider,
      model: payload.model,
      providerId: payload.providerId,
      authMethod: payload.authMethod,
      accountId: payload.accountId,
      tokenSource: payload.tokenSource,
      refreshState: payload.refreshState,
      killSwitch: payload.killSwitch
    }
  })
}

export function startAgentRunObservationPhase(
  handle: AgentRunObservationHandle,
  phase: ObservabilityPhase,
  startAtMs: number = Date.now(),
  metadata?: Record<string, unknown>
): void {
  const context = getRunContext(handle)
  if (!context) return
  const existing = context.phases.get(phase)
  if (existing && !existing.ended) return

  let span: LangfuseSpan | null = null
  if (context.sampled && context.rootSpan) {
    try {
      span = context.rootSpan.startObservation(
        `agent.${phase}`,
        {
          metadata: {
            ...metadata,
            phase,
            runId: handle.runId
          }
        },
        { startTime: new Date(startAtMs) }
      )
    } catch (error) {
      console.warn(`[Observability] Failed to start phase span: ${phase}`, error)
    }
  }

  context.phases.set(phase, {
    startedAtMs: startAtMs,
    span,
    ended: false
  })
}

export function endAgentRunObservationPhase(
  handle: AgentRunObservationHandle,
  phase: ObservabilityPhase,
  options?: {
    endAtMs?: number
    metadata?: Record<string, unknown>
    output?: unknown
  }
): void {
  const context = getRunContext(handle)
  if (!context) return
  const state = context.phases.get(phase)
  if (!state || state.ended) return

  const endAtMs = options?.endAtMs ?? Date.now()
  const durationMs = Math.max(0, endAtMs - state.startedAtMs)
  state.ended = true
  context.summary.phaseDurationsMs[phase] = durationMs
  if (phase === 'first_token') {
    context.summary.ttftMs = durationMs
  }
  upsertSummary(context.summary)

  safeUpdateSpan(state.span, {
    output: options?.output !== undefined ? summarizeUnknown(options.output) : { durationMs },
    metadata: {
      ...(options?.metadata || {}),
      durationMs
    }
  })
  safeEndSpan(state.span, endAtMs)
}

export function markAgentRunFirstToken(
  handle: AgentRunObservationHandle,
  params: {
    sendResolvedAtMs: number
    firstTokenAtMs: number
    firstEventType: string
  }
): void {
  const context = getRunContext(handle)
  if (!context || context.summary.ttftMs !== undefined) return

  startAgentRunObservationPhase(handle, 'first_token', params.sendResolvedAtMs, {
    firstEventType: params.firstEventType
  })
  endAgentRunObservationPhase(handle, 'first_token', {
    endAtMs: params.firstTokenAtMs,
    metadata: { firstEventType: params.firstEventType }
  })
}

export function finalizeAgentRunObservation(
  handle: AgentRunObservationHandle,
  input: AgentRunObservationFinalizeInput
): void {
  const context = getRunContext(handle)
  if (!context) return

  const finalizedAtMs = Date.now()

  startAgentRunObservationPhase(handle, 'finalize', finalizedAtMs)
  endAgentRunObservationPhase(handle, 'finalize', { endAtMs: finalizedAtMs })

  for (const [phase, state] of context.phases.entries()) {
    if (!state.ended) {
      endAgentRunObservationPhase(handle, phase, { endAtMs: finalizedAtMs })
    }
  }

  const durationMs = Math.max(0, finalizedAtMs - context.startedAtMs)
  const toolSummary = buildToolSummary(input.toolsById)
  context.summary.status = input.status
  context.summary.provider = input.provider
  context.summary.model = input.model
  context.summary.endedAt = new Date(finalizedAtMs).toISOString()
  context.summary.durationMs = durationMs
  context.summary.tokenUsage = input.tokenUsage || undefined
  context.summary.toolSummary = toolSummary
  context.summary.terminalReason = input.terminalReason
  if (input.errorMessage) {
    context.summary.errorMessage = input.errorMessage
  }
  upsertSummary(context.summary)

  safeUpdateSpan(context.rootSpan, {
    output: {
      terminalReason: input.terminalReason,
      finalContent: summarizeUnknown(input.finalContent || ''),
      tokenUsage: input.tokenUsage || null,
      toolSummary,
      durationMs,
      ttftMs: context.summary.ttftMs
    },
    metadata: {
      provider: input.provider,
      model: input.model,
      terminalReason: input.terminalReason,
      status: input.status,
      errorMessage: input.errorMessage || null
    },
    level: input.status === 'error' ? 'ERROR' : 'DEFAULT'
  })
  safeEndSpan(context.rootSpan, finalizedAtMs)

  runContexts.delete(toRunKey(handle.sessionKey, handle.runId))
}

export function getAgentRunObservation(runId: string): ObservabilityRunSummary | null {
  return runSummaryById.get(runId) || null
}

export function listAgentRunObservations(limit = 50): ObservabilityRunSummary[] {
  const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50
  const ids = runSummaryOrder.slice(-cappedLimit).reverse()
  return ids
    .map((id) => runSummaryById.get(id))
    .filter((item): item is ObservabilityRunSummary => Boolean(item))
}

export function isObservabilityInternalApiEnabled(): boolean {
  const config = getLangfuseConfig()
  return config.enabled && config.devApiEnabled
}

export function getObservabilityConfigSnapshot(): {
  enabled: boolean
  devApiEnabled: boolean
  host: string
  sampleRate: number
  maskMode: LangfuseMaskMode
  hasPublicKey: boolean
  hasSecretKey: boolean
} {
  const config = getLangfuseConfig()
  return {
    enabled: config.enabled,
    devApiEnabled: config.devApiEnabled,
    host: config.host,
    sampleRate: config.sampleRate,
    maskMode: config.maskMode,
    hasPublicKey: config.publicKey.length > 0,
    hasSecretKey: config.secretKey.length > 0
  }
}

export async function refreshObservabilityRuntime(): Promise<void> {
  ensureRuntime()
}

export async function shutdownObservability(): Promise<void> {
  await destroyRuntime()
}

export function _testOnly() {
  return {
    maskUnknown,
    shouldSample,
    reset(): void {
      runContexts.clear()
      runSummaryById.clear()
      runSummaryOrder.length = 0
      runtimeState.signature = null
      runtimeState.enabled = false
      runtimeState.host = 'https://cloud.langfuse.com'
      runtimeState.sampleRate = 1
      runtimeState.maskMode = 'summary_hash'
      runtimeState.provider = null
      setLangfuseTracerProvider(null)
    }
  }
}
