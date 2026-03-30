/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ResourceCard } from '../ResourceCard'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const apiMock = vi.hoisted(() => ({
  getSkillContent: vi.fn(async () => ({ success: true, data: { content: '# skill content' } })),
  getAgentContent: vi.fn(async () => ({ success: true, data: '# agent content' })),
  copySkillToSpaceByRef: vi.fn(async () => ({ success: true, data: { status: 'copied' } })),
  copyAgentToSpaceByRef: vi.fn(async () => ({ success: true, data: { status: 'copied' } })),
  setSkillEnabled: vi.fn(async () => ({ success: true, data: true })),
  setAgentEnabled: vi.fn(async () => ({ success: true, data: true })),
  showSkillInFolder: vi.fn(async () => ({ success: true, data: true })),
  showAgentInFolder: vi.fn(async () => ({ success: true, data: true })),
  deleteSkillFromLibrary: vi.fn(async () => ({ success: true, data: true })),
  deleteAgentFromLibrary: vi.fn(async () => ({ success: true, data: true }))
}))

vi.mock('../../../api', () => ({
  api: apiMock
}))

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

describe('resource library detail actions', () => {
  it('用户资产展示插入/启停/打开文件夹/删除动作', async () => {
    const renderer = createRenderer()
    await renderer.render(
      <ResourceCard
        resource={{
          name: 'planner',
          path: '/tmp/Kite/Skills/planner',
          source: 'app',
          enabled: true,
          exposure: 'public'
        }}
        type="skill"
        index={0}
        actionMode="none"
        detailMode="library"
        workDir="/tmp/space"
      />
    )

    await userClick(renderer.container.querySelector('button.space-card'))

    expect(document.body.textContent).toContain('插入到对话')
    expect(document.body.textContent).toContain('停用')
    expect(document.body.textContent).toContain('打开所在文件夹')
    expect(document.body.textContent).toContain('删除')

    await renderer.unmount()
  })

  it('插件资源不可删除，但可停用并打开文件夹', async () => {
    const renderer = createRenderer()
    await renderer.render(
      <ResourceCard
        resource={{
          name: 'reviewer',
          path: '/tmp/plugins/reviewer.md',
          source: 'plugin',
          enabled: true,
          exposure: 'public'
        }}
        type="agent"
        index={0}
        actionMode="none"
        detailMode="library"
        workDir="/tmp/space"
      />
    )

    await userClick(renderer.container.querySelector('button.space-card'))

    expect(document.body.textContent).toContain('插入到对话')
    expect(document.body.textContent).toContain('停用')
    expect(document.body.textContent).toContain('打开所在文件夹')

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const hasDelete = buttons.some((button) => button.textContent?.trim() === '删除')
    expect(hasDelete).toBe(false)

    await renderer.unmount()
  })
})
