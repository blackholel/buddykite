/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => key

const apiMock = vi.hoisted(() => ({
  generateSkillDraft: vi.fn(async () => ({
    success: true,
    data: {
      name: 'code-reviewer',
      description: 'review code and find high priority issues',
      content: '# code-reviewer'
    }
  })),
  generateAgentDraft: vi.fn(async () => ({
    success: true,
    data: {
      name: 'planner',
      description: 'plan tasks',
      content: '# planner'
    }
  }))
}))

const skillsStoreMock = vi.hoisted(() => ({
  createSkillInLibrary: vi.fn(async () => ({
    name: 'code-reviewer',
    path: '/tmp/Kite/Skills/code-reviewer',
    source: 'app',
    enabled: true,
  }))
}))

const agentsStoreMock = vi.hoisted(() => ({
  createAgentInLibrary: vi.fn(async () => ({
    name: 'planner',
    path: '/tmp/Kite/Agents/planner.md',
    source: 'app',
    enabled: true,
  }))
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
  useSkillsStore: (selector: (state: any) => unknown) => selector(skillsStoreMock)
}))

vi.mock('../../../stores/agents.store', () => ({
  useAgentsStore: (selector: (state: any) => unknown) => selector(agentsStoreMock)
}))

import { ResourceCreateModal } from '../ResourceCreateModal'

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

async function inputText(element: Element | null, value: string) {
  if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) {
    throw new Error('input element not found')
  }
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
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

describe('ResourceCreateModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockClear())
    skillsStoreMock.createSkillInLibrary.mockClear()
    agentsStoreMock.createAgentInLibrary.mockClear()
  })

  it('自然语言创建 happy path：生成草稿并写入技能资源库', async () => {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const renderer = createRenderer()
    await renderer.render(
      <ResourceCreateModal
        resourceType="skill"
        onClose={onClose}
        onCreated={onCreated}
      />
    )

    await inputText(
      renderer.container.querySelector('[data-testid="resource-create-description"]'),
      'Need a skill for code review quality gate'
    )
    await flushAsyncWork()
    await clickElement(renderer.container.querySelector('[data-testid="resource-create-generate"]'))
    await flushAsyncWork()

    const nameInput = renderer.container.querySelector('[data-testid="resource-create-name"]') as HTMLInputElement
    expect(nameInput).not.toBeNull()
    expect(nameInput.value).toBe('code-reviewer')

    await clickElement(renderer.container.querySelector('[data-testid="resource-create-submit"]'))
    await flushAsyncWork()

    expect(apiMock.generateSkillDraft).toHaveBeenCalledWith('Need a skill for code review quality gate')
    expect(skillsStoreMock.createSkillInLibrary).toHaveBeenCalledWith('code-reviewer', '# code-reviewer')
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    await renderer.unmount()
  })

  it('草稿生成失败时展示错误并阻止创建', async () => {
    apiMock.generateAgentDraft.mockResolvedValueOnce({
      success: false,
      error: 'generation failed'
    })

    const renderer = createRenderer()
    await renderer.render(
      <ResourceCreateModal
        resourceType="agent"
        onClose={vi.fn()}
      />
    )

    await inputText(
      renderer.container.querySelector('[data-testid="resource-create-description"]'),
      'Need an agent for strategy planning'
    )
    await flushAsyncWork()
    await clickElement(renderer.container.querySelector('[data-testid="resource-create-generate"]'))
    await flushAsyncWork()

    expect(renderer.container.textContent).toContain('generation failed')
    expect(agentsStoreMock.createAgentInLibrary).not.toHaveBeenCalled()
    await renderer.unmount()
  })
})
