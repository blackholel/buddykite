import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationMeta, CreateSpaceInput, Space } from '../../../types'

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.count === 'number') {
        return key.replace('{{count}}', String(options.count))
      }
      return key
    }
  }),
  getCurrentLanguage: () => 'en-US'
}))

vi.mock('../../icons/ToolIcons', () => ({
  SpaceIcon: () => <span>SpaceIcon</span>
}))

import { UnifiedSidebar } from '../UnifiedSidebar'

const now = '2026-03-24T10:00:00.000Z'

const spaceA: Space = {
  id: 'space-a',
  name: 'Space A',
  icon: 'folder',
  path: '/tmp/space-a',
  isTemp: false,
  createdAt: now,
  updatedAt: now,
  stats: {
    artifactCount: 0,
    conversationCount: 2
  }
}

const spaceB: Space = {
  id: 'space-b',
  name: 'Space B',
  icon: 'folder',
  path: '/tmp/space-b',
  isTemp: false,
  createdAt: now,
  updatedAt: now,
  stats: {
    artifactCount: 0,
    conversationCount: 1
  }
}

const conv1: ConversationMeta = {
  id: 'conv-1',
  spaceId: 'space-a',
  title: 'conv-1',
  createdAt: now,
  updatedAt: now,
  messageCount: 1
}

const conv2: ConversationMeta = {
  id: 'conv-2',
  spaceId: 'space-a',
  title: 'conv-2',
  createdAt: now,
  updatedAt: '2026-03-23T10:00:00.000Z',
  messageCount: 1
}

const conv3: ConversationMeta = {
  id: 'conv-3',
  spaceId: 'space-b',
  title: 'conv-3',
  createdAt: now,
  updatedAt: now,
  messageCount: 1
}

const handlers = {
  onSelectSpace: vi.fn(async (_spaceId: string) => {}),
  onExpandSpace: vi.fn(async (_spaceId: string) => {}),
  onSelectConversation: vi.fn(async (_spaceId: string, _conversationId: string) => {}),
  onCreateSpace: vi.fn(async (_input: CreateSpaceInput) => null),
  onCreateConversation: vi.fn(async (_spaceId: string) => null),
  onRenameSpace: vi.fn(async (_spaceId: string, _name: string) => {}),
  onDeleteSpace: vi.fn(async (_spaceId: string) => true),
  onRenameConversation: vi.fn(async (_spaceId: string, _conversationId: string, _title: string) => {}),
  onDeleteConversation: vi.fn(async (_spaceId: string, _conversationId: string) => {}),
  onOpenSkills: vi.fn(),
  onOpenAgents: vi.fn(),
  onToggleCollapse: vi.fn(),
  onGoSettings: vi.fn(),
  skillsOpen: false,
  agentsOpen: false,
  isCollapsed: false
}

describe('UnifiedSidebar structure', () => {
  it('会话尾部共用同一区域：默认显示时间，当前会话切换为操作按钮', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    const html = renderToStaticMarkup(
      <UnifiedSidebar
        spaces={[spaceA]}
        currentSpaceId="space-a"
        currentConversationId="conv-1"
        conversationsBySpaceId={new Map([
          ['space-a', [conv1, conv2]]
        ])}
        {...handlers}
      />
    )

    expect(html).toMatch(/data-conversation-id="conv-1"[\s\S]*?data-slot="time"[^>]*is-collapsed/)
    expect(html).toMatch(/data-conversation-id="conv-1"[\s\S]*?data-slot="actions"[^>]*is-active/)
    expect(html).toMatch(/data-conversation-id="conv-2"[\s\S]*?data-slot="time"[^>]*is-visible[^>]*>1 days ago</)
    expect(html).not.toMatch(/data-conversation-id="conv-2"[\s\S]*?data-slot="actions"[^>]*is-active/)
    expect(html).toMatch(/data-conversation-id="conv-1"[\s\S]*?space-studio-history-simple-title/)
    expect(html).toMatch(/data-conversation-id="conv-1"[\s\S]*?unified-sidebar-history-tail/)
    expect(html).toMatch(/data-conversation-id="conv-2"[\s\S]*?space-studio-history-simple-title/)
    expect(html).toMatch(/data-conversation-id="conv-2"[\s\S]*?unified-sidebar-history-tail/)

    vi.useRealTimers()
  })

  it('默认仅展开当前空间，其他空间保持折叠', () => {
    const html = renderToStaticMarkup(
      <UnifiedSidebar
        spaces={[spaceA, spaceB]}
        currentSpaceId="space-a"
        currentConversationId="conv-1"
        conversationsBySpaceId={new Map([
          ['space-a', [conv1, conv2]],
          ['space-b', [conv3]]
        ])}
        {...handlers}
      />
    )

    expect(html).toContain('Space A')
    expect(html).toContain('Space B')
    expect(html).toContain('conv-1')
    expect(html).not.toContain('conv-3')
    expect(html).toContain('aria-controls="space-panel-space-a"')
    expect(html).toContain('aria-controls="space-panel-space-b"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('左栏顶部保留精简入口并提供折叠按钮', () => {
    const html = renderToStaticMarkup(
      <UnifiedSidebar
        spaces={[spaceA, spaceB]}
        currentSpaceId="space-a"
        currentConversationId="conv-1"
        conversationsBySpaceId={new Map([
          ['space-a', [conv1, conv2]],
          ['space-b', [conv3]]
        ])}
        {...handlers}
      />
    )

    expect(html).not.toContain('快捷操作')
    expect(html).not.toContain('新线程')
    expect(html).not.toContain('自动化')
    expect(html).toContain('新建工作区')
    expect(html).toContain('技能')
    expect(html).toContain('智能体')
    expect(html).toContain('工作区')
    expect(html).toContain('新建会话')
    expect(html).toContain('更多操作')
    expect(html).toContain('折叠侧边栏')
  })

  it('折叠态展示紧凑工具栏并提供展开入口', () => {
    const html = renderToStaticMarkup(
      <UnifiedSidebar
        spaces={[spaceA, spaceB]}
        currentSpaceId="space-a"
        currentConversationId="conv-1"
        conversationsBySpaceId={new Map([
          ['space-a', [conv1, conv2]],
          ['space-b', [conv3]]
        ])}
        {...handlers}
        isCollapsed
      />
    )

    expect(html).toContain('space-studio-collapsed-rail')
    expect(html).toContain('展开侧边栏')
    expect(html).toContain('新建工作区')
    expect(html).toContain('技能')
    expect(html).toContain('智能体')
    expect(html).not.toContain('自动化')
  })

  it('新建工作区弹窗展示创建方式与引导文案', () => {
    const html = renderToStaticMarkup(
      <UnifiedSidebar
        spaces={[spaceA, spaceB]}
        currentSpaceId="space-a"
        currentConversationId="conv-1"
        conversationsBySpaceId={new Map([
          ['space-a', [conv1, conv2]],
          ['space-b', [conv3]]
        ])}
        initialCreateDialogOpen
        {...handlers}
      />
    )

    expect(html).toContain('新建工作区')
    expect(html).toContain('工作区名称')
    expect(html).toContain('创建位置')
    expect(html).toContain('默认目录')
    expect(html).toContain('本地文件夹')
    expect(html).toContain('Loading...')
  })
})
