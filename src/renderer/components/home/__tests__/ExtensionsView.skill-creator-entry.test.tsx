/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => key

const mockCreateConversation = vi.hoisted(() => vi.fn(async () => ({
  id: 'conv-skill',
  title: 'New conversation'
})))
const mockOpenChat = vi.hoisted(() => vi.fn(async () => 'tab-chat-1'))
const mockQueueBootstrapChip = vi.hoisted(() => vi.fn())
const mockLoadSkills = vi.hoisted(() => vi.fn(async () => {}))
const mockLoadAgents = vi.hoisted(() => vi.fn(async () => {}))

const spaceStoreState = vi.hoisted(() => ({
  currentSpace: {
    id: 'space-1',
    name: 'Space 1',
    path: '/tmp/space-1'
  },
  spaces: [] as Array<{ id: string; name: string; path: string }>,
  kiteSpace: null as { id: string; name: string; path: string } | null
}))

const mockOpenSkillCreatorConversation = vi.hoisted(() => vi.fn(async () => {
  await mockCreateConversation('space-1')
  await mockOpenChat('space-1', 'conv-skill', 'New conversation', '/tmp/space-1', 'Space 1', false)
  mockQueueBootstrapChip('conv-skill', {
    id: 'skill:skill-creator',
    type: 'skill',
    displayName: 'skill-creator',
    token: '/skill-creator'
  })
  return true
}))

const chatStoreState = vi.hoisted(() => ({
  currentSpaceId: 'space-1',
  spaceStates: new Map([['space-1', { currentConversationId: 'conv-0' }]]),
  openSkillCreatorConversation: mockOpenSkillCreatorConversation
}))

const apiMock = vi.hoisted(() => ({
  getAgentResourceHash: vi.fn(async () => ({ success: true, data: { hash: 'hash', sessionResourceHash: 'hash' } })),
  refreshSkillsIndex: vi.fn(async () => ({ success: true, data: null })),
  importSkillToLibrary: vi.fn(async () => ({ success: true, data: { status: 'imported' } })),
  importAgentToLibrary: vi.fn(async () => ({ success: true, data: { status: 'imported' } }))
}))

vi.mock('../../../i18n', () => ({
  getCurrentLanguage: () => 'zh-CN',
  useTranslation: () => ({ t })
}))

vi.mock('../../../api', () => ({
  api: apiMock
}))

vi.mock('../../../stores/skills.store', () => ({
  useSkillsStore: () => ({
    skills: [],
    isLoading: false,
    loadSkills: mockLoadSkills,
    openSkillsLibraryFolder: vi.fn(async () => true),
    loadedWorkDir: null,
    lastRefreshReason: null,
    lastRefreshTs: null
  })
}))

vi.mock('../../../stores/agents.store', () => ({
  useAgentsStore: () => ({
    agents: [],
    isLoading: false,
    loadAgents: mockLoadAgents,
    openAgentsLibraryFolder: vi.fn(async () => true)
  })
}))

vi.mock('../../../stores/space.store', () => ({
  useSpaceStore: (selector?: (state: any) => unknown) => {
    return typeof selector === 'function' ? selector(spaceStoreState) : spaceStoreState
  }
}))

vi.mock('../../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector(chatStoreState)
}))

vi.mock('../../resources/ResourceCard', () => ({
  ResourceCard: () => <div data-testid="resource-card" />
}))

vi.mock('../../resources/ResourceCreateModal', () => ({
  ResourceCreateModal: () => <div data-testid="resource-create-modal" />
}))

import { ExtensionsView } from '../ExtensionsView'

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

async function clickElement(element: Element | null) {
  if (!element) throw new Error('element not found')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('ExtensionsView skill creator entry', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  beforeEach(() => {
    spaceStoreState.currentSpace = {
      id: 'space-1',
      name: 'Space 1',
      path: '/tmp/space-1'
    }
    spaceStoreState.kiteSpace = null
    spaceStoreState.spaces = []
    chatStoreState.currentSpaceId = 'space-1'
    chatStoreState.spaceStates = new Map([['space-1', { currentConversationId: 'conv-0' }]])
    mockOpenSkillCreatorConversation.mockClear()
    mockCreateConversation.mockClear()
    mockOpenChat.mockClear()
    mockQueueBootstrapChip.mockClear()
    mockLoadSkills.mockClear()
    mockLoadAgents.mockClear()
  })

  it('creates skill creator conversation entry without opening resource create modal', async () => {
    const renderer = createRenderer()
    await renderer.render(<ExtensionsView resourceType="skill" />)

    const createButton = Array.from(renderer.container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Create')

    await clickElement(createButton || null)
    await flushAsyncWork()

    expect(mockOpenSkillCreatorConversation).toHaveBeenCalledWith('space-1', '/tmp/space-1', 'Space 1')
    expect(mockCreateConversation).toHaveBeenCalledWith('space-1')
    expect(mockOpenChat).toHaveBeenCalledWith(
      'space-1',
      'conv-skill',
      'New conversation',
      '/tmp/space-1',
      'Space 1',
      false
    )
    expect(mockQueueBootstrapChip).toHaveBeenCalledWith(
      'conv-skill',
      expect.objectContaining({ token: '/skill-creator' })
    )
    expect(renderer.container.querySelector('[data-testid="resource-create-modal"]')).toBeNull()

    await renderer.unmount()
  })

  it('resolves target space from space list when currentSpace is temporarily null', async () => {
    spaceStoreState.currentSpace = null
    spaceStoreState.spaces = [
      { id: 'space-1', name: 'Space 1', path: '/tmp/space-1' }
    ]

    const onOpened = vi.fn()
    const renderer = createRenderer()
    await renderer.render(<ExtensionsView resourceType="skill" onSkillConversationOpened={onOpened} />)

    const createButton = Array.from(renderer.container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Create')

    await clickElement(createButton || null)
    await flushAsyncWork()

    expect(mockLoadSkills).toHaveBeenCalledWith('/tmp/space-1')
    expect(mockOpenSkillCreatorConversation).toHaveBeenCalledWith('space-1', '/tmp/space-1', 'Space 1')
    expect(onOpened).toHaveBeenCalledTimes(1)

    await renderer.unmount()
  })
})
