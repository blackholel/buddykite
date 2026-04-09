import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockState = vi.hoisted(() => ({
  mockCurrentSpace: {
    id: 'space-1',
    name: 'Space 1',
    icon: 'folder',
    isTemp: false,
    path: '/tmp/space-1'
  },
  currentSpaceId: 'space-1',
  currentConversationId: 'conv-1',
  capturedSidebarProps: null as Record<string, any> | null,
  triggerTopTabClick: null as null | (() => Promise<void>),
  canvasTabs: [
    {
      id: 'tab-space-1',
      type: 'chat',
      title: '会话 A',
      conversationId: 'conv-1',
      spaceId: 'space-1'
    },
    {
      id: 'tab-space-2',
      type: 'chat',
      title: '会话 B',
      conversationId: 'conv-2',
      spaceId: 'space-2'
    }
  ],
  activeTab: null as Record<string, unknown> | null,
  openChat: vi.fn(async () => {}),
  switchTab: vi.fn(async () => {}),
  switchSpaceSession: vi.fn(async () => {}),
  closeSpaceSession: vi.fn(),
  closeConversationTabs: vi.fn(() => ({
    removedTabIds: [],
    removedActiveTab: false,
    nextActiveTabId: null,
    nextActiveChatConversationId: null
  })),
  navigateToConversationContext: vi.fn(async () => ({ success: true })),
  navigateToSpaceContext: vi.fn(async () => ({ success: true })),
  createConversation: vi.fn(async (_spaceId: string) => ({
    id: 'conv-new',
    spaceId: 'space-1',
    title: '会话新建',
    createdAt: '2026-03-25T09:00:00.000Z',
    updatedAt: '2026-03-25T09:00:00.000Z'
  })),
  selectConversation: vi.fn(async () => {}),
  updateSpace: vi.fn(async () => null),
  deleteSpace: vi.fn(async () => true),
  spaceStates: new Map([
    ['space-1', {
      currentConversationId: 'conv-1',
      conversations: [{ id: 'conv-1', title: '会话 A' }]
    }],
    ['space-2', {
      currentConversationId: 'conv-2',
      conversations: [{ id: 'conv-2', title: '会话 B' }]
    }]
  ])
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../hooks/useSearchShortcuts', () => ({
  useSearchShortcuts: () => {}
}))

vi.mock('../../hooks/useCanvasLifecycle', () => ({
  useCanvasLifecycle: () => ({
    tabs: mockState.canvasTabs,
    activeTab: mockState.activeTab,
    isOpen: false,
    setOpen: vi.fn(),
    openChat: mockState.openChat,
    switchTab: mockState.switchTab,
    switchSpaceSession: mockState.switchSpaceSession,
    closeSpaceSession: mockState.closeSpaceSession,
    closeConversationTabs: mockState.closeConversationTabs
  })
}))

vi.mock('../../components/chat/ChatView', () => ({
  ChatView: () => <section>Chat Surface</section>
}))

vi.mock('../../components/artifact/ArtifactRail', () => ({
  ArtifactRail: () => <aside aria-label="Files and artifacts">Artifact Rail</aside>
}))

vi.mock('../../components/canvas', () => ({
  CanvasTabBar: () => {
    mockState.triggerTopTabClick = async () => {
      const targetTab = mockState.canvasTabs.find((tab) => tab.spaceId !== mockState.currentSpaceId)
      if (!targetTab) return
      await mockState.switchTab(targetTab.id)
    }
    return <div role="tablist">Canvas Tab Bar</div>
  },
  CanvasToggleButton: () => <button>Canvas Toggle</button>,
  CollapsibleCanvas: () => <section>Canvas Surface</section>
}))

vi.mock('../../components/unified/UnifiedSidebar', () => ({
  UnifiedSidebar: (props: Record<string, any>) => {
    mockState.capturedSidebarProps = props
    return <aside>Unified Sidebar</aside>
  }
}))

vi.mock('../../components/setup/GitBashWarningBanner', () => ({
  GitBashWarningBanner: () => <div>Git Bash Warning</div>
}))

