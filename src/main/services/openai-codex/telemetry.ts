interface OpenAICodexTelemetrySnapshot {
  providerResolve: {
    total: number
    experimentActive: number
    killSwitchOn: number
  }
  tokenRefresh: {
    total: number
    attempted: number
    success: number
    invalidGrant: number
    failed: number
    fallback: number
    noRefreshNeeded: number
  }
}

type OpenAICodexTelemetryEvent =
  | {
      type: 'provider_resolve'
      experimentActive: boolean
      killSwitch: boolean
    }
  | {
      type: 'token_refresh'
      status: 'attempted' | 'success' | 'invalid_grant' | 'failed' | 'fallback' | 'not_needed'
      accountId?: string
    }

const telemetry: OpenAICodexTelemetrySnapshot = {
  providerResolve: {
    total: 0,
    experimentActive: 0,
    killSwitchOn: 0
  },
  tokenRefresh: {
    total: 0,
    attempted: 0,
    success: 0,
    invalidGrant: 0,
    failed: 0,
    fallback: 0,
    noRefreshNeeded: 0
  }
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|api.?key|secret/i.test(key)
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[redacted]'
      continue
    }
    sanitized[key] = value
  }
  return sanitized
}

export function recordOpenAICodexTelemetry(event: OpenAICodexTelemetryEvent): void {
  if (event.type === 'provider_resolve') {
    telemetry.providerResolve.total += 1
    if (event.experimentActive) telemetry.providerResolve.experimentActive += 1
    if (event.killSwitch) telemetry.providerResolve.killSwitchOn += 1

    console.info(
      '[OpenAICodex][Telemetry] provider_resolve',
      sanitizePayload({
        experimentActive: event.experimentActive,
        killSwitch: event.killSwitch
      })
    )
    return
  }

  telemetry.tokenRefresh.total += 1
  if (event.status === 'attempted') telemetry.tokenRefresh.attempted += 1
  if (event.status === 'success') telemetry.tokenRefresh.success += 1
  if (event.status === 'invalid_grant') telemetry.tokenRefresh.invalidGrant += 1
  if (event.status === 'failed') telemetry.tokenRefresh.failed += 1
  if (event.status === 'fallback') telemetry.tokenRefresh.fallback += 1
  if (event.status === 'not_needed') telemetry.tokenRefresh.noRefreshNeeded += 1

  console.info(
    '[OpenAICodex][Telemetry] token_refresh',
    sanitizePayload({
      status: event.status,
      accountId: event.accountId || null
    })
  )
}

export function getOpenAICodexTelemetrySnapshot(): OpenAICodexTelemetrySnapshot {
  return {
    providerResolve: { ...telemetry.providerResolve },
    tokenRefresh: { ...telemetry.tokenRefresh }
  }
}

export function _testResetOpenAICodexTelemetry(): void {
  telemetry.providerResolve.total = 0
  telemetry.providerResolve.experimentActive = 0
  telemetry.providerResolve.killSwitchOn = 0
  telemetry.tokenRefresh.total = 0
  telemetry.tokenRefresh.attempted = 0
  telemetry.tokenRefresh.success = 0
  telemetry.tokenRefresh.invalidGrant = 0
  telemetry.tokenRefresh.failed = 0
  telemetry.tokenRefresh.fallback = 0
  telemetry.tokenRefresh.noRefreshNeeded = 0
}
