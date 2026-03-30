/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Space } from '../../../types'
import { UnifiedSidebar } from '../UnifiedSidebar'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

vi.mock('../../../api', () => ({
  api: {
    getDefaultSpacePath: vi.fn(async () => ({ success: true, data: '/tmp/spaces' })),
    selectFolder: vi.fn(async () => ({ success: true, data: '/tmp/custom-space' }))
  }
}))

const baseTime = '2026-03-25T08:00:00.000Z'
const normalSpace: Space = {
  id: 'space-a',
  name: 'Workspace A',
  icon: 'folder',
  path: '/tmp/space-a',
  isTemp: false,
  createdAt: baseTime,
  updatedAt: baseTime,
  stats: { artifactCount: 0, conversationCount: 1 }
}

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

async function userClick(element: Element | null) {
  if (!element) throw new Error('element not found')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('input not found')
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll('button'))
  for (const button of buttons) {
    if (button.textContent?.trim() === text) return button
  }
  return null
}

describe('UnifiedSidebar actions', () => {
  const handlers = {
    onSelectSpace: vi.fn(async (_spaceId: string) => {}),
    onExpandSpace: vi.fn(async (_spaceId: string) => {}),
    onSelectConversation: vi.fn(async (_spaceId: string, _conversationId: string) => {}),
    onCreateSpace: vi.fn(async () => null),
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

  beforeEach(() => {
    Object.values(handlers).forEach((handler) => {
      if (typeof handler === 'function' && 'mockClear' in handler) {
        handler.mockClear()
      }
    })
  })

  it('点击技能与智能体入口触发对应切换动作', async () => {
    const renderer = createRenderer()
    await renderer.render(
      <UnifiedSidebar
        spaces={[normalSpace]}
        currentSpaceId="space-a"
        currentConversationId={null}
        conversationsBySpaceId={new Map([['space-a', []]])}
        {...handlers}
      />
    )

    await userClick(renderer.container.querySelector('button[aria-label="技能"]'))
    await userClick(renderer.container.querySelector('button[aria-label="智能体"]'))

    expect(handlers.onOpenSkills).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenAgents).toHaveBeenCalledTimes(1)
    await renderer.unmount()
  })

  it('点击工作区行 + 会直接调用新建会话', async () => {
    const renderer = createRenderer()
    await renderer.render(
      <UnifiedSidebar
        spaces={[normalSpace]}
        currentSpaceId="space-a"
        currentConversationId={null}
        conversationsBySpaceId={new Map([['space-a', []]])}
        {...handlers}
      />
    )

    const createConversationButtons = Array.from(renderer.container.querySelectorAll('button[aria-label="新建会话"]'))
    expect(createConversationButtons.length).toBeGreaterThan(0)
    await userClick(createConversationButtons[0])

    expect(handlers.onCreateConversation).toHaveBeenCalledTimes(1)
    expect(handlers.onCreateConversation).toHaveBeenCalledWith('space-a')
    await renderer.unmount()
  })

  it('删除工作区必须输入同名后才可点击确认', async () => {
    const renderer = createRenderer()
    await renderer.render(
      <UnifiedSidebar
        spaces={[normalSpace]}
        currentSpaceId="space-a"
        currentConversationId={null}
        conversationsBySpaceId={new Map([['space-a', []]])}
        {...handlers}
      />
    )

    const moreButton = renderer.container.querySelector('button[aria-label="更多操作"]')
    await userClick(moreButton)

    const deleteMenuItem = findButtonByText(renderer.container, '删除工作区')
    expect(deleteMenuItem).not.toBeNull()
    await userClick(deleteMenuItem)

    const input = renderer.container.querySelector('input[placeholder="请输入工作区名称以确认"]') as HTMLInputElement | null
    expect(input).not.toBeNull()

    const getDeleteConfirmButton = () => Array.from(renderer.container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined

    expect(getDeleteConfirmButton()).toBeDefined()
    expect(getDeleteConfirmButton()?.disabled).toBe(true)

    await setInputValue(input, 'Wrong Name')
    expect(getDeleteConfirmButton()?.disabled).toBe(true)

    await setInputValue(input, 'Workspace A')
    expect(getDeleteConfirmButton()?.disabled).toBe(false)

    await userClick(getDeleteConfirmButton() || null)
    expect(handlers.onDeleteSpace).toHaveBeenCalledTimes(1)
    expect(handlers.onDeleteSpace).toHaveBeenCalledWith('space-a')

    await renderer.unmount()
  })

  it('Kite 临时空间菜单不展示删除工作区', async () => {
    const renderer = createRenderer()
    await renderer.render(
      <UnifiedSidebar
        spaces={[{ ...normalSpace, id: 'kite-temp', isTemp: true, name: 'Kite' }]}
        currentSpaceId="kite-temp"
        currentConversationId={null}
        conversationsBySpaceId={new Map([['kite-temp', []]])}
        {...handlers}
      />
    )

    const moreButton = renderer.container.querySelector('button[aria-label="更多操作"]')
    await userClick(moreButton)
    expect(findButtonByText(renderer.container, '删除工作区')).toBeNull()

    await renderer.unmount()
  })
})
