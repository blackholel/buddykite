import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../api', () => ({
  api: {
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    sendWorkflowStepMessage: vi.fn().mockResolvedValue({ success: true }),
    getConversation: vi.fn().mockResolvedValue({ success: false, data: null }),
    listChangeSets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getSessionState: vi.fn().mockResolvedValue({
      success: true,
      data: { isActive: false, thoughts: [], processTrace: [] }
    }),
    listConversations: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createConversation: vi.fn().mockResolvedValue({ success: true, data: null }),
    deleteConversation: vi.fn().mockResolvedValue({ success: true }),
    stopGeneration: vi.fn().mockResolvedValue(undefined),
    ensureSessionWarm: vi.fn().mockResolvedValue({ success: true }),
    subscribeToConversation: vi.fn()
  }
}))

vi.mock('../../services/canvas-lifecycle', () => ({
  canvasLifecycle: {
    getIsOpen: vi.fn().mockReturnValue(false),
    getTabCount: vi.fn().mockReturnValue(0),
    getTabs: vi.fn().mockReturnValue([]),
    getActiveTabId: vi.fn().mockReturnValue(null),
    getActiveTab: vi.fn().mockReturnValue(null),
    openPlan: vi.fn().mockResolvedValue('plan-tab-1')
  }
}))

vi.mock('../../i18n', () => ({
  default: { t: (key: string) => key },
  getCurrentLanguage: () => 'zh-CN'
}))

vi.mock('../../utils/thought-utils', () => ({
  buildParallelGroups: vi.fn().mockReturnValue(new Map()),
  getThoughtKey: vi.fn().mockReturnValue('k')
}))

import { api } from '../../api'
import { useChatStore } from '../chat.store'

function seedConversation(spaceId: string, conversationId: string): void {
  const now = new Date().toISOString()
  useChatStore.setState({
    currentSpaceId: spaceId,
    spaceStates: new Map([
      [
        spaceId,
        {
          conversations: [
            {
              id: conversationId,
              spaceId,
              title: 'Warm Test',
              createdAt: now,
              updatedAt: now,
              messageCount: 0
            }
          ],
          currentConversationId: conversationId
        }
      ]
    ]),
    conversationCache: new Map([
      [
        conversationId,
        {
          id: conversationId,
          spaceId,
          title: 'Warm Test',
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          messages: []
        }
      ]
    ])
  })
}

describe('chat.store session warm strategy', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    vi.clearAllMocks()
  })

  it('hydrateConversation 默认不触发 session warm', async () => {
    seedConversation('space-1', 'conv-1')

    await useChatStore.getState().hydrateConversation('space-1', 'conv-1')

    expect(api.subscribeToConversation).toHaveBeenCalledWith('space-1', 'conv-1')
    expect(api.ensureSessionWarm).not.toHaveBeenCalled()
  })

  it('selectConversation 仍会触发 session warm', async () => {
    seedConversation('space-1', 'conv-2')

    await useChatStore.getState().selectConversation('conv-2')

    expect(api.subscribeToConversation).toHaveBeenCalledWith('space-1', 'conv-2')
    expect(api.ensureSessionWarm).toHaveBeenCalledTimes(1)
    expect((api.ensureSessionWarm as Mock).mock.calls[0]).toEqual(
      expect.arrayContaining(['space-1', 'conv-2', 'zh-CN', { waitForReady: false }])
    )
  })

  it('session warm 失败不阻塞会话进入 ready', async () => {
    ;(api.ensureSessionWarm as Mock).mockRejectedValueOnce(new Error('warm failed'))
    seedConversation('space-1', 'conv-3')

    await useChatStore.getState().selectConversation('conv-3')

    const readyState = useChatStore.getState().conversationReadyByConversation.get('conv-3')
    expect(readyState?.status).toBe('ready')
  })
})