vi.mock('../../utils/space-conversation-navigation', () => ({
  navigateToConversationContext: mockState.navigateToConversationContext,
  navigateToSpaceContext: mockState.navigateToSpaceContext
}))

vi.mock('../../utils/space-entry-conversation', () => ({
  pickEntryConversation: vi.fn(() => null)
}))

vi.mock('../../stores/app.store', () => ({
  useAppStore: (selector: (state: any) => unknown) => selector({
    setView: vi.fn(),
    mockBashMode: false,
    gitBashInstallProgress: { phase: 'idle', progress: 0, message: '' },
    startGitBashInstall: vi.fn()
  })
}))

vi.mock('../../stores/space.store', () => ({
  useSpaceStore: (selector: (state: any) => unknown) => selector({
    currentSpace: mockState.mockCurrentSpace,
    kiteSpace: null,
    spaces: [
      {
        ...mockState.mockCurrentSpace,
        createdAt: '2026-03-25T08:00:00.000Z',
        updatedAt: '2026-03-25T09:00:00.000Z',
        stats: { artifactCount: 0, conversationCount: 1 }
      },
      {
        id: 'space-2',
        name: 'Space 2',
        icon: 'folder',
        isTemp: false,
        path: '/tmp/space-2',
        createdAt: '2026-03-25T07:00:00.000Z',
        updatedAt: '2026-03-25T10:00:00.000Z',
        stats: { artifactCount: 0, conversationCount: 1 }
      }
    ],
    loadSpaces: vi.fn(async () => {}),
    setCurrentSpace: vi.fn(),
    createSpace: vi.fn(async () => null),
    updateSpace: mockState.updateSpace,
    deleteSpace: mockState.deleteSpace
  })
}))

vi.mock('../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector({
    currentSpaceId: mockState.currentSpaceId,
    getCurrentConversationId: () => mockState.currentConversationId,
    getCurrentConversationMeta: () => ({ id: mockState.currentConversationId, title: '会话 A' }),
    spaceStates: mockState.spaceStates,
    setCurrentSpace: vi.fn(),
    loadConversations: vi.fn(async () => {}),
    createConversation: mockState.createConversation,
    selectConversation: mockState.selectConversation,
    renameConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => ({
      accepted: true,
      conversationId: 'conv-1',
      wasCurrent: false,
      nextConversationId: null,
      autoCreated: false,
      remainingCount: 1
    }))
  })
}))

vi.mock('../../stores/search.store', () => ({
  useSearchStore: (selector: (state: any) => unknown) => selector({
    openSearch: vi.fn()
  })
}))

import { UnifiedPage, resolveConversationSyncTarget } from '../UnifiedPage'

