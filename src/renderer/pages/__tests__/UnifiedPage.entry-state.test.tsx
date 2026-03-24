import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { navigateToConversationContext, navigateToSpaceContext } from '../../utils/space-conversation-navigation'

const mockCurrentSpace = {
  id: 'space-1',
  name: 'Space 1',
  icon: 'folder',
  isTemp: false,
  path: '/tmp/space-1'
}
let mockCurrentSpaceId = 'space-1'
let capturedSidebarProps: Record<string, any> | null = null
let triggerTopTabClick: null | (() => Promise<void>) = null
const mockCanvasState = {
  tabs: [] as Array<Record<string, unknown>>,
  activeTab: null as Record<string, unknown> | null,
  isOpen: false,
  openChat: vi.fn(async () => {}),
  switchSpaceSession: vi.fn(async () => {}),
  switchTab: vi.fn(async () => {}),
  setOpen: vi.fn()
}

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../hooks/useSearchShortcuts', () => ({
  useSearchShortcuts: () => {}
}))

vi.mock('../../hooks/useCanvasLifecycle', () => ({
  useCanvasLifecycle: () => mockCanvasState
}))

vi.mock('../../components/chat/ChatView', () => ({
  ChatView: () => <section>Chat Surface</section>
}))

vi.mock('../../components/artifact/ArtifactRail', () => ({
  ArtifactRail: () => <aside aria-label="Files and artifacts">Artifact Rail</aside>
}))

vi.mock('../../components/canvas', () => ({
  CanvasTabBar: () => {
    triggerTopTabClick = async () => {
      const targetTab = mockCanvasState.tabs.find((tab: any) => tab.spaceId === 'space-2')
      if (!targetTab?.id) return
      await mockCanvasState.switchTab(targetTab.id)
    }
    return <button onClick={() => { void triggerTopTabClick?.() }} role="tablist">Canvas Tab Bar</button>
  },
  CanvasToggleButton: () => <button>Canvas Toggle</button>,
  CollapsibleCanvas: () => <section>Canvas Surface</section>
}))

vi.mock('../../components/unified/UnifiedSidebar', () => ({
  UnifiedSidebar: (props: Record<string, any>) => {
    capturedSidebarProps = props
    return <aside>Unified Sidebar</aside>
  }
}))

vi.mock('../../components/setup/GitBashWarningBanner', () => ({
  GitBashWarningBanner: () => <div>Git Bash Warning</div>
}))

vi.mock('../../utils/workspace-view-mode', () => ({
  persistWorkspaceViewMode: vi.fn()
}))

vi.mock('../../utils/space-conversation-navigation', () => ({
  navigateToConversationContext: vi.fn(async () => ({ success: true })),
  navigateToSpaceContext: vi.fn(async () => ({ success: true }))
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
    currentSpace: mockCurrentSpace,
    kiteSpace: null,
    spaces: [],
    loadSpaces: vi.fn(async () => {}),
    setCurrentSpace: vi.fn(),
    createSpace: vi.fn(async () => null)
  })
}))

