export const WIDGET_STABILITY_EVENT_TYPES = [
  'widget_ready',
  'widget_update_sent',
  'widget_finalize_sent',
  'widget_resize_recv',
  'widget_theme_sent',
  'widget_error_recv',
  'widget_link_open'
] as const

export type WidgetStabilityEventType = (typeof WIDGET_STABILITY_EVENT_TYPES)[number]

export interface WidgetStabilityEvent {
  timestamp: string
  runId: string
  conversationId: string
  widgetKey: string
  instanceId: string
  seq: number
  eventType: WidgetStabilityEventType
  isPartial: boolean
  latencyMs: number
  errorCode: string | null
  meta: Record<string, unknown>
}

export interface Phase0BaselineReport {
  environment: {
    os: string
    appVersion: string
    collectedAt: string
  }
  rounds: Array<{
    round: number
    totalCases: number
    parsedEventCoverage: number
    finalizeSuccessRate: number
    widgetErrorRate: number
    firstResizeSuccessRate: number
    themeSyncSuccessRate: number
    flickerIncidentCount: number
  }>
}

interface WidgetStabilityEmitterOptions {
  now?: () => number
  sink?: (event: WidgetStabilityEvent) => void
}

interface WidgetStabilityEmitterContext {
  runId?: string | null
  conversationId?: string | null
  widgetKey?: string | null
  instanceId: string
}

interface WidgetStabilityEmitInput {
  eventType: WidgetStabilityEventType
  isPartial: boolean
  latencyMs?: number
  errorCode?: string | null
  meta?: Record<string, unknown>
}

const GLOBAL_WIDGET_EVENTS_KEY = '__KITE_WIDGET_STABILITY_EVENTS__'
const MAX_STORED_WIDGET_EVENTS = 1000

function defaultSink(event: WidgetStabilityEvent): void {
  try {
    const globalScope = globalThis as Record<string, unknown>
    const existing = globalScope[GLOBAL_WIDGET_EVENTS_KEY]
    const list = Array.isArray(existing) ? (existing as WidgetStabilityEvent[]) : []
    list.push(event)
    if (list.length > MAX_STORED_WIDGET_EVENTS) {
      list.splice(0, list.length - MAX_STORED_WIDGET_EVENTS)
    }
    globalScope[GLOBAL_WIDGET_EVENTS_KEY] = list
  } catch {
    // Ignore sink errors from non-browser runtimes
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('kite:widget-stability', { detail: event }))
  }
  console.log('[telemetry] widget_stability', JSON.stringify(event))
}

export function createWidgetStabilityEmitter(
  context: WidgetStabilityEmitterContext,
  options: WidgetStabilityEmitterOptions = {}
): {
  emit: (input: WidgetStabilityEmitInput) => WidgetStabilityEvent | null
} {
  const now = options.now || Date.now
  const sink = options.sink || defaultSink
  const startedAt = now()
  let seq = 0

  const runId = typeof context.runId === 'string' ? context.runId.trim() : ''
  const conversationId =
    typeof context.conversationId === 'string' && context.conversationId.trim().length > 0
      ? context.conversationId.trim()
      : 'unknown'
  const widgetKey =
    typeof context.widgetKey === 'string' && context.widgetKey.trim().length > 0
      ? context.widgetKey.trim()
      : 'unknown'

  return {
    emit(input: WidgetStabilityEmitInput): WidgetStabilityEvent | null {
      if (!runId) return null

      seq += 1
      const timestampMs = now()
      const event: WidgetStabilityEvent = {
        timestamp: new Date(timestampMs).toISOString(),
        runId,
        conversationId,
        widgetKey,
        instanceId: context.instanceId,
        seq,
        eventType: input.eventType,
        isPartial: input.isPartial,
        latencyMs:
          typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)
            ? Math.max(0, input.latencyMs)
            : Math.max(0, timestampMs - startedAt),
        errorCode: input.errorCode || null,
        meta: input.meta || {}
      }
      sink(event)
      return event
    }
  }
}

