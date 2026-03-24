import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

const mockCurrentSpace = {
  id: 'space-1',
  name: 'Space 1',
  icon: 'folder',
  isTemp: false,
  path: '/tmp/space-1'
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
  useCanvasLifecycle: () => ({
    isOpen: false,
    openChat: vi.fn(async () => {})
  })
}))

vi.mock('../../components/layout/Header', () => ({
  Header: ({ left, right }: { left?: ReactNode; right?: ReactNode }) => (
    <header>
      {left}
      {right}
    </header>
  )
}))

vi.mock('../../components/chat/ChatView', () => ({
  ChatView: () => <section>Chat Surface</section>
}))

vi.mock('../../components/artifact/ArtifactRail', () => ({
  ArtifactRail: () => <aside aria-label="Files and artifacts">Artifact Rail</aside>
}))

vi.mock('../../components/canvas', () => ({
  CanvasToggleButton: () => <button>Canvas Toggle</button>,
  CollapsibleCanvas: () => <section>Canvas Surface</section>
}))

vi.mock('../../components/unified/UnifiedSidebar', () => ({
  UnifiedSidebar: () => <aside>Unified Sidebar</aside>
}))

vi.mock('../../components/setup/GitBashWarningBanner', () => ({
  GitBashWarningBanner: () => <div>Git Bash Warning</div>
}))

vi.mock('../../components/icons/ToolIcons', () => ({
  SpaceIcon: () => <span>Space Icon</span>
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
    currentSpaceId: 'space-1',
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
  it('普通空间显示打开内容 tabs，并保留折叠的文件栏入口', () => {
    mockCurrentSpace.isTemp = false
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
    const html = renderToStaticMarkup(<UnifiedPage />)

    expect(html).toContain('Canvas Toggle')
    expect(html).toContain('Canvas Surface')
    expect(html).toContain('Files and artifacts')
  })
})
