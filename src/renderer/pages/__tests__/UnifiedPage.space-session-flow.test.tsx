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
  openChat: vi.fn(async () => {}),
  switchTab: vi.fn(async () => {}),
  switchSpaceSession: vi.fn(async () => {}),
  navigateToConversationContext: vi.fn(async () => ({ success: true })),
  navigateToSpaceContext: vi.fn(async () => ({ success: true })),
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
    activeTab: null,
    isOpen: false,
    setOpen: vi.fn(),
    openChat: mockState.openChat,
    switchTab: mockState.switchTab,
    switchSpaceSession: mockState.switchSpaceSession
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
      mockState.mockCurrentSpace,
      { id: 'space-2', name: 'Space 2', icon: 'folder', isTemp: false, path: '/tmp/space-2' }
    ],
    loadSpaces: vi.fn(async () => {}),
    setCurrentSpace: vi.fn(),
    createSpace: vi.fn(async () => null)
  })
}))

vi.mock('../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector({
    currentSpaceId: mockState.currentSpaceId,
    getCurrentConversationId: () => 'conv-1',
    getCurrentConversationMeta: () => ({ id: 'conv-1', title: '会话 A' }),
    spaceStates: mockState.spaceStates,
    setCurrentSpace: vi.fn(),
    loadConversations: vi.fn(async () => {}),
    createConversation: vi.fn(async () => null),
    selectConversation: vi.fn(async () => {}),
    renameConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {})
  })
}))

vi.mock('../../stores/search.store', () => ({
  useSearchStore: (selector: (state: any) => unknown) => selector({
    openSearch: vi.fn()
  })
}))

import { UnifiedPage } from '../UnifiedPage'

describe('UnifiedPage space session flow', () => {
  beforeEach(() => {
    mockState.currentSpaceId = 'space-1'
    mockState.capturedSidebarProps = null
    mockState.triggerTopTabClick = null
    mockState.openChat.mockClear()
    mockState.switchTab.mockClear()
    mockState.switchSpaceSession.mockClear()
    mockState.navigateToConversationContext.mockClear()
    mockState.navigateToSpaceContext.mockClear()
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
  })
})
