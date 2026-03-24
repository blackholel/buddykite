import { beforeEach, describe, expect, it } from 'vitest'
import { canvasLifecycle } from '../canvas-lifecycle'
import './canvas-lifecycle.space-sessions.test'

describe('canvasLifecycle.openTemplateLibrary', () => {
  beforeEach(async () => {
    await canvasLifecycle.closeAll()
  })

  it('首次打开会创建 template-library tab 并激活', async () => {
    const tabId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-a'
    )

    const tab = canvasLifecycle.getTab(tabId)
    expect(tab).toBeDefined()
    expect(tab?.type).toBe('template-library')
    expect(tab?.title).toBe('Template Library')
    expect(tab?.templateLibraryTab).toBe('skills')
    expect(tab?.workDir).toBe('/tmp/space-a')
    expect(canvasLifecycle.getActiveTabId()).toBe(tabId)
    expect(canvasLifecycle.getIsOpen()).toBe(true)
  })

  it('同一 workDir 重复打开会复用 tab 并更新目标子页签', async () => {
    const firstId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-a'
    )

    const secondId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'agents',
      '/tmp/space-a'
    )

    expect(secondId).toBe(firstId)
    const tab = canvasLifecycle.getTab(secondId)
    expect(tab?.templateLibraryTab).toBe('agents')
    expect(canvasLifecycle.getTabs().filter(t => t.type === 'template-library')).toHaveLength(1)
  })

  it('不同 workDir 会创建不同 template-library tab', async () => {
    const firstId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-a'
    )
    const secondId = await canvasLifecycle.openTemplateLibrary(
      'Template Library',
      'skills',
      '/tmp/space-b'
    )

    expect(secondId).not.toBe(firstId)
    expect(canvasLifecycle.getTabs().filter(t => t.type === 'template-library')).toHaveLength(2)
  })
})

describe('canvasLifecycle.openChat', () => {
  beforeEach(async () => {
    await canvasLifecycle.closeAll()
    await canvasLifecycle.switchSpaceSession('space-a')
  })

  it('支持跨空间打开聊天 tab，并保留空间标签', async () => {
    const firstId = await canvasLifecycle.openChat(
      'space-a',
      'conv-1',
      '需求澄清',
      '/tmp/space-a',
      '空间 A'
    )
    await canvasLifecycle.switchSpaceSession('space-b')
    const secondId = await canvasLifecycle.openChat(
      'space-b',
      'conv-2',
      '代码实现',
      '/tmp/space-b',
      '空间 B'
    )

    expect(secondId).not.toBe(firstId)
    expect(canvasLifecycle.getVisibleTabs().filter((tab) => tab.type === 'chat')).toHaveLength(1)
    expect(
      canvasLifecycle.getSpaceSession('space-a')?.tabs.find((tab) => tab.conversationId === 'conv-1')?.spaceLabel
    ).toBe('空间 A')
    expect(
      canvasLifecycle.getSpaceSession('space-b')?.tabs.find((tab) => tab.conversationId === 'conv-2')?.spaceLabel
    ).toBe('空间 B')
  })

  it('每个 space 的聊天 tab 最多保留 5 个，超出时淘汰最久未激活', async () => {
    await canvasLifecycle.openChat('space-a', 'conv-1', '会话 1', '/tmp/space-a', '空间 A')
    await canvasLifecycle.openChat('space-a', 'conv-2', '会话 2', '/tmp/space-a', '空间 A')
    await canvasLifecycle.openChat('space-a', 'conv-3', '会话 3', '/tmp/space-a', '空间 A')
    await canvasLifecycle.openChat('space-a', 'conv-4', '会话 4', '/tmp/space-a', '空间 A')
    await canvasLifecycle.openChat('space-a', 'conv-5', '会话 5', '/tmp/space-a', '空间 A')
    await canvasLifecycle.openChat('space-a', 'conv-6', '会话 6', '/tmp/space-a', '空间 A')

    const sessionA = canvasLifecycle.getSpaceSession('space-a')
    expect(sessionA?.tabs.filter((tab) => tab.type === 'chat')).toHaveLength(5)
    expect(sessionA?.tabs.some((tab) => tab.conversationId === 'conv-1')).toBe(false)
    expect(sessionA?.tabs.some((tab) => tab.conversationId === 'conv-6')).toBe(true)
  })

  it('同空间同会话重复打开时复用 tab，不新增', async () => {
    const firstId = await canvasLifecycle.openChat(
      'space-a',
      'conv-1',
      '会话 1',
      '/tmp/space-a',
      '空间 A'
    )
    const secondId = await canvasLifecycle.openChat(
      'space-a',
      'conv-1',
      '会话 1（更新）',
      '/tmp/space-a',
      '空间 A'
    )

    expect(secondId).toBe(firstId)
    expect(canvasLifecycle.getTabs().filter((tab) => tab.type === 'chat')).toHaveLength(1)
    expect(canvasLifecycle.getTab(firstId)?.title).toBe('会话 1（更新）')
  })
})
