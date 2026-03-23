import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '../types'

const sessionManagerMocks = vi.hoisted(() => ({
  acquireSessionWithResumeFallback: vi.fn(),
  closeV2Session: vi.fn(),
  reconnectMcpServer: vi.fn(),
  getActiveSession: vi.fn(),
  getActiveSessions: vi.fn(() => []),
  setActiveSession: vi.fn(),
  deleteActiveSession: vi.fn(),
  getV2SessionInfo: vi.fn(),
  getV2SessionConversationIds: vi.fn(() => []),
  getV2SessionsCount: vi.fn(() => 0),
  setSessionMode: vi.fn(),
  touchV2Session: vi.fn(),
  getEnabledMcpServersHashFromSdkOptions: vi.fn(() => '')
}))

const conversationServiceMocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  saveSessionId: vi.fn(),
  addMessage: vi.fn(),
  updateLastMessage: vi.fn(),
  insertUserMessageBeforeTrailingAssistant: vi.fn()
}))

const changeSetMocks = vi.hoisted(() => ({
  beginChangeSet: vi.fn(),
  clearPendingChangeSet: vi.fn(),
  finalizeChangeSet: vi.fn(),
  trackChangeFile: vi.fn()
}))

const rendererCommMocks = vi.hoisted(() => ({
  setMainWindow: vi.fn(),
  sendToRenderer: vi.fn(),
  createCanUseTool: vi.fn(),
  normalizeAskUserQuestionInput: vi.fn((payload) => payload),
  buildAskUserQuestionUpdatedInput: vi.fn(),
  getAskUserQuestionInputFingerprint: vi.fn(() => 'fingerprint')
}))

const dispatchThrottleMocks = vi.hoisted(() => ({
  acquireSendDispatchSlot: vi.fn()
}))

const chromeDebugLauncherMocks = vi.hoisted(() => ({
  ensureChromeDebugModeReadyForMcp: vi.fn()
}))

vi.mock('../session.manager', () => ({
  acquireSessionWithResumeFallback: sessionManagerMocks.acquireSessionWithResumeFallback,
  closeV2Session: sessionManagerMocks.closeV2Session,
  reconnectMcpServer: sessionManagerMocks.reconnectMcpServer,
  getActiveSession: sessionManagerMocks.getActiveSession,
  getActiveSessions: sessionManagerMocks.getActiveSessions,
  setActiveSession: sessionManagerMocks.setActiveSession,
  deleteActiveSession: sessionManagerMocks.deleteActiveSession,
  getV2SessionInfo: sessionManagerMocks.getV2SessionInfo,
  getV2SessionConversationIds: sessionManagerMocks.getV2SessionConversationIds,
  getV2SessionsCount: sessionManagerMocks.getV2SessionsCount,
  setSessionMode: sessionManagerMocks.setSessionMode,
  touchV2Session: sessionManagerMocks.touchV2Session,
  getEnabledMcpServersHashFromSdkOptions: sessionManagerMocks.getEnabledMcpServersHashFromSdkOptions
}))

vi.mock('../../conversation.service', () => ({
  getConversation: conversationServiceMocks.getConversation,
  saveSessionId: conversationServiceMocks.saveSessionId,
  addMessage: conversationServiceMocks.addMessage,
  updateLastMessage: conversationServiceMocks.updateLastMessage,
  insertUserMessageBeforeTrailingAssistant: conversationServiceMocks.insertUserMessageBeforeTrailingAssistant
}))

vi.mock('../../change-set.service', () => ({
  beginChangeSet: changeSetMocks.beginChangeSet,
  clearPendingChangeSet: changeSetMocks.clearPendingChangeSet,
  finalizeChangeSet: changeSetMocks.finalizeChangeSet,
  trackChangeFile: changeSetMocks.trackChangeFile
}))

vi.mock('../renderer-comm', () => ({
  setMainWindow: rendererCommMocks.setMainWindow,
  sendToRenderer: rendererCommMocks.sendToRenderer,
  createCanUseTool: rendererCommMocks.createCanUseTool,
  normalizeAskUserQuestionInput: rendererCommMocks.normalizeAskUserQuestionInput,
  buildAskUserQuestionUpdatedInput: rendererCommMocks.buildAskUserQuestionUpdatedInput,
  getAskUserQuestionInputFingerprint: rendererCommMocks.getAskUserQuestionInputFingerprint
}))

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({
    ai: { defaultProfileId: 'profile-default' },
    claudeCode: {}
  }))
}))

