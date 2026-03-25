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
let rightPanelModeOverride: 'artifacts' | 'abilities' | null = null
const setRightPanelModeMock = vi.fn()
const mockCanvasState = {
  tabs: [] as Array<Record<string, unknown>>,
  activeTab: null as Record<string, unknown> | null,
  isOpen: false,
  openChat: vi.fn(async () => {}),
  switchSpaceSession: vi.fn(async () => {}),
  switchTab: vi.fn(async () => {}),
  setOpen: vi.fn()
}

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: ((initial: unknown) => {
      if (initial === 'artifacts') {
        return [rightPanelModeOverride ?? initial, setRightPanelModeMock]
      }
      return actual.useState(initial)
    }) as typeof actual.useState
  }
})

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

vi.mock('../../components/home/ExtensionsView', () => ({
  ExtensionsView: () => <section>Extensions View</section>
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
    rightPanelModeOverride = null
    setRightPanelModeMock.mockClear()
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

  it('跨 space 会话激活先导航到空间，再异步选中会话并 openChat(false)', async () => {
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

    expect(vi.mocked(navigateToSpaceContext)).toHaveBeenCalledWith(expect.objectContaining({
      targetSpaceId: 'space-2'
    }))
    expect(vi.mocked(navigateToConversationContext)).not.toHaveBeenCalled()
    expect(mockCanvasState.switchSpaceSession).not.toHaveBeenCalled()
    expect(mockCanvasState.openChat).toHaveBeenCalledWith(
      'space-2',
      'conv-2',
      'New conversation',
      undefined,
      'Unknown space',
      false
    )

    const navigateOrder = vi.mocked(navigateToSpaceContext).mock.invocationCallOrder[0]
    const openOrder = mockCanvasState.openChat.mock.invocationCallOrder[0]
    expect(navigateOrder).toBeLessThan(openOrder)
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
    expect(html).not.toContain('Canvas Tab Bar')
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
    expect(inSpace1).toContain('Canvas Tab Bar')

    mockCurrentSpaceId = 'space-2'
    const inSpace2 = renderToStaticMarkup(<UnifiedPage />)
    expect(inSpace2).not.toContain('Canvas Tab Bar')

    mockCurrentSpaceId = 'space-1'
    const backToSpace1 = renderToStaticMarkup(<UnifiedPage />)
    expect(backToSpace1).toContain('Canvas Tab Bar')
  })

  it('当前激活 tab 为 chat 时不渲染右侧 Canvas 内容区', () => {
    mockCanvasState.tabs = [{
      id: 'chat-tab-space-1',
      type: 'chat',
      title: '会话 A',
      conversationId: 'conv-1',
      spaceId: 'space-1'
    }]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]
    mockCanvasState.isOpen = true

    const html = renderToStaticMarkup(<UnifiedPage />)

    expect(html).toContain('Canvas Tab Bar')
    expect(html).not.toContain('Canvas Surface')
  })

  it('普通空间显示打开内容 tabs，并保留折叠的文件栏入口', () => {
    mockCanvasState.tabs = []
    mockCanvasState.activeTab = null
    const html = renderToStaticMarkup(<UnifiedPage />)

    expect(html).toContain('Unified Sidebar')
    expect(html).toContain('Chat Surface')
    expect(html).not.toContain('Canvas Tab Bar')
    expect(html).not.toContain('Canvas Surface')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('Files and artifacts')
    expect(html).not.toContain('What can I do')
    expect(html).not.toContain('Start in 3 simple steps')
    expect(html).not.toContain('Back to home')
    expect(html).not.toContain('All spaces')
  })

  it('点击能力入口时会请求右侧切到能力面板', async () => {
    renderToStaticMarkup(<UnifiedPage />)

    await capturedSidebarProps?.onOpenAbilities?.()

    expect(setRightPanelModeMock).toHaveBeenCalledTimes(1)
    const updater = setRightPanelModeMock.mock.calls[0]?.[0]
    expect(typeof updater).toBe('function')
    expect(updater('artifacts')).toBe('abilities')
  })

  it('能力面板已打开时再次点击入口会切回文件栏', async () => {
    rightPanelModeOverride = 'abilities'
    renderToStaticMarkup(<UnifiedPage />)

    await capturedSidebarProps?.onOpenAbilities?.()

    expect(setRightPanelModeMock).toHaveBeenCalledTimes(1)
    const updater = setRightPanelModeMock.mock.calls[0]?.[0]
    expect(typeof updater).toBe('function')
    expect(updater('abilities')).toBe('artifacts')
  })

  it('能力模式会替换主对话区为扩展页，并隐藏文件栏', () => {
    rightPanelModeOverride = 'abilities'

    const html = renderToStaticMarkup(<UnifiedPage />)

    expect(html).toContain('Extensions View')
    expect(html).not.toContain('Chat Surface')
    expect(html).not.toContain('Files and artifacts')
  })

  it('切换工作区时会请求右侧恢复文件栏', async () => {
    renderToStaticMarkup(<UnifiedPage />)

    await capturedSidebarProps?.onSelectSpace?.('space-2')

    expect(setRightPanelModeMock).toHaveBeenCalledWith('artifacts')
  })

  it('切换线程时会请求右侧恢复文件栏', async () => {
    renderToStaticMarkup(<UnifiedPage />)

    await capturedSidebarProps?.onSelectConversation?.('space-1', 'conv-1')

    expect(setRightPanelModeMock).toHaveBeenCalledWith('artifacts')
  })

  it('temp 空间显示文件栏（chat tab 激活时不展示右侧画布）', () => {
    mockCurrentSpace.isTemp = true
    mockCanvasState.tabs = [{
      id: 'chat-tab-temp-1',
      type: 'chat',
      title: '会话 Temp',
      conversationId: 'conv-temp-1',
      spaceId: 'space-1'
    }]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]
    mockCanvasState.isOpen = true
    const html = renderToStaticMarkup(<UnifiedPage />)

    expect(html).toContain('Canvas Tab Bar')
    expect(html).not.toContain('Canvas Surface')
    expect(html).toContain('Files and artifacts')
  })

  it('普通空间有文件 tab 且画布已展开时显示右侧画布区域', () => {
    mockCanvasState.tabs = [{
      id: 'file-tab-1',
      type: 'markdown',
      title: 'readme.md',
      path: '/tmp/space-1/readme.md',
      spaceId: 'space-1',
      isDirty: false,
      isLoading: false
    }]
    mockCanvasState.activeTab = mockCanvasState.tabs[0]
    mockCanvasState.isOpen = true

    const html = renderToStaticMarkup(<UnifiedPage />)
    expect(html).toContain('Canvas Tab Bar')
    expect(html).toContain('Canvas Surface')
  })
})
