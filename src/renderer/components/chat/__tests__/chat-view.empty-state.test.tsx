import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

let mockAiConfigured = true

vi.mock('../../../../shared/types/ai-profile', () => ({
  getAiSetupState: () => ({
    configured: mockAiConfigured,
    reason: mockAiConfigured ? null : 'missing_api_key'
  })
}))

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  getCurrentLanguage: () => 'zh-CN'
}))

vi.mock('../../../hooks/useCanvasLifecycle', () => ({
  useCanvasLifecycle: () => ({
    openPlan: vi.fn(async () => {})
  })
}))

vi.mock('../../../hooks/useSmartScroll', () => ({
  useSmartScroll: () => ({
    containerRef: { current: null },
    bottomRef: { current: null },
    showScrollButton: false,
    scrollToBottom: vi.fn(),
    handleScroll: vi.fn()
  })
}))

vi.mock('../../../stores/onboarding.store', () => ({
  useOnboardingStore: (selector: (state: any) => unknown) => selector({
    isActive: false,
    currentStep: null,
    nextStep: vi.fn(),
    setMockAnimating: vi.fn(),
    setMockThinking: vi.fn(),
    isMockAnimating: false,
    isMockThinking: false
  })
}))

vi.mock('../../../stores/space.store', () => ({
  useSpaceStore: (selector: (state: any) => unknown) => selector({
    currentSpace: {
      id: 'space-1',
      name: 'Space 1',
      icon: 'folder',
      path: '/tmp/space-1'
    },
    spaces: []
  })
}))

vi.mock('../../../stores/app.store', () => ({
  useAppStore: (selector: (state: any) => unknown) => selector({
    config: {},
    setView: vi.fn()
  })
}))

vi.mock('../../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector({
    currentSpaceId: 'space-1',
    changeSets: new Map(),
    getCurrentConversation: () => null,
    getCurrentConversationMeta: () => null,
    getCurrentConversationId: () => 'conv-1',
    getCurrentSession: () => ({
      isGenerating: false,
      activeRunId: null,
      streamingContent: '',
      isStreaming: false,
      thoughts: [],
      processTrace: [],
      parallelGroups: new Map(),
      isThinking: false,
      compactInfo: null,
      error: null,
      textBlockVersion: 0,
      mode: 'code',
      modeSwitching: false,
      toolStatusById: {},
      availableToolsSnapshot: { runId: null, snapshotVersion: 0, emittedAt: null, phase: 'ready', tools: [], toolCount: 0 },
      slashRuntimeMode: 'native',
      slashCommandsSnapshot: { runId: null, snapshotVersion: 0, emittedAt: null, commands: [], source: null },
      askUserQuestionsById: {},
      askUserQuestionOrder: [],
      activeAskUserQuestionId: null
    }),
    queuedTurnsByConversation: new Map(),
    queueErrorByConversation: new Map(),
    loadingConversationCounts: new Map(),
    loadChangeSets: vi.fn(),
    acceptChangeSet: vi.fn(),
    rollbackChangeSet: vi.fn(),
    submitTurn: vi.fn(),
    executePlan: vi.fn(),
    stopGeneration: vi.fn(),
    answerQuestion: vi.fn(),
    dismissAskUserQuestion: vi.fn(),
    setConversationMode: vi.fn(),
    getQueuedTurns: () => [],
    getQueueError: () => null,
    sendQueuedTurn: vi.fn(),
    removeQueuedTurn: vi.fn(),
    clearConversationQueue: vi.fn(),
    clearQueueError: vi.fn()
  })
}))

vi.mock('../MessageList', () => ({
  MessageList: () => <div>Message List</div>
}))

vi.mock('../InputArea', () => ({
  InputArea: () => <div>Input Area</div>
}))

vi.mock('../AskUserQuestionPanel', () => ({
  AskUserQuestionPanel: () => <div>Ask User Question Panel</div>
}))

vi.mock('../ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null
}))

vi.mock('../../diff', () => ({
  ChangeReviewBar: () => <div>Change Review Bar</div>
}))

vi.mock('../../icons/ToolIcons', () => ({
  Sparkles: () => <span>Sparkles</span>
}))

import { ChatView } from '../ChatView'

describe('ChatView empty state', () => {
  it('shows direct-start copy for configured empty conversations', () => {
    mockAiConfigured = true

    const html = renderToStaticMarkup(<ChatView />)

    expect(html).toContain('直接开始')
    expect(html).toContain('描述目标，Kite 会产出文件、草稿、代码和步骤。')
    expect(html).toContain('Input Area')
    expect(html).not.toContain('Ready to start')
  })

  it('shows model setup blocking copy in the composer area when AI is not configured', () => {
    mockAiConfigured = false

    const html = renderToStaticMarkup(<ChatView />)

    expect(html).toContain('先完成模型配置')
    expect(html).toContain('完成模型配置后，你就可以直接向 Kite 发送任务。')
    expect(html).toContain('去设置模型')
    expect(html).not.toContain('Input Area')
    expect(html).not.toContain('Complete model setup before chatting')
  })
})