vi.mock('../provider-resolver', () => ({
  resolveProvider: vi.fn(async () => ({
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://api.anthropic.com',
    sdkModel: 'claude-sonnet',
    effectiveModel: 'claude-sonnet',
    useAnthropicCompatModelMapping: false
  }))
}))

vi.mock('../ai-config-resolver', () => ({
  resolveEffectiveConversationAi: vi.fn(() => ({
    profileId: 'profile-default',
    profile: {
      id: 'profile-default',
      name: 'Default Profile',
      vendor: 'anthropic'
    },
    providerSignature: 'anthropic:default',
    effectiveModel: 'claude-sonnet',
    disableToolsForCompat: false,
    compatProviderName: '',
    disableThinkingForCompat: false,
    disableImageForCompat: false
  }))
}))

vi.mock('../sdk-config.builder', () => ({
  buildSdkOptions: vi.fn(() => ({})),
  getEffectiveSkillsLazyLoad: vi.fn(() => ({ effectiveLazyLoad: false, strictSpaceOnly: false })),
  getWorkingDir: vi.fn(() => '/tmp/workspace'),
  getEnabledMcpServers: vi.fn(() => []),
  shouldEnableCodepilotWidgetMcp: vi.fn(() => false)
}))

vi.mock('../ai-setup-guard', () => ({
  assertAiProfileConfigured: vi.fn()
}))

vi.mock('../../space-config.service', () => ({
  getSpaceConfig: vi.fn(() => null)
}))

vi.mock('../../resource-runtime-policy.service', () => ({
  resolveResourceRuntimePolicy: vi.fn(() => 'app-single-source')
}))

vi.mock('../../resource-index.service', () => ({
  getResourceIndexHash: vi.fn(() => 'resource-hash'),
  getResourceIndexSnapshot: vi.fn(() => ({
    hash: 'resource-hash',
    counts: { skills: 0, commands: 0, agents: 0 }
  }))
}))

vi.mock('../space-resource-policy.service', () => ({
  getExecutionLayerAllowedSources: vi.fn(() => [])
}))

vi.mock('../slash-runtime-mode.service', () => ({
  resolveSlashRuntimeMode: vi.fn(() => ({ mode: 'native' })),
  SLASH_RUNTIME_MODE_ENV_KEY: 'HELLO_HALO_SLASH_RUNTIME_MODE'
}))

vi.mock('../../resource-exposure.service', () => ({
  getResourceExposureRuntimeFlags: vi.fn(() => ({}))
}))

vi.mock('../../plugins.service', () => ({
  findEnabledPluginByInput: vi.fn(() => null)
}))

vi.mock('../dispatch-throttle.service', () => ({
  acquireSendDispatchSlot: dispatchThrottleMocks.acquireSendDispatchSlot
}))

vi.mock('../../chrome-debug-launcher.service', () => ({
  ensureChromeDebugModeReadyForMcp: chromeDebugLauncherMocks.ensureChromeDebugModeReadyForMcp
}))

vi.mock('../runtime-journal.service', () => ({
  allocateRunEpoch: vi.fn(() => 1)
}))

vi.mock('../observability', () => ({
  startAgentRunObservation: vi.fn(() => ({})),
  setAgentRunObservationProvider: vi.fn(),
  startAgentRunObservationPhase: vi.fn(),
  endAgentRunObservationPhase: vi.fn(),
  markAgentRunFirstToken: vi.fn(),
  finalizeAgentRunObservation: vi.fn(),
  getAgentRunObservation: vi.fn(() => null)
}))

import { sendMessage, stopGeneration } from '../message-flow.service'
import { ensureChromeDebugModeReadyForMcp } from '../../chrome-debug-launcher.service'

