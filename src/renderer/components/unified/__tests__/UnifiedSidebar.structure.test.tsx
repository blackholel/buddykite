import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationMeta, CreateSpaceInput, Space } from '../../../types'

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
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
  updatedAt: now,
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
  onCreateConversation: vi.fn(async (_spaceId: string) => {}),
  onRenameConversation: vi.fn(async (_spaceId: string, _conversationId: string, _title: string) => {}),
  onDeleteConversation: vi.fn(async (_spaceId: string, _conversationId: string) => {}),
  onGoHome: vi.fn(),
  onGoSettings: vi.fn()
}

describe('UnifiedSidebar structure', () => {
  it('expands only the current space conversations', () => {
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

    expect(html).toContain('conv-1')
    expect(html).not.toContain('conv-3')
  })
})
