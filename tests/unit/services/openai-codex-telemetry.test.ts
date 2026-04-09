import { beforeEach, describe, expect, it } from 'vitest'

import {
  _testResetOpenAICodexTelemetry,
  getOpenAICodexTelemetrySnapshot,
  recordOpenAICodexTelemetry
} from '../../../src/main/services/openai-codex/telemetry'

describe('openai-codex.telemetry', () => {
  beforeEach(() => {
    _testResetOpenAICodexTelemetry()
  })

  it('provider_resolve 与 token_refresh 计数应正确累计', () => {
    recordOpenAICodexTelemetry({
      type: 'provider_resolve',
      experimentActive: true,
      killSwitch: false
    })
    recordOpenAICodexTelemetry({
      type: 'provider_resolve',
      experimentActive: false,
      killSwitch: true
    })
    recordOpenAICodexTelemetry({
      type: 'token_refresh',
      status: 'attempted',
      accountId: 'acct-1'
    })
    recordOpenAICodexTelemetry({
      type: 'token_refresh',
      status: 'success',
      accountId: 'acct-1'
    })
    recordOpenAICodexTelemetry({
      type: 'token_refresh',
      status: 'invalid_grant',
      accountId: 'acct-1'
    })

    const snapshot = getOpenAICodexTelemetrySnapshot()
    expect(snapshot.providerResolve.total).toBe(2)
    expect(snapshot.providerResolve.experimentActive).toBe(1)
    expect(snapshot.providerResolve.killSwitchOn).toBe(1)
    expect(snapshot.tokenRefresh.total).toBe(3)
    expect(snapshot.tokenRefresh.attempted).toBe(1)
    expect(snapshot.tokenRefresh.success).toBe(1)
    expect(snapshot.tokenRefresh.invalidGrant).toBe(1)
  })
})