function createSessionState(runId: string, conversationId = 'conv-1'): SessionState {
  return {
    abortController: new AbortController(),
    spaceId: 'space-1',
    conversationId,
    runId,
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

function createDrainableSession(): { interrupt: ReturnType<typeof vi.fn>; stream: () => AsyncGenerator<any, void, unknown> } {
  const interrupt = vi.fn().mockResolvedValue(undefined)
  return {
    interrupt,
    stream: async function * () {
      yield { type: 'result' }
    }
  }
}

function createStreamingSession(messages: Array<Record<string, unknown>>) {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    stream: async function * () {
      for (const message of messages) {
        yield message
      }
    }
  }
}

describe('message-flow stopGeneration cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rendererCommMocks.sendToRenderer.mockImplementation(() => {})
    changeSetMocks.clearPendingChangeSet.mockImplementation(() => {})
  })

  it('单会话 stop 后会按 expectedRunId 清理 active 并关闭 V2 会话', async () => {
    const activeSession = createSessionState('run-old', 'conv-1')
    const drainable = createDrainableSession()
    sessionManagerMocks.getActiveSession.mockImplementation(() => activeSession)
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: drainable })

    await stopGeneration('space-1', 'conv-1')

    expect(sessionManagerMocks.deleteActiveSession).toHaveBeenCalledWith('space-1', 'conv-1', 'run-old')
    expect(sessionManagerMocks.closeV2Session).toHaveBeenCalledWith('space-1', 'conv-1')
    expect(changeSetMocks.clearPendingChangeSet).toHaveBeenCalledWith('space-1', 'conv-1')
  })

  it('旧 run stop 期间若出现新 run active，则不关闭当前 V2 会话', async () => {
    const oldSession = createSessionState('run-old', 'conv-1')
    const newSession = createSessionState('run-new', 'conv-1')
    const drainable = createDrainableSession()
    let activeLookupCount = 0
    sessionManagerMocks.getActiveSession.mockImplementation(() => {
      activeLookupCount += 1
      if (activeLookupCount <= 3) {
        return oldSession
      }
      return newSession
    })
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: drainable })

    await stopGeneration('space-1', 'conv-1')

    expect(sessionManagerMocks.deleteActiveSession).toHaveBeenCalledWith('space-1', 'conv-1', 'run-old')
    expect(sessionManagerMocks.closeV2Session).not.toHaveBeenCalled()
  })

  it('expectedRunId 为空时，stop 期间若出现新 run active，不应误删 active 或关闭 V2 会话', async () => {
    const newSession = createSessionState('run-new', 'conv-1')
    const drainable = createDrainableSession()
    let activeLookupCount = 0
    sessionManagerMocks.getActiveSession.mockImplementation(() => {
      activeLookupCount += 1
      if (activeLookupCount <= 3) {
        return undefined
      }
      return newSession
    })
    sessionManagerMocks.getV2SessionInfo.mockReturnValue({ session: drainable })

    await stopGeneration('space-1', 'conv-1')

    expect(sessionManagerMocks.deleteActiveSession).not.toHaveBeenCalled()
    expect(sessionManagerMocks.closeV2Session).not.toHaveBeenCalled()
  })

  it('space 级 stop 会关闭命中空间的会话', async () => {
    const activeSession = createSessionState('run-a', 'conv-a')
    const drainableA = createDrainableSession()
    const drainableB = createDrainableSession()
    sessionManagerMocks.getActiveSessions.mockReturnValue([
      { spaceId: 'space-1', conversationId: 'conv-a', sessionKey: 'space-1:conv-a' }
    ])
    sessionManagerMocks.getV2SessionConversationIds.mockReturnValue([
      { spaceId: 'space-1', conversationId: 'conv-b', sessionKey: 'space-1:conv-b' }
    ])
    sessionManagerMocks.getActiveSession.mockImplementation((_spaceId: string, conversationId: string) => (
      conversationId === 'conv-a' ? activeSession : undefined
    ))
    sessionManagerMocks.getV2SessionInfo.mockImplementation((_spaceId: string, conversationId: string) => (
      conversationId === 'conv-a'
        ? { session: drainableA }
        : conversationId === 'conv-b'
          ? { session: drainableB }
          : undefined
    ))

    await stopGeneration('space-1')

    expect(sessionManagerMocks.closeV2Session).toHaveBeenCalledWith('space-1', 'conv-a')
    expect(sessionManagerMocks.closeV2Session).toHaveBeenCalledWith('space-1', 'conv-b')
  })
})