vi.mock('../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector({
    currentSpaceId: mockCurrentSpaceId,
    getCurrentConversationId: () => null,
    getCurrentConversationMeta: () => null,
    spaceStates: new Map(),
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

describe('UnifiedPage entry state', () => {
  beforeEach(() => {
    mockCurrentSpaceId = 'space-1'
    mockCurrentSpace.isTemp = false
    capturedSidebarProps = null
    triggerTopTabClick = null
    mockCanvasState.tabs = []
    mockCanvasState.activeTab = null
    mockCanvasState.isOpen = false
    mockCanvasState.openChat.mockClear()
    mockCanvasState.switchSpaceSession.mockClear()
    mockCanvasState.switchTab.mockClear()
    mockCanvasState.setOpen.mockClear()
    vi.mocked(navigateToConversationContext).mockClear()
    vi.mocked(navigateToSpaceContext).mockClear()
  })

  it('跨 space 会话激活走 space-first：先导航上下文，再切 session，再 openChat(false)', async () => {
    mockCanvasState.tabs = [{
      id: 'chat-tab-space-1',
      type: 'chat',
      title: '会话 A',
      conversationId: 'conv-1',
      spaceId: 'space-1'
    }]
    renderToStaticMarkup(<UnifiedPage />)

    expect(capturedSidebarProps).toBeTruthy()
    await capturedSidebarProps?.onSelectConversation?.('space-2', 'conv-2')

    expect(vi.mocked(navigateToConversationContext)).toHaveBeenCalledWith(expect.objectContaining({
      targetSpaceId: 'space-2',
      targetConversationId: 'conv-2'
    }))
    expect(mockCanvasState.switchSpaceSession).toHaveBeenCalledWith('space-2')
    expect(mockCanvasState.openChat).toHaveBeenCalledWith(
      'space-2',
      'conv-2',
      'New conversation',
      undefined,
      'Unknown space',
      false
    )

    const navigateOrder = vi.mocked(navigateToConversationContext).mock.invocationCallOrder[0]
    const switchOrder = mockCanvasState.switchSpaceSession.mock.invocationCallOrder[0]
    const openOrder = mockCanvasState.openChat.mock.invocationCallOrder[0]
    expect(navigateOrder).toBeLessThan(switchOrder)
    expect(switchOrder).toBeLessThan(openOrder)
  })

  it('顶部 tab 点击不会反向触发跨 space 导航', async () => {
    mockCanvasState.tabs = [
      {
        id: 'chat-tab-space-1',
        type: 'chat',
        title: '会话 A',
        conversationId: 'conv-1',
        spaceId: 'space-1'
      },
      {
        id: 'chat-tab-space-2',
        type: 'chat',
        title: '会话 B',
        conversationId: 'conv-2',
        spaceId: 'space-2'
      }
    ]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]

    renderToStaticMarkup(<UnifiedPage />)
    expect(triggerTopTabClick).toBeTypeOf('function')

    vi.mocked(navigateToConversationContext).mockClear()
    vi.mocked(navigateToSpaceContext).mockClear()
    await triggerTopTabClick?.()

    expect(mockCanvasState.switchTab).toHaveBeenCalledWith('chat-tab-space-2')
    expect(vi.mocked(navigateToConversationContext)).not.toHaveBeenCalled()
    expect(vi.mocked(navigateToSpaceContext)).not.toHaveBeenCalled()
  })

  it('只展示 currentSpaceId 对应 space 的 tabs', () => {
    mockCanvasState.tabs = [{
      id: 'chat-tab-space-2',
      type: 'chat',
      title: '会话 B',
      conversationId: 'conv-2',
      spaceId: 'space-2'
    }]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]

    const html = renderToStaticMarkup(<UnifiedPage />)
    expect(html).not.toContain('Canvas Toggle')
    expect(html).not.toContain('Canvas Surface')
  })

  it('切换并切回 space 时恢复该 space 对应的 tabs 可见性', () => {
    mockCanvasState.tabs = [{
      id: 'chat-tab-space-1',
      type: 'chat',
      title: '会话 A',
      conversationId: 'conv-1',
      spaceId: 'space-1'
    }]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]

    const inSpace1 = renderToStaticMarkup(<UnifiedPage />)
    expect(inSpace1).toContain('Canvas Toggle')

    mockCurrentSpaceId = 'space-2'
    const inSpace2 = renderToStaticMarkup(<UnifiedPage />)
    expect(inSpace2).not.toContain('Canvas Toggle')

    mockCurrentSpaceId = 'space-1'
    const backToSpace1 = renderToStaticMarkup(<UnifiedPage />)
    expect(backToSpace1).toContain('Canvas Toggle')
  })

  it('普通空间显示打开内容 tabs，并保留折叠的文件栏入口', () => {
    mockCanvasState.tabs = []
    mockCanvasState.activeTab = null
    const html = renderToStaticMarkup(<UnifiedPage />)

    expect(html).toContain('Unified Sidebar')
    expect(html).toContain('Chat Surface')
    expect(html).not.toContain('Canvas Toggle')
    expect(html).not.toContain('Canvas Surface')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('Files and artifacts')
    expect(html).not.toContain('What can I do')
    expect(html).not.toContain('Start in 3 simple steps')
    expect(html).not.toContain('Back to home')
    expect(html).not.toContain('All spaces')
  })

  it('temp 空间显示文件栏', () => {
    mockCurrentSpace.isTemp = true
    mockCanvasState.tabs = [{
      id: 'chat-tab-temp-1',
      type: 'chat',
      title: '会话 Temp',
      conversationId: 'conv-temp-1',
      spaceId: 'space-1'
    }]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]
    const html = renderToStaticMarkup(<UnifiedPage />)

    expect(html).toContain('Canvas Toggle')
    expect(html).toContain('Canvas Surface')
    expect(html).toContain('Files and artifacts')
  })

  it('普通空间有会话 tabs 时显示可切换画布区域', () => {
    mockCanvasState.tabs = [{
      id: 'chat-tab-1',
      type: 'chat',
      title: '会话 A',
      conversationId: 'conv-1',
      spaceId: 'space-1'
    }]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]

    const html = renderToStaticMarkup(<UnifiedPage />)
    expect(html).toContain('Canvas Toggle')
    expect(html).toContain('Canvas Surface')
  })
})
