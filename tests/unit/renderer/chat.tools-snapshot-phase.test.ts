import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetConversation = vi.fn()
const mockListChangeSets = vi.fn()
const mockStopGeneration = vi.fn()

vi.mock('../../../src/renderer/api', () => ({
  api: {
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

function seedConversationScope(spaceId: string, conversationId: string): void {
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
              title: 'tools snapshot',
              createdAt: now,
              updatedAt: now,
              messageCount: 0,
              preview: ''
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
          title: 'tools snapshot',
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          messages: []
        }
      ]
    ])
  })
}

describe('chat.store tools snapshot phase', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
    mockGetConversation.mockReset()
    mockListChangeSets.mockReset()
    mockStopGeneration.mockReset()
    mockGetConversation.mockResolvedValue({ success: false })
    mockListChangeSets.mockResolvedValue({ success: false })
    mockStopGeneration.mockResolvedValue({ success: true })
  })

  it('tracks tools phase from initializing to ready', () => {
    seedConversationScope('space-1', 'conv-1')

    useChatStore.getState().handleAgentRunStart({
      type: 'run_start',
      spaceId: 'space-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      startedAt: '2026-01-01T00:00:00.000Z'
    })

    const initial = useChatStore.getState().getSession('conv-1').availableToolsSnapshot
    expect(initial.phase).toBe('initializing')
    expect(initial.toolCount).toBe(0)

    useChatStore.getState().handleAgentToolsAvailable({
      type: 'tools_available',
      spaceId: 'space-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      snapshotVersion: 1,
      emittedAt: '2026-01-01T00:00:01.000Z',
      phase: 'initializing',
      tools: [],
      toolCount: 0
    })

    useChatStore.getState().handleAgentToolsAvailable({
      type: 'tools_available',
      spaceId: 'space-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      snapshotVersion: 2,
      emittedAt: '2026-01-01T00:00:02.000Z',
      phase: 'ready',
      tools: ['Read', 'Bash'],
      toolCount: 2
    })

    const snapshot = useChatStore.getState().getSession('conv-1').availableToolsSnapshot
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.toolCount).toBe(2)
    expect(snapshot.tools).toEqual(['Read', 'Bash'])
  })

  it('ignores stale snapshots with lower snapshotVersion', () => {
    seedConversationScope('space-1', 'conv-2')

    useChatStore.getState().handleAgentRunStart({
      type: 'run_start',
      spaceId: 'space-1',
      conversationId: 'conv-2',
      runId: 'run-2',
      startedAt: '2026-01-01T00:00:00.000Z'
    })

    useChatStore.getState().handleAgentToolsAvailable({
      type: 'tools_available',
      spaceId: 'space-1',
      conversationId: 'conv-2',
      runId: 'run-2',
      snapshotVersion: 2,
      emittedAt: '2026-01-01T00:00:02.000Z',
      phase: 'ready',
      tools: ['Read'],
      toolCount: 1
    })

    useChatStore.getState().handleAgentToolsAvailable({
      type: 'tools_available',
      spaceId: 'space-1',
      conversationId: 'conv-2',
      runId: 'run-2',
      snapshotVersion: 1,
      emittedAt: '2026-01-01T00:00:01.000Z',
      phase: 'initializing',
      tools: [],
      toolCount: 0
    })

    const snapshot = useChatStore.getState().getSession('conv-2').availableToolsSnapshot
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.toolCount).toBe(1)
    expect(snapshot.tools).toEqual(['Read'])
  })
})