describe('message-flow pre-main cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dispatchThrottleMocks.acquireSendDispatchSlot.mockImplementation(() => releaseDispatchSlotMock)
    rendererCommMocks.sendToRenderer.mockImplementation((channel: string) => {
      if (channel === 'agent:run-start') {
        throw new Error('run-start transport failure')
      }
    })
    conversationServiceMocks.getConversation.mockReturnValue({
      id: 'conv-1',
      spaceId: 'space-1',
      ai: { profileId: 'profile-default' },
      messages: []
    })
  })

  const releaseDispatchSlotMock = vi.fn()

  it('setActiveSession 后主流程前抛错时，仍释放 dispatch slot 并清理 active', async () => {
    await expect(sendMessage(null, {
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: 'hello'
    } as any)).rejects.toThrow('run-start transport failure')

    expect(sessionManagerMocks.setActiveSession).toHaveBeenCalledTimes(1)
    expect(sessionManagerMocks.deleteActiveSession).toHaveBeenCalledWith(
      'space-1',
      'conv-1',
      expect.any(String)
    )
    expect(changeSetMocks.clearPendingChangeSet).toHaveBeenCalledWith('space-1', 'conv-1')
    expect(releaseDispatchSlotMock).toHaveBeenCalledTimes(1)
  })
})

describe('message-flow chrome-devtools MCP recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dispatchThrottleMocks.acquireSendDispatchSlot.mockImplementation(() => () => {})
    rendererCommMocks.sendToRenderer.mockImplementation(() => {})
    conversationServiceMocks.getConversation.mockReturnValue({
      id: 'conv-1',
      spaceId: 'space-1',
      ai: { profileId: 'profile-default' },
      messages: []
    })
    chromeDebugLauncherMocks.ensureChromeDebugModeReadyForMcp.mockResolvedValue(undefined)
    sessionManagerMocks.reconnectMcpServer.mockResolvedValue({ success: true })
  })

  it('chrome-devtools tool_result 连接错误时只触发一次恢复', async () => {
    sessionManagerMocks.acquireSessionWithResumeFallback.mockResolvedValue({
      session: createStreamingSession([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-chrome-1',
                name: 'mcp__chrome-devtools__navigate_page',
                input: { url: 'https://example.com' }
              }
            ]
          }
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-chrome-1',
                is_error: true,
                content: 'Could not connect to Chrome: remote-debugging-port is unavailable'
              }
            ]
          }
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-chrome-1',
                is_error: true,
                content: 'DevToolsActivePort is missing'
              }
            ]
          }
        },
        { type: 'result', result: 'done' }
      ]),
      outcome: 'new_no_resume',
      retryCount: 0,
      errorCode: null
    })

    await sendMessage(null, {
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: 'test recovery'
    } as any)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(ensureChromeDebugModeReadyForMcp).toHaveBeenCalledTimes(1)
    expect(sessionManagerMocks.reconnectMcpServer).toHaveBeenCalledTimes(1)
    expect(sessionManagerMocks.reconnectMcpServer).toHaveBeenCalledWith(
      'space-1',
      'conv-1',
      'chrome-devtools'
    )
  })

  it('非 chrome-devtools 工具即使报连接错误也不触发恢复', async () => {
    sessionManagerMocks.acquireSessionWithResumeFallback.mockResolvedValue({
      session: createStreamingSession([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-other-1',
                name: 'mcp__filesystem__read_file',
                input: { path: '/tmp/demo.txt' }
              }
            ]
          }
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-other-1',
                is_error: true,
                content: 'Could not connect to Chrome: remote-debugging-port is unavailable'
              }
            ]
          }
        },
        { type: 'result', result: 'done' }
      ]),
      outcome: 'new_no_resume',
      retryCount: 0,
      errorCode: null
    })

    await sendMessage(null, {
      spaceId: 'space-1',
      conversationId: 'conv-1',
      message: 'test no recovery'
    } as any)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(ensureChromeDebugModeReadyForMcp).not.toHaveBeenCalled()
    expect(sessionManagerMocks.reconnectMcpServer).not.toHaveBeenCalled()
  })
})
