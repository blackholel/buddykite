import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../src/renderer/i18n'

const mockSendMessage = vi.fn()
const mockSendWorkflowStepMessage = vi.fn()
const mockGetConversation = vi.fn()
const mockListChangeSets = vi.fn()
const mockStopGeneration = vi.fn()

vi.mock('../../../src/renderer/api', () => ({
  api: {
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    sendWorkflowStepMessage: (...args: unknown[]) => mockSendWorkflowStepMessage(...args),
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    listChangeSets: (...args: unknown[]) => mockListChangeSets(...args),
    stopGeneration: (...args: unknown[]) => mockStopGeneration(...args)
  }
}))

vi.mock('../../../src/renderer/services/canvas-lifecycle', () => ({
  canvasLifecycle: {
    getIsOpen: () => false,
    getTabCount: () => 0,
    getTabs: () => [],
    getActiveTabId: () => null,
    getActiveTab: () => null
  }
}))

import { useChatStore } from '../../../src/renderer/stores/chat.store'
import { useAppStore } from '../../../src/renderer/stores/app.store'

function seedConversation(
  spaceId: string,
  conversationId: string,
  conversationProfileId?: string
): void {
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
              title: 'AI Setup Guard',
              createdAt: now,
              updatedAt: now,
              messageCount: 0,
              preview: '',
              ...(conversationProfileId ? { ai: { profileId: conversationProfileId } } : {})
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
          title: 'AI Setup Guard',
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          messages: [],
          ...(conversationProfileId ? { ai: { profileId: conversationProfileId } } : {})
        }
      ]
    ])
  })
}

describe('chat.store AI setup guard', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    mockSendMessage.mockReset()
    mockSendWorkflowStepMessage.mockReset()
    mockGetConversation.mockReset()
    mockListChangeSets.mockReset()
    mockStopGeneration.mockReset()
    mockSendMessage.mockResolvedValue({ success: true })
    mockSendWorkflowStepMessage.mockResolvedValue({ success: true })
    mockGetConversation.mockResolvedValue({ success: false })
    mockListChangeSets.mockResolvedValue({ success: false })
    mockStopGeneration.mockResolvedValue({ success: true })
    useAppStore.setState({ config: null } as any)
  })

  it('blocks submitTurn before API call when profile is not configured', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-ai-guard'
    seedConversation(spaceId, conversationId)

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'hello',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(mockSendMessage).toHaveBeenCalledTimes(0)
    expect(useChatStore.getState().getQueueCount(conversationId)).toBe(1)
    expect(useChatStore.getState().getQueueError(conversationId)).toBe(
      i18n.t('Please configure AI profile first')
    )
    expect(useChatStore.getState().getSession(conversationId).error).toBe(
      i18n.t('Please configure AI profile first')
    )
  })

  it('allows submitTurn when current conversation profile is configured even if default profile is invalid', async () => {
    const spaceId = 'space-1'
    const conversationId = 'conv-ai-guard'
    const conversationProfileId = 'p-conversation'
    seedConversation(spaceId, conversationId, conversationProfileId)

    useAppStore.setState({
      config: {
        api: {
          provider: 'anthropic',
          apiKey: '',
          apiUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5-20250929'
        },
        ai: {
          defaultProfileId: 'p-default',
          profiles: [
            {
              id: 'p-default',
              name: 'Default',
              vendor: 'anthropic',
              protocol: 'anthropic_official',
              apiUrl: 'https://api.anthropic.com',
              apiKey: '',
              defaultModel: 'claude-sonnet-4-5-20250929',
              modelCatalog: ['claude-sonnet-4-5-20250929'],
              enabled: true
            },
            {
              id: conversationProfileId,
              name: 'Conversation',
              vendor: 'minimax',
              protocol: 'anthropic_compat',
              apiUrl: 'https://api.minimaxi.com/anthropic',
              apiKey: 'mm-key',
              defaultModel: 'MiniMax-Text-01',
              modelCatalog: ['MiniMax-Text-01'],
              enabled: true
            }
          ]
        }
      }
    } as any)

    await useChatStore.getState().submitTurn({
      spaceId,
      conversationId,
      content: 'hello',
      aiBrowserEnabled: false,
      mode: 'code'
    })

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().getQueueError(conversationId)).toBeNull()
  })
})
