/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => key

const apiMock = vi.hoisted(() => ({
  getAgentResourceHash: vi.fn(async () => ({ success: true, data: { hash: 'hash', sessionResourceHash: 'hash' } })),
  refreshSkillsIndex: vi.fn(async () => ({ success: true, data: null })),
  importSkillToLibrary: vi.fn(async () => ({ success: true, data: { status: 'imported' } })),
  importAgentToLibrary: vi.fn(async () => ({ success: true, data: { status: 'imported' } }))
}))

const skillsStoreMock = vi.hoisted(() => ({
  skills: [
    { name: 'existing-skill', path: '/tmp/Kite/Skills/existing-skill', source: 'app', enabled: true, exposure: 'public' }
  ],
  isLoading: false,
  loadSkills: vi.fn(async () => {}),
  openSkillsLibraryFolder: vi.fn(async () => true),
  loadedWorkDir: null,
  lastRefreshReason: null,
  lastRefreshTs: null
}))

const agentsStoreMock = vi.hoisted(() => ({
  agents: [
    { name: 'existing-agent', path: '/tmp/Kite/Agents/existing-agent.md', source: 'app', enabled: true, exposure: 'public' }
  ],
  isLoading: false,
  loadAgents: vi.fn(async () => {}),
  openAgentsLibraryFolder: vi.fn(async () => true)
}))

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t
  })
}))

vi.mock('../../../api', () => ({
  api: apiMock
}))

vi.mock('../../../stores/skills.store', () => ({
  useSkillsStore: () => skillsStoreMock
}))

vi.mock('../../../stores/agents.store', () => ({
  useAgentsStore: () => agentsStoreMock
}))

vi.mock('../../../stores/space.store', () => ({
  useSpaceStore: () => ({
    currentSpace: {
      id: 'space-1',
      path: '/tmp/space-1'
    }
  })
}))

vi.mock('../../../stores/chat.store', () => ({
  useChatStore: (selector: (state: any) => unknown) => selector({
    currentSpaceId: null,
    spaceStates: new Map()
  })
}))

vi.mock('../../resources/ResourceCard', () => ({
  ResourceCard: () => <div data-testid="resource-card" />
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

function createDropEvent(path: string): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files: [{ path }],
      items: [],
      getData: () => ''
    }
  })
  return event
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('ExtensionsView import drop', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockClear())
    skillsStoreMock.loadSkills.mockClear()
    agentsStoreMock.loadAgents.mockClear()
  })

  it('技能页拖入目录时触发 skill 导入', async () => {
    const renderer = createRenderer()
    await renderer.render(<ExtensionsView resourceType="skill" />)

    const dropzone = renderer.container.querySelector('[data-testid="resource-library-dropzone"]')
    if (!dropzone) throw new Error('dropzone not found')

    await act(async () => {
      dropzone.dispatchEvent(createDropEvent('/tmp/review-skill'))
    })
    await flushAsyncWork()

    expect(apiMock.importSkillToLibrary).toHaveBeenCalledWith('/tmp/review-skill')
    await renderer.unmount()
  })

  it('智能体页拖入 markdown 时触发 agent 导入', async () => {
    const renderer = createRenderer()
    await renderer.render(<ExtensionsView resourceType="agent" />)

    const dropzone = renderer.container.querySelector('[data-testid="resource-library-dropzone"]')
    if (!dropzone) throw new Error('dropzone not found')

    await act(async () => {
      dropzone.dispatchEvent(createDropEvent('/tmp/reviewer.md'))
    })
    await flushAsyncWork()

    expect(apiMock.importAgentToLibrary).toHaveBeenCalledWith('/tmp/reviewer.md')
    await renderer.unmount()
  })
})
