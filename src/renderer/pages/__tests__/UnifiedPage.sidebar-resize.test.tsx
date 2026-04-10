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
  ChatView: () => <section>Chat Surface</section>
}))

vi.mock('../../components/home/ExtensionsView', () => ({
  ExtensionsView: () => <section>Extensions View</section>
}))

vi.mock('../../components/artifact/ArtifactRail', () => ({
  ArtifactRail: () => <aside aria-label="Files and artifacts">Artifact Rail</aside>
}))

vi.mock('../../components/canvas', () => ({
  CanvasTabBar: () => <div>Canvas Tab Bar</div>,
  CollapsibleCanvas: () => <section>Canvas Surface</section>
}))

vi.mock('../../components/unified/UnifiedSidebar', () => ({
  UnifiedSidebar: (props: Record<string, any>) => {
    mockState.capturedSidebarProps = props
    return (
      <aside
        data-testid="mock-unified-sidebar"
        data-collapsed={String(Boolean(props.isCollapsed))}
        data-expanded-width={props.expandedWidth != null ? String(props.expandedWidth) : ''}
      >
        <button data-testid="mock-toggle-sidebar" onClick={props.onToggleCollapse}>toggle</button>
      </aside>
    )
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

function createPointerEvent(type: string, clientX: number, pointerId = 1): Event {
  const PointerCtor = window.PointerEvent ?? window.MouseEvent
  const event = new PointerCtor(type, { bubbles: true, cancelable: true, clientX })
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', { value: pointerId })
  }
  return event
}

async function userClick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function dragHandle(handle: Element, fromX: number, toX: number) {
  await act(async () => {
    handle.dispatchEvent(createPointerEvent('pointerdown', fromX))
    handle.dispatchEvent(createPointerEvent('pointermove', toX))
    handle.dispatchEvent(createPointerEvent('pointerup', toX))
  })
}

describe('UnifiedPage sidebar resize', () => {
  beforeEach(() => {
    localStorage.clear()
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

    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn()
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn()
    })
  })

  it('左栏展开时显示拖拽条，折叠时隐藏', async () => {
    const renderer = createRenderer()
    await renderer.render(<UnifiedPage />)

    expect(renderer.container.querySelector('[data-testid="unified-sidebar-resize-handle"]')).not.toBeNull()
    await userClick(renderer.container.querySelector('[data-testid="mock-toggle-sidebar"]') as Element)
    expect(renderer.container.querySelector('[data-testid="unified-sidebar-resize-handle"]')).toBeNull()

    await renderer.unmount()
  })

  it('拖拽宽度会被 clamp 到 220~400，并在 pointerup 后持久化', async () => {
    const renderer = createRenderer()
    await renderer.render(<UnifiedPage />)

    const sidebar = renderer.container.querySelector('[data-testid="mock-unified-sidebar"]')
    const handle = renderer.container.querySelector('[data-testid="unified-sidebar-resize-handle"]')
    expect(sidebar?.getAttribute('data-expanded-width')).toBe('288')
    expect(handle).not.toBeNull()

    await dragHandle(handle as Element, 240, 900)
    expect(sidebar?.getAttribute('data-expanded-width')).toBe('400')
    expect(localStorage.getItem('hello-halo:unified-sidebar-width')).toBe('400')

    await dragHandle(handle as Element, 400, -300)
    expect(sidebar?.getAttribute('data-expanded-width')).toBe('220')
    expect(localStorage.getItem('hello-halo:unified-sidebar-width')).toBe('220')

    await renderer.unmount()
  })

  it('启动时从 localStorage 恢复侧栏宽度', async () => {
    localStorage.setItem('hello-halo:unified-sidebar-width', '333')
    const renderer = createRenderer()
    await renderer.render(<UnifiedPage />)

    const sidebar = renderer.container.querySelector('[data-testid="mock-unified-sidebar"]')
    expect(sidebar?.getAttribute('data-expanded-width')).toBe('333')

    await renderer.unmount()
  })
})
