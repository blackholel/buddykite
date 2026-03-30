/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockState = vi.hoisted(() => ({
  currentSpace: {
    id: 'space-1',
    name: 'Space 1',
    icon: 'folder',
    isTemp: false,
    path: '/tmp/space-1'
  },
  currentSpaceId: 'space-1',
  capturedSidebarProps: null as Record<string, any> | null,
  loadSpaces: vi.fn(async () => {}),
  setSpaceCurrentSpace: vi.fn(),
  setChatCurrentSpace: vi.fn(),
  loadConversations: vi.fn(async () => {}),
  selectConversation: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  deleteConversation: vi.fn(async () => ({
    accepted: true,
    conversationId: 'conv-1',
    wasCurrent: false,
    nextConversationId: null,
    autoCreated: false,
    remainingCount: 1
  })),
  createConversation: vi.fn(async () => null),
  updateSpace: vi.fn(async () => null),
  deleteSpace: vi.fn(async () => true),
  openChat: vi.fn(async () => {}),
  switchSpaceSession: vi.fn(async () => {}),
  closeSpaceSession: vi.fn(),
  closeConversationTabs: vi.fn(() => ({
    removedTabIds: [],
    removedActiveTab: false,
    nextActiveTabId: null,
    nextActiveChatConversationId: null
  })),
  setOpen: vi.fn(),
  openSearch: vi.fn()
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
    tabs: [],
    activeTab: null,
    isOpen: false,
    setOpen: mockState.setOpen,
    openChat: mockState.openChat,
    switchSpaceSession: mockState.switchSpaceSession,
    closeSpaceSession: mockState.closeSpaceSession,
    closeConversationTabs: mockState.closeConversationTabs
  })
}))

vi.mock('../../components/chat/ChatView', () => ({
  ChatView: () => <section data-testid="chat-surface">Chat Surface</section>
}))

vi.mock('../../components/home/ExtensionsView', () => ({
  ExtensionsView: () => <section data-testid="extensions-surface">Extensions View</section>
}))

vi.mock('../../components/artifact/ArtifactRail', () => ({
  ArtifactRail: (props: Record<string, unknown>) => {
    const onExpandedChange = typeof props.onExpandedChange === 'function'
      ? props.onExpandedChange as (expanded: boolean) => void
      : undefined
    return (
      <aside
        aria-label="Files and artifacts"
        data-artifact-expanded={String(Boolean(props.externalExpanded))}
        data-show-header-toggle={String(Boolean(props.showHeaderToggle))}
      >
        Artifact Rail
        <button data-testid="mock-expand-rail" onClick={() => onExpandedChange?.(true)}>expand rail</button>
        <button data-testid="mock-collapse-rail" onClick={() => onExpandedChange?.(false)}>collapse rail</button>
      </aside>
    )
  }
}))

vi.mock('../../components/canvas', () => ({
  CanvasTabBar: () => <div>Canvas Tab Bar</div>,
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
    currentSpace: mockState.currentSpace,
    kiteSpace: null,
    spaces: [],
    loadSpaces: mockState.loadSpaces,
    setCurrentSpace: mockState.setSpaceCurrentSpace,
    createSpace: vi.fn(async () => null),
    updateSpace: mockState.updateSpace,
    deleteSpace: mockState.deleteSpace
  })
}))

vi.mock('../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector({
    currentSpaceId: mockState.currentSpaceId,
    getCurrentConversationId: () => null,
    getCurrentConversationMeta: () => null,
    spaceStates: new Map(),
    setCurrentSpace: mockState.setChatCurrentSpace,
    loadConversations: mockState.loadConversations,
    createConversation: mockState.createConversation,
    selectConversation: mockState.selectConversation,
    renameConversation: mockState.renameConversation,
    deleteConversation: mockState.deleteConversation
  })
}))

vi.mock('../../stores/search.store', () => ({
  useSearchStore: (selector: (state: any) => unknown) => selector({
    openSearch: mockState.openSearch
  })
}))

import { UnifiedPage } from '../UnifiedPage'

function createRenderer() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  return {
    container,
    async render(element: JSX.Element) {
      await act(async () => {
        root.render(element)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  }
}

function getMockRailControlButton(
  container: HTMLElement,
  action: 'expand' | 'collapse'
): HTMLButtonElement {
  const selector = action === 'expand' ? '[data-testid="mock-expand-rail"]' : '[data-testid="mock-collapse-rail"]'
  const target = container.querySelector(selector)
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error(`mock rail ${action} button not found`)
  }
  return target
}

function getRailExpandedState(container: HTMLElement): string | null {
  return container.querySelector('[data-artifact-expanded]')?.getAttribute('data-artifact-expanded') ?? null
}

async function userClick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('UnifiedPage artifact rail toggle', () => {
  beforeEach(() => {
    mockState.capturedSidebarProps = null
    mockState.loadSpaces.mockClear()
    mockState.setSpaceCurrentSpace.mockClear()
    mockState.setChatCurrentSpace.mockClear()
    mockState.loadConversations.mockClear()
    mockState.selectConversation.mockClear()
    mockState.renameConversation.mockClear()
    mockState.deleteConversation.mockClear()
    mockState.createConversation.mockClear()
    mockState.updateSpace.mockClear()
    mockState.deleteSpace.mockClear()
    mockState.openChat.mockClear()
    mockState.switchSpaceSession.mockClear()
    mockState.closeSpaceSession.mockClear()
    mockState.closeConversationTabs.mockClear()
    mockState.setOpen.mockClear()
    mockState.openSearch.mockClear()
  })

  it('默认折叠，连续点击按钮会稳定翻转展开状态', async () => {
    const renderer = createRenderer()
    await renderer.render(<UnifiedPage />)

    expect(getRailExpandedState(renderer.container)).toBe('false')
    expect(renderer.container.querySelector('[data-show-header-toggle="true"]')).not.toBeNull()

    await userClick(getMockRailControlButton(renderer.container, 'expand'))
    expect(getRailExpandedState(renderer.container)).toBe('true')

    await userClick(getMockRailControlButton(renderer.container, 'collapse'))
    expect(getRailExpandedState(renderer.container)).toBe('false')

    await userClick(getMockRailControlButton(renderer.container, 'expand'))
    expect(getRailExpandedState(renderer.container)).toBe('true')

    await renderer.unmount()
  })

  it('技能资源模式不再显示顶部文件按钮，并可通过侧栏切回 artifacts', async () => {
    const renderer = createRenderer()
    await renderer.render(<UnifiedPage />)

    expect(mockState.capturedSidebarProps).toBeTruthy()
    await act(async () => {
      await mockState.capturedSidebarProps?.onOpenSkills?.()
    })

    expect(renderer.container.querySelector('[data-testid=\"extensions-surface\"]')).not.toBeNull()
    expect(renderer.container.querySelector('button[aria-label="显示文件面板"],button[aria-label="隐藏文件面板"]')).toBeNull()

    await act(async () => {
      await mockState.capturedSidebarProps?.onOpenSkills?.()
    })

    expect(renderer.container.querySelector('[data-testid=\"extensions-surface\"]')).toBeNull()
    expect(renderer.container.querySelector('[data-testid=\"chat-surface\"]')).not.toBeNull()

    await renderer.unmount()
  })
})
