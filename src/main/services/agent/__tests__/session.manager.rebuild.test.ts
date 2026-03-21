import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}))

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({})),
  onApiConfigChange: vi.fn()
}))

vi.mock('../../conversation.service', () => ({
  getConversation: vi.fn(() => null),
  clearSessionId: vi.fn()
}))

vi.mock('../electron-path', () => ({
  getHeadlessElectronPath: vi.fn(() => '/tmp/electron')
}))

vi.mock('../provider-resolver', () => ({
  resolveProvider: vi.fn()
}))

vi.mock('../ai-config-resolver', () => ({
  resolveEffectiveConversationAi: vi.fn()
}))

vi.mock('../sdk-config.builder', () => ({
  buildSdkOptions: vi.fn(),
  getWorkingDir: vi.fn(),
  getEffectiveSkillsLazyLoad: vi.fn(() => ({ effectiveLazyLoad: false, toolkit: [] }))
}))

vi.mock('../renderer-comm', () => ({
  createCanUseTool: vi.fn()
}))

vi.mock('../../plugin-mcp.service', () => ({
  getEnabledPluginMcpHash: vi.fn(() => 'mcp-hash'),
  getEnabledPluginMcpList: vi.fn(() => [])
}))

vi.mock('../../resource-index.service', () => ({
  getResourceIndexHash: vi.fn(() => 'resource-hash')
}))

vi.mock('../../chrome-debug-launcher.service', () => ({
  ensureChromeDebugModeReadyForMcp: vi.fn().mockResolvedValue(undefined),
  forceChromeDevtoolsUseBrowserUrl: vi.fn((options) => options)
}))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { ensureChromeDebugModeReadyForMcp } from '../../chrome-debug-launcher.service'
import { getConfig, onApiConfigChange } from '../../config.service'
import { clearSessionId, getConversation } from '../../conversation.service'
import { resolveEffectiveConversationAi } from '../ai-config-resolver'
import { resolveProvider } from '../provider-resolver'
import { buildSdkOptions, getWorkingDir } from '../sdk-config.builder'
import {
  acquireSessionWithResumeFallback,
  classifyResumeError,
  closeAllV2Sessions,
  closeV2Session,
  deleteActiveSession,
  ensureSessionWarm,
  getOrCreateV2Session,
  setActiveSession,
  touchV2Session
} from '../session.manager'
import type { SessionConfig, SessionState } from '../types'

const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000
const apiConfigChangeHandler = vi.mocked(onApiConfigChange).mock.calls.at(-1)?.[0] as (() => void) | undefined

function createRunningSessionState(conversationId: string): SessionState {
  return {
    abortController: new AbortController(),
    spaceId: 'space-1',
    conversationId,
    runId: `run-${conversationId}`,
    runEpoch: 1,
    eventSeq: 0,
    mode: 'code',
    startedAt: Date.now(),
    latestAssistantContent: '',
    lifecycle: 'running',
    terminalReason: null,
    terminalAt: null,
    finalized: false,
    toolCallSeq: 0,
    toolsById: new Map(),
    askUserQuestionModeByToolCallId: new Map(),
    pendingPermissionResolve: null,
    pendingAskUserQuestionsById: new Map(),
    pendingAskUserQuestionOrder: [],
    pendingAskUserQuestionIdByToolCallId: new Map(),
    unmatchedAskUserQuestionToolCalls: new Map(),
    askUserQuestionSeq: 0,
    recentlyResolvedAskUserQuestionByToolCallId: new Map(),
    askUserQuestionUsedInRun: false,
    textClarificationFallbackUsedInConversation: false,
    textClarificationDetectedInRun: false,
    thoughts: [],
    processTrace: []
  }
}

function createQueryMock(overrides?: {
  close?: ReturnType<typeof vi.fn>
  initializationResult?: ReturnType<typeof vi.fn>
}): any {
  const close = overrides?.close ?? vi.fn()
  const initializationResult = overrides?.initializationResult ?? vi.fn().mockResolvedValue({})

  return {
    initializationResult,
    [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: true, value: undefined })
    }),
    close,
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
    toggleMcpServer: vi.fn().mockResolvedValue(undefined)
  }
}

