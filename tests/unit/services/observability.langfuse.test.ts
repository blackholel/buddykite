import { beforeEach, describe, expect, it } from 'vitest'

import { saveConfig } from '../../../src/main/services/config.service'
import {
  _testOnly,
  finalizeAgentRunObservation,
  getAgentRunObservation,
  listAgentRunObservations,
  setAgentRunObservationProvider,
  startAgentRunObservation
} from '../../../src/main/services/observability'

function resetObservabilityConfig(): void {
  saveConfig({
    observability: {
      langfuse: {
        enabled: false,
        host: 'https://cloud.langfuse.com',
        publicKey: '',
        secretKey: '',
        sampleRate: 1,
        maskMode: 'summary_hash',
        devApiEnabled: false
      }
    }
  } as any)
}

describe('Langfuse observability service', () => {
  beforeEach(() => {
    _testOnly().reset()
    resetObservabilityConfig()
  })

  it('masking 应该不泄露原文', () => {
    const masked = _testOnly().maskUnknown('my-secret-text', 'summary_hash') as string

    expect(masked).not.toContain('my-secret-text')
    expect(masked).toContain('[masked len=14 sha256=')
  })

  it('sampling 应该具备可预测性', () => {
    const first = _testOnly().shouldSample('run-fixed-id', 0.37)
    const second = _testOnly().shouldSample('run-fixed-id', 0.37)

    expect(first).toBe(second)
    expect(_testOnly().shouldSample('run-any', 0)).toBe(false)
    expect(_testOnly().shouldSample('run-any', 1)).toBe(true)
  })

  it.each(['completed', 'stopped', 'error', 'no_text'] as const)(
    'trace lifecycle 在 %s 终态时应收口',
    (status) => {
      const runId = `run-${status}`
      const handle = startAgentRunObservation({
        sessionKey: 'space-1:conv-1',
        spaceId: 'space-1',
        conversationId: 'conv-1',
        runId,
        mode: 'code',
        message: 'hello',
        responseLanguage: 'zh-CN',
        imageCount: 0,
        fileContextCount: 0,
        thinkingEnabled: false
      })

      finalizeAgentRunObservation(handle, {
        status,
        terminalReason: status,
        provider: 'anthropic',
        model: 'claude-opus-4-5-20251101',
        finalContent: 'done',
        tokenUsage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalCostUsd: 0,
          contextWindow: 200000
        }
      })

      const summary = getAgentRunObservation(runId)
      expect(summary).not.toBeNull()
      expect(summary?.status).toBe(status)
      expect(summary?.terminalReason).toBe(status)
      expect(summary?.endedAt).toBeTruthy()
      expect(summary?.durationMs).toBeTypeOf('number')
    }
  )

  it('Langfuse runtime 不可用时也不能影响主流程', () => {
    saveConfig({
      observability: {
        langfuse: {
          enabled: true,
          devApiEnabled: true,
          publicKey: '',
          secretKey: ''
        }
      }
    } as any)

    const handle = startAgentRunObservation({
      sessionKey: 'space-2:conv-2',
      spaceId: 'space-2',
      conversationId: 'conv-2',
      runId: 'run-noop',
      mode: 'code',
      message: 'hello',
      responseLanguage: 'zh-CN',
      imageCount: 0,
      fileContextCount: 0,
      thinkingEnabled: false
    })

    expect(() => {
      finalizeAgentRunObservation(handle, {
        status: 'completed',
        terminalReason: 'completed',
        provider: 'anthropic',
        model: 'claude-opus-4-5-20251101',
        finalContent: 'done'
      })
    }).not.toThrow()

    const summary = getAgentRunObservation('run-noop')
    expect(summary).not.toBeNull()
    expect(summary?.sampled).toBe(false)

    const runs = listAgentRunObservations(10)
    expect(runs.some((item) => item.runId === 'run-noop')).toBe(true)
  })

  it('provider 额外上下文字段应写入 summary', () => {
    const handle = startAgentRunObservation({
      sessionKey: 'space-3:conv-3',
      spaceId: 'space-3',
      conversationId: 'conv-3',
      runId: 'run-provider-extra',
      mode: 'code',
      message: 'hello',
      responseLanguage: 'zh-CN',
      imageCount: 0,
      fileContextCount: 0,
      thinkingEnabled: false
    })

    setAgentRunObservationProvider(handle, {
      provider: 'openai',
      model: 'gpt-5-codex',
      providerId: 'openai-codex',
      authMethod: 'oauth',
      accountId: 'acct-123',
      tokenSource: 'credential',
      refreshState: 'performed',
      killSwitch: false
    })

    finalizeAgentRunObservation(handle, {
      status: 'completed',
      terminalReason: 'completed',
      provider: 'openai',
      model: 'gpt-5-codex',
      finalContent: 'done'
    })

    const summary = getAgentRunObservation('run-provider-extra')
    expect(summary?.providerId).toBe('openai-codex')
    expect(summary?.authMethod).toBe('oauth')
    expect(summary?.accountId).toBe('acct-123')
    expect(summary?.tokenSource).toBe('credential')
    expect(summary?.refreshState).toBe('performed')
    expect(summary?.killSwitch).toBe(false)
  })
})
