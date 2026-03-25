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
  deleteConversation: vi.fn(async () => {}),
  openChat: vi.fn(async () => {}),
  switchSpaceSession: vi.fn(async () => {}),
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
    switchSpaceSession: mockState.switchSpaceSession
  })
}))

vi.mock('../../components/chat/ChatView', () => ({
  ChatView: () => <section data-testid="chat-surface">Chat Surface</section>
}))

vi.mock('../../components/home/ExtensionsView', () => ({
  ExtensionsView: () => <section data-testid="extensions-surface">Extensions View</section>
}))

vi.mock('../../components/artifact/ArtifactRail', () => ({
  ArtifactRail: (props: Record<string, unknown>) => (
    <aside
      aria-label="Files and artifacts"
      data-artifact-expanded={String(Boolean(props.externalExpanded))}
    >
      Artifact Rail
    </aside>
  )
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
    createSpace: vi.fn(async () => null)
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

function getRailToggleButton(container: HTMLElement): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'))
  const target = buttons.find((button) => {
    const label = button.getAttribute('aria-label')
    return label === '显示文件面板' || label === '隐藏文件面板'
  })
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error('artifact rail toggle button not found')
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
    mockState.openChat.mockClear()
    mockState.switchSpaceSession.mockClear()
    mockState.setOpen.mockClear()
    mockState.openSearch.mockClear()
  })

  it('默认折叠，连续点击按钮会稳定翻转展开状态', async () => {
    const renderer = createRenderer()
    await renderer.render(<UnifiedPage />)

    let button = getRailToggleButton(renderer.container)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(getRailExpandedState(renderer.container)).toBe('false')

    const expected = ['true', 'false', 'true', 'false', 'true']
    for (const nextState of expected) {
      await userClick(button)
      button = getRailToggleButton(renderer.container)
      expect(button.getAttribute('aria-pressed')).toBe(nextState)
      expect(getRailExpandedState(renderer.container)).toBe(nextState)
    }

    await renderer.unmount()
  })

  it('abilities 模式首次点击文件夹会切回 artifacts 并展开', async () => {
    const renderer = createRenderer()
    await renderer.render(<UnifiedPage />)

    expect(mockState.capturedSidebarProps).toBeTruthy()
    await act(async () => {
      await mockState.capturedSidebarProps?.onOpenAbilities?.()
    })

    expect(renderer.container.querySelector('[data-testid=\"extensions-surface\"]')).not.toBeNull()

    const button = getRailToggleButton(renderer.container)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await userClick(button)

    const toggledButton = getRailToggleButton(renderer.container)
    expect(toggledButton.getAttribute('aria-pressed')).toBe('true')
    expect(getRailExpandedState(renderer.container)).toBe('true')
    expect(renderer.container.querySelector('[data-testid=\"chat-surface\"]')).not.toBeNull()
    expect(renderer.container.querySelector('[data-testid=\"extensions-surface\"]')).toBeNull()

    await renderer.unmount()
  })
})