describe('session.manager rebuild', () => {
  const closeFirst = vi.fn()
  const closeSecond = vi.fn()

  beforeEach(() => {
    vi.mocked(query)
      .mockReturnValueOnce(createQueryMock({ close: closeFirst }))
      .mockReturnValueOnce(createQueryMock({ close: closeSecond }))
  })

  afterEach(() => {
    closeAllV2Sessions()
    vi.clearAllMocks()
  })

  it('配置不变复用 session，配置变化触发重建', async () => {
    const configA: SessionConfig = {
      skillsLazyLoad: false,
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    const configB: SessionConfig = {
      ...configA,
      effectiveModel: 'model-b'
    }

    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configA)
    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configA)
    await getOrCreateV2Session('space-1', 'conv-1', {}, undefined, configB)

    expect(query).toHaveBeenCalledTimes(2)
    expect(closeFirst).toHaveBeenCalledTimes(1)
    expect(closeSecond).not.toHaveBeenCalled()
  })

  it('MCP server 集合变化时触发 session 重建（避免复用旧提示词/工具）', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockReturnValueOnce(createQueryMock({ close: closeA }))
      .mockReturnValueOnce(createQueryMock({ close: closeB }))

    const base: SessionConfig = {
      skillsLazyLoad: false,
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      enabledMcpServersHash: '',
      hasCanUseTool: true
    }

    await getOrCreateV2Session('space-1', 'conv-mcp', {}, undefined, base)
    await getOrCreateV2Session('space-1', 'conv-mcp', {}, undefined, {
      ...base,
      enabledMcpServersHash: 'codepilot-widget'
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('resourceIndexHash 高频变化时触发防抖，避免连续重建', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    const closeC = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockReturnValueOnce(createQueryMock({ close: closeA }))
      .mockReturnValueOnce(createQueryMock({ close: closeB }))
      .mockReturnValueOnce(createQueryMock({ close: closeC }))

    const base: SessionConfig = {
      skillsLazyLoad: false,
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    await getOrCreateV2Session('space-1', 'conv-2', {}, undefined, {
      ...base,
      resourceIndexHash: 'hash-1'
    })
    await getOrCreateV2Session('space-1', 'conv-2', {}, undefined, {
      ...base,
      resourceIndexHash: 'hash-2'
    })
    await getOrCreateV2Session('space-1', 'conv-2', {}, undefined, {
      ...base,
      resourceIndexHash: 'hash-3'
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
    expect(closeC).not.toHaveBeenCalled()
  })

  it('仅 responseLanguage 变化时也会触发 session 重建', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockReturnValueOnce(createQueryMock({ close: closeA }))
      .mockReturnValueOnce(createQueryMock({ close: closeB }))

    const base: SessionConfig = {
      skillsLazyLoad: false,
      responseLanguage: 'en',
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    await getOrCreateV2Session('space-1', 'conv-lang', {}, undefined, base)
    await getOrCreateV2Session('space-1', 'conv-lang', {}, undefined, {
      ...base,
      responseLanguage: 'zh-CN'
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('slashRuntimeMode 变化时会触发 session 重建', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockReturnValueOnce(createQueryMock({ close: closeA }))
      .mockReturnValueOnce(createQueryMock({ close: closeB }))

    const base: SessionConfig = {
      skillsLazyLoad: false,
      responseLanguage: 'en',
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      slashRuntimeMode: 'native',
      hasCanUseTool: true
    }

    await getOrCreateV2Session('space-1', 'conv-slash-mode', {}, undefined, base)
    await getOrCreateV2Session('space-1', 'conv-slash-mode', {}, undefined, {
      ...base,
      slashRuntimeMode: 'legacy-inject'
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('API 配置变化时仅回收非运行会话，运行中会话延后切换', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockReturnValueOnce(createQueryMock({ close: closeA }))
      .mockReturnValueOnce(createQueryMock({ close: closeB }))

    const config: SessionConfig = {
      skillsLazyLoad: false,
      responseLanguage: 'en',
      profileId: 'profile-a',
      providerSignature: 'sig-a',
      effectiveModel: 'model-a',
      enabledPluginMcpsHash: 'mcp-1',
      hasCanUseTool: true
    }

    await getOrCreateV2Session('space-1', 'conv-running', {}, undefined, config)
    await getOrCreateV2Session('space-1', 'conv-idle', {}, undefined, config)
    setActiveSession('space-1', 'conv-running', createRunningSessionState('conv-running'))

    expect(apiConfigChangeHandler).toBeTypeOf('function')
    apiConfigChangeHandler?.()

    expect(closeA).not.toHaveBeenCalled()
    expect(closeB).toHaveBeenCalledTimes(1)

    deleteActiveSession('space-1', 'conv-running')
  })

  it('warmup 对缺少 scope 的旧 sessionId 不做 resume，并清理持久化 sessionId', async () => {
    const close = vi.fn()
    vi.mocked(query).mockReset().mockReturnValueOnce(createQueryMock({ close }))
    vi.mocked(getWorkingDir).mockReturnValue('/workspace/project')
    vi.mocked(getConversation).mockReturnValue({
      id: 'conv-warm',
      spaceId: 'space-1',
      sessionId: 'legacy-session-id',
      ai: { profileId: 'profile-a' }
    } as any)
    vi.mocked(resolveEffectiveConversationAi).mockReturnValue({
      profileId: 'profile-a',
      profile: {
        id: 'profile-a',
        vendor: 'anthropic',
        protocol: 'anthropic_official'
      },
      effectiveModel: 'claude-test',
      providerSignature: 'provider-signature',
      disableToolsForCompat: false
    } as any)
    vi.mocked(resolveProvider).mockResolvedValue({
      anthropicApiKey: 'test-key',
      anthropicBaseUrl: 'https://api.anthropic.com',
      sdkModel: 'claude-test',
      effectiveModel: 'claude-test',
      useAnthropicCompatModelMapping: false
    } as any)
    vi.mocked(buildSdkOptions).mockReturnValue({
      cwd: '/workspace/project'
    } as any)

    await ensureSessionWarm('space-1', 'conv-warm', 'en')

    expect(clearSessionId).toHaveBeenCalledWith('space-1', 'conv-warm')
    expect(query).toHaveBeenCalledTimes(1)
    const createArgs = vi.mocked(query).mock.calls[0]?.[0] as Record<string, unknown>
    expect((createArgs?.options as Record<string, unknown> | undefined)?.resume).toBeUndefined()
  })

  it('scope 不匹配时会清理旧 sessionId 并直接新建', async () => {
    const close = vi.fn()
    vi.mocked(query).mockReset().mockReturnValueOnce(createQueryMock({ close }))

    const result = await acquireSessionWithResumeFallback({
      spaceId: 'space-1',
      conversationId: 'conv-scope-mismatch',
      sdkOptions: {},
      persistedSessionId: 'legacy-session-id',
      persistedSessionScope: { spaceId: 'space-other', workDir: '/workspace/project' },
      resolvedWorkDir: '/workspace/project',
      historyMessageCount: 2
    })

    expect(result.outcome).toBe('blocked_space_mismatch')
    expect(result.retryCount).toBe(0)
    expect(result.errorCode).toBe(null)
    expect(clearSessionId).toHaveBeenCalledWith('space-1', 'conv-scope-mismatch')
    expect(query).toHaveBeenCalledTimes(1)
    const createArgs = vi.mocked(query).mock.calls[0]?.[0] as Record<string, unknown>
    expect((createArgs?.options as Record<string, unknown> | undefined)?.resume).toBeUndefined()
  })

  it('resume 失败命中白名单后会清理并重试新建', async () => {
    const close = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockImplementationOnce(() => createQueryMock({
        initializationResult: vi.fn().mockRejectedValue(new Error('Session not found: stale id'))
      }))
      .mockReturnValueOnce(createQueryMock({ close }))

    const result = await acquireSessionWithResumeFallback({
      spaceId: 'space-1',
      conversationId: 'conv-retry',
      sdkOptions: {},
      persistedSessionId: 'stale-id',
      persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
      resolvedWorkDir: '/workspace/project',
      historyMessageCount: 4
    })

    expect(result.outcome).toBe('new_after_resume_fail')
    expect(result.retryCount).toBe(1)
    expect(result.errorCode).toBe('SESSION_NOT_FOUND')
    expect(clearSessionId).toHaveBeenCalledWith('space-1', 'conv-retry')
    expect(query).toHaveBeenCalledTimes(2)
    const secondArgs = vi.mocked(query).mock.calls[1]?.[0] as Record<string, unknown>
    expect((secondArgs?.options as Record<string, unknown> | undefined)?.resume).toBeUndefined()
  })

  it('初始化命中 Invalid MCP configuration 时会去掉 mcpServers 自动重试', async () => {
    const closeInvalidMcp = vi.fn()
    const closeRecovered = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockReturnValueOnce(createQueryMock({
        close: closeInvalidMcp,
        initializationResult: vi.fn().mockRejectedValue(
          new Error('Invalid MCP configuration:\nmcpServers.demo: Does not adhere to MCP server configuration schema')
        )
      }))
      .mockReturnValueOnce(createQueryMock({ close: closeRecovered }))

    await getOrCreateV2Session(
      'space-1',
      'conv-invalid-mcp',
      {
        cwd: '/workspace/project',
        mcpServers: {
          demo: { env: {} }
        }
      },
      undefined,
      {
        skillsLazyLoad: false,
        profileId: 'profile-a',
        providerSignature: 'sig-a',
        effectiveModel: 'model-a',
        enabledPluginMcpsHash: 'mcp-1',
        hasCanUseTool: true
      }
    )

    expect(query).toHaveBeenCalledTimes(2)
    const firstArgs = vi.mocked(query).mock.calls[0]?.[0] as Record<string, unknown>
    const secondArgs = vi.mocked(query).mock.calls[1]?.[0] as Record<string, unknown>
    expect((firstArgs?.options as Record<string, unknown> | undefined)?.mcpServers).toEqual({
      demo: { env: {} }
    })
    expect(
      Object.prototype.hasOwnProperty.call(
        (secondArgs?.options as Record<string, unknown> | undefined) ?? {},
        'mcpServers'
      )
    ).toBe(false)
    expect(closeInvalidMcp).toHaveBeenCalledTimes(1)
    expect(closeRecovered).not.toHaveBeenCalled()
  })

  it('初始化命中 DevToolsActivePort 时会触发 Chrome 预热后重试', async () => {
    const closeRetry = vi.fn()
    vi.mocked(query)
      .mockReset()
      .mockReturnValueOnce(createQueryMock({
        initializationResult: vi.fn().mockRejectedValue(
          new Error('Could not find DevToolsActivePort file')
        )
      }))
      .mockReturnValueOnce(createQueryMock({ close: closeRetry }))

    await getOrCreateV2Session(
      'space-1',
      'conv-devtools-port',
      {
        cwd: '/workspace/project',
        mcpServers: {
          'chrome-devtools': {
            command: 'npx',
            args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect']
          }
        }
      },
      undefined,
      {
        skillsLazyLoad: false,
        profileId: 'profile-a',
        providerSignature: 'sig-a',
        effectiveModel: 'model-a',
        enabledPluginMcpsHash: 'mcp-1',
        hasCanUseTool: true
      }
    )

    expect(query).toHaveBeenCalledTimes(2)
    expect(ensureChromeDebugModeReadyForMcp).toHaveBeenCalled()
    expect(closeRetry).not.toHaveBeenCalled()
  })

  it('resume 失败非白名单错误直接抛出，不 fallback', async () => {
    vi.mocked(query)
      .mockReset()
      .mockImplementationOnce(() => createQueryMock({
        initializationResult: vi.fn().mockRejectedValue(new Error('network disconnected'))
      }))

    await expect(
      acquireSessionWithResumeFallback({
        spaceId: 'space-1',
        conversationId: 'conv-fatal',
        sdkOptions: {},
        persistedSessionId: 'session-id',
        persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
        resolvedWorkDir: '/workspace/project',
        historyMessageCount: 2
      })
    ).rejects.toThrow('network disconnected')

    expect(clearSessionId).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('classifyResumeError 按白名单分类', () => {
    expect(classifyResumeError({ code: 'SESSION_NOT_FOUND' }).code).toBe('SESSION_NOT_FOUND')
    expect(classifyResumeError({ errorCode: 'invalid-session' }).code).toBe('INVALID_SESSION')
    expect(classifyResumeError(new Error('Session not found')).code).toBe('SESSION_NOT_FOUND')
    expect(classifyResumeError(new Error('invalid session id')).code).toBe('INVALID_SESSION')
    expect(classifyResumeError(new Error('permission denied')).code).toBe('UNKNOWN')
  })

  it('同一 conversationId 并发恢复链路会被互斥串行化', async () => {
    vi.useRealTimers()
    let inFlight = 0
    let maxInFlight = 0
    vi.mocked(query).mockReset().mockImplementation((params: any) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const close = vi.fn()
      const initializationResult = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        inFlight -= 1
        if (params?.options?.resume) {
          throw new Error('Session not found: stale id')
        }
        return {}
      })
      return createQueryMock({ close, initializationResult })
    })

    await Promise.all([
      acquireSessionWithResumeFallback({
        spaceId: 'space-1',
        conversationId: 'conv-serial',
        sdkOptions: {},
        persistedSessionId: 'stale-id',
        persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
        resolvedWorkDir: '/workspace/project',
        historyMessageCount: 3
      }),
      acquireSessionWithResumeFallback({
        spaceId: 'space-1',
        conversationId: 'conv-serial',
        sdkOptions: {},
        persistedSessionId: 'stale-id',
        persistedSessionScope: { spaceId: 'space-1', workDir: '/workspace/project' },
        resolvedWorkDir: '/workspace/project',
        historyMessageCount: 3
      })
    ])

    expect(maxInFlight).toBe(1)
  })
})

describe('session.manager cleanup', () => {
  const baseConfig: SessionConfig = {
    skillsLazyLoad: false,
    profileId: 'profile-cleanup',
    providerSignature: 'sig-cleanup',
    effectiveModel: 'model-cleanup',
    enabledPluginMcpsHash: 'mcp-cleanup',
    hasCanUseTool: true
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.mocked(getConfig).mockReturnValue({} as any)
    vi.mocked(query).mockReset()
  })

  afterEach(() => {
    deleteActiveSession('space-1', 'conv-active')
    closeAllV2Sessions()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('inactive session 超时后会被清理', async () => {
    const close = vi.fn()
    vi.mocked(query).mockReturnValueOnce(createQueryMock({ close }))

    await getOrCreateV2Session('space-1', 'conv-inactive', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('active session 超时后不会被清理', async () => {
    const close = vi.fn()
    vi.mocked(query).mockReturnValueOnce(createQueryMock({ close }))

    await getOrCreateV2Session('space-1', 'conv-active', {}, undefined, baseConfig)
    setActiveSession('space-1', 'conv-active', createRunningSessionState('conv-active'))
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)

    expect(close).not.toHaveBeenCalled()
  })

  it('sessionIdleTimeoutMs <= 0 时不执行清理', async () => {
    const close = vi.fn()
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        sessionIdleTimeoutMs: 0
      }
    } as any)
    vi.mocked(query).mockReturnValueOnce(createQueryMock({ close }))

    await getOrCreateV2Session('space-1', 'conv-disabled', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 5 * 60 * 1000)

    expect(close).not.toHaveBeenCalled()
  })

  it('touchV2Session 可以延长会话生命周期，避免误清理', async () => {
    const close = vi.fn()
    vi.mocked(query).mockReturnValueOnce(createQueryMock({ close }))

    await getOrCreateV2Session('space-1', 'conv-touch', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    touchV2Session('space-1', 'conv-touch')

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('maxWorkers 达到上限时会优先淘汰非 active 会话后新建', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        maxWorkers: 1
      }
    } as any)
    vi.mocked(query)
      .mockReturnValueOnce(createQueryMock({ close: closeA }))
      .mockReturnValueOnce(createQueryMock({ close: closeB }))

    await getOrCreateV2Session('space-1', 'conv-limit-a', {}, undefined, baseConfig)
    await getOrCreateV2Session('space-1', 'conv-limit-b', {}, undefined, baseConfig)

    expect(query).toHaveBeenCalledTimes(2)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('maxWorkers 达到上限且全部 active 时拒绝新建', async () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        maxWorkers: 1
      }
    } as any)
    vi.mocked(query)
      .mockReturnValueOnce(createQueryMock({ close: closeA }))
      .mockReturnValueOnce(createQueryMock({ close: closeB }))

    await getOrCreateV2Session('space-1', 'conv-limit-active-a', {}, undefined, baseConfig)
    setActiveSession('space-1', 'conv-limit-active-a', createRunningSessionState('conv-limit-active-a'))

    await expect(
      getOrCreateV2Session('space-1', 'conv-limit-active-b', {}, undefined, baseConfig)
    ).rejects.toMatchObject({
      errorCode: 'WORKER_LIMIT_REACHED'
    })

    expect(query).toHaveBeenCalledTimes(1)
    expect(closeA).not.toHaveBeenCalled()
    expect(closeB).not.toHaveBeenCalled()
    deleteActiveSession('space-1', 'conv-limit-active-a')
  })

  it('淘汰顺序遵循 LRU（lastUsedAt 最旧优先）', async () => {
    const closeOld = vi.fn()
    const closeNew = vi.fn()
    const closeThird = vi.fn()
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        maxWorkers: 2
      }
    } as any)
    vi.mocked(query)
      .mockReturnValueOnce(createQueryMock({ close: closeOld }))
      .mockReturnValueOnce(createQueryMock({ close: closeNew }))
      .mockReturnValueOnce(createQueryMock({ close: closeThird }))

    await getOrCreateV2Session('space-1', 'conv-lru-old', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(1000)
    await getOrCreateV2Session('space-1', 'conv-lru-new', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(1000)
    await getOrCreateV2Session('space-1', 'conv-lru-third', {}, undefined, baseConfig)

    expect(query).toHaveBeenCalledTimes(3)
    expect(closeOld).toHaveBeenCalledTimes(1)
    expect(closeNew).not.toHaveBeenCalled()
    expect(closeThird).not.toHaveBeenCalled()
  })

  it.each([
    ['NaN', Number.NaN],
    ['string', 'abc'],
    ['tiny', 10]
  ])('非法 timeout 配置(%s)回退默认行为', async (_, timeoutValue) => {
    const close = vi.fn()
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        sessionIdleTimeoutMs: timeoutValue
      }
    } as any)
    vi.mocked(query).mockReturnValueOnce(createQueryMock({ close }))

    await getOrCreateV2Session('space-1', `conv-invalid-${String(timeoutValue)}`, {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('close 返回 rejected Promise(Abort) 时不会产生未处理拒绝', async () => {
    const close = vi.fn(() => Promise.reject(new Error('Operation aborted')))
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.mocked(query).mockReturnValueOnce(createQueryMock({ close }))

    await getOrCreateV2Session('space-1', 'conv-abort', {}, undefined, baseConfig)
    await vi.advanceTimersByTimeAsync(DEFAULT_SESSION_IDLE_TIMEOUT_MS + 60 * 1000)
    await Promise.resolve()

    expect(close).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalled()
    debugSpy.mockRestore()
  })

  it('底层 query session 缺少 close 时，清理不会抛错', async () => {
    vi.mocked(query).mockReturnValueOnce({
      initializationResult: vi.fn().mockResolvedValue({}),
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined })
      }),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      interrupt: vi.fn().mockResolvedValue(undefined),
      reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
      toggleMcpServer: vi.fn().mockResolvedValue(undefined)
    } as any)

    await getOrCreateV2Session('space-1', 'conv-no-close', {}, undefined, baseConfig)
    expect(() => closeV2Session('space-1', 'conv-no-close')).not.toThrow()
  })
})