describe('UnifiedPage space session flow', () => {
  beforeEach(() => {
    mockState.currentSpaceId = 'space-1'
    mockState.currentConversationId = 'conv-1'
    mockState.capturedSidebarProps = null
    mockState.triggerTopTabClick = null
    mockState.activeTab = null
    mockState.openChat.mockClear()
    mockState.switchTab.mockClear()
    mockState.switchSpaceSession.mockClear()
    mockState.closeSpaceSession.mockClear()
    mockState.closeConversationTabs.mockClear()
    mockState.navigateToConversationContext.mockClear()
    mockState.navigateToSpaceContext.mockClear()
    mockState.createConversation.mockClear()
    mockState.selectConversation.mockClear()
    mockState.updateSpace.mockClear()
    mockState.deleteSpace.mockClear()
  })

  it('跨 space 打开会话时先导航到空间，再异步选中会话并 openChat(false)', async () => {
    renderToStaticMarkup(<UnifiedPage />)

    expect(mockState.capturedSidebarProps).toBeTruthy()

    await mockState.capturedSidebarProps?.onSelectConversation?.('space-2', 'conv-2')

    expect(mockState.navigateToSpaceContext).toHaveBeenCalledWith(expect.objectContaining({
      targetSpaceId: 'space-2'
    }))
    expect(mockState.navigateToConversationContext).not.toHaveBeenCalled()
    expect(mockState.switchSpaceSession).not.toHaveBeenCalled()
    expect(mockState.openChat).toHaveBeenCalledWith(
      'space-2',
      'conv-2',
      '会话 B',
      '/tmp/space-2',
      'Space 2',
      false
    )

    const navigateOrder = mockState.navigateToSpaceContext.mock.invocationCallOrder[0]
    const openOrder = mockState.openChat.mock.invocationCallOrder[0]
    expect(navigateOrder).toBeLessThan(openOrder)
  })

  it('快速连续切换会话时仅保留最后一次点击的 openChat', async () => {
    let resolveFirstNavigation: ((value: { success: boolean }) => void) | null = null
    const firstNavigation = new Promise<{ success: boolean }>((resolve) => {
      resolveFirstNavigation = resolve
    })

    mockState.navigateToSpaceContext
      .mockImplementationOnce(async () => firstNavigation)
      .mockImplementationOnce(async () => ({ success: true }))

    renderToStaticMarkup(<UnifiedPage />)
    expect(mockState.capturedSidebarProps).toBeTruthy()

    const firstClick = mockState.capturedSidebarProps?.onSelectConversation?.('space-2', 'conv-2')
    const secondClick = mockState.capturedSidebarProps?.onSelectConversation?.('space-1', 'conv-1')

    await Promise.resolve()
    resolveFirstNavigation?.({ success: true })

    await Promise.all([firstClick, secondClick])

    expect(mockState.openChat).toHaveBeenCalledTimes(1)
    expect(mockState.openChat).toHaveBeenCalledWith(
      'space-1',
      'conv-1',
      '会话 A',
      '/tmp/space-1',
      'Space 1',
      false
    )
  })

  it('顶部 tab 点击不会反向触发跨 space 导航', async () => {
    renderToStaticMarkup(<UnifiedPage />)

    expect(mockState.triggerTopTabClick).toBeTypeOf('function')

    mockState.navigateToConversationContext.mockClear()
    mockState.navigateToSpaceContext.mockClear()

    await mockState.triggerTopTabClick?.()

    expect(mockState.switchTab).toHaveBeenCalledWith('tab-space-2')
    expect(mockState.navigateToConversationContext).not.toHaveBeenCalled()
    expect(mockState.navigateToSpaceContext).not.toHaveBeenCalled()
    expect(
      resolveConversationSyncTarget(
        { type: 'chat', spaceId: 'space-1', conversationId: 'conv-2' },
        mockState.currentSpaceId,
        mockState.currentConversationId
      )
    ).toBe('conv-2')
  })

  it('点击工作区新建会话会创建并自动打开 chat tab', async () => {
    renderToStaticMarkup(<UnifiedPage />)

    expect(mockState.capturedSidebarProps).toBeTruthy()
    await mockState.capturedSidebarProps?.onCreateConversation?.('space-1')

    expect(mockState.createConversation).toHaveBeenCalledWith('space-1')
    expect(mockState.selectConversation).toHaveBeenCalledWith('conv-new')
    expect(mockState.openChat).toHaveBeenCalledWith(
      'space-1',
      'conv-new',
      '会话新建',
      '/tmp/space-1',
      'Space 1',
      false
    )
  })

  it('删除当前工作区会关闭该工作区会话并切换到最近更新工作区', async () => {
    renderToStaticMarkup(<UnifiedPage />)

    expect(mockState.capturedSidebarProps).toBeTruthy()
    await mockState.capturedSidebarProps?.onDeleteSpace?.('space-1')

    expect(mockState.deleteSpace).toHaveBeenCalledWith('space-1')
    expect(mockState.closeSpaceSession).toHaveBeenCalledWith('space-1')
    expect(mockState.navigateToSpaceContext).toHaveBeenCalledWith(expect.objectContaining({
      targetSpaceId: 'space-2'
    }))
  })
})
