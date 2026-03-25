import { beforeEach, describe, expect, it } from 'vitest'
import { canvasLifecycle } from '../canvas-lifecycle'

describe('canvasLifecycle space sessions', () => {
  beforeEach(async () => {
    await canvasLifecycle.closeAll()
    await canvasLifecycle.switchSpaceSession('space-a')
  })

  it('切换回已访问 space 时恢复该 space 的 tabs', async () => {
    await canvasLifecycle.openChat('space-a', 'conv-a-1', 'A 会话 1', '/tmp/space-a')
    await canvasLifecycle.openFile('space-a', '/tmp/space-a/readme.md', 'A 文档')

    await canvasLifecycle.switchSpaceSession('space-b')
    await canvasLifecycle.openChat('space-b', 'conv-b-1', 'B 会话 1', '/tmp/space-b')

    expect(canvasLifecycle.getVisibleTabs().map((tab) => tab.title)).toEqual(['B 会话 1'])

    await canvasLifecycle.switchSpaceSession('space-a')

    expect(canvasLifecycle.getVisibleTabs().map((tab) => tab.title)).toEqual(['A 会话 1', 'A 文档'])
  })

  it('同一 space 下 conversation 去重键是 spaceId + conversationId', async () => {
    const firstId = await canvasLifecycle.openChat('space-a', 'conv-1', 'A 会话 1', '/tmp/space-a')
    const sameKeyId = await canvasLifecycle.openChat('space-a', 'conv-1', 'A 会话 1 更新', '/tmp/space-a')
    await canvasLifecycle.switchSpaceSession('space-b')
    const crossSpaceId = await canvasLifecycle.openChat('space-b', 'conv-1', 'B 会话 1', '/tmp/space-b')

    expect(sameKeyId).toBe(firstId)
    expect(crossSpaceId).not.toBe(firstId)
    expect(canvasLifecycle.getSpaceSession('space-a')?.tabs.filter((tab) => tab.type === 'chat')).toHaveLength(1)
    expect(canvasLifecycle.getSpaceSession('space-b')?.tabs.filter((tab) => tab.type === 'chat')).toHaveLength(1)
  })

  it('同一 space 下 file 去重键是 spaceId + normalizedPath', async () => {
    const firstId = await canvasLifecycle.openFile('space-a', '/tmp/space-a/docs/../guide.md', 'Guide')
    const samePathId = await canvasLifecycle.openFile('space-a', '/tmp/space-a/guide.md', 'Guide')

    await canvasLifecycle.switchSpaceSession('space-b')
    const crossSpaceId = await canvasLifecycle.openFile('space-b', '/tmp/space-a/guide.md', 'Guide')

    expect(samePathId).toBe(firstId)
    expect(crossSpaceId).not.toBe(firstId)
    expect(canvasLifecycle.getSpaceSession('space-a')?.tabs.filter((tab) => tab.path)).toHaveLength(1)
    expect(canvasLifecycle.getSpaceSession('space-b')?.tabs.filter((tab) => tab.path)).toHaveLength(1)
  })

  it('每个 space 最多保留 5 个 tabs', async () => {
    await canvasLifecycle.openChat('space-a', 'conv-1', '会话 1')
    await canvasLifecycle.openChat('space-a', 'conv-2', '会话 2')
    await canvasLifecycle.openChat('space-a', 'conv-3', '会话 3')
    await canvasLifecycle.openChat('space-a', 'conv-4', '会话 4')
    await canvasLifecycle.openChat('space-a', 'conv-5', '会话 5')
    await canvasLifecycle.openChat('space-a', 'conv-6', '会话 6')

    const session = canvasLifecycle.getSpaceSession('space-a')
    const conversationIds = (session?.tabs ?? []).map((tab) => tab.conversationId).filter(Boolean)
    expect(session?.tabs).toHaveLength(5)
    expect(conversationIds).not.toContain('conv-1')
    expect(conversationIds).toContain('conv-6')
  })

  it('切换 space 只切可见 tabs，不删除其他 space session', async () => {
    await canvasLifecycle.openChat('space-a', 'conv-a-1', 'A 会话 1')
    await canvasLifecycle.openChat('space-a', 'conv-a-2', 'A 会话 2')

    await canvasLifecycle.switchSpaceSession('space-b')
    await canvasLifecycle.openChat('space-b', 'conv-b-1', 'B 会话 1')

    expect(canvasLifecycle.getSpaceSession('space-a')?.tabs).toHaveLength(2)
    expect(canvasLifecycle.getSpaceSession('space-b')?.tabs).toHaveLength(1)
    expect(canvasLifecycle.getVisibleTabs().map((tab) => tab.title)).toEqual(['B 会话 1'])

    await canvasLifecycle.switchSpaceSession('space-a')
    expect(canvasLifecycle.getVisibleTabs().map((tab) => tab.title)).toEqual(['A 会话 1', 'A 会话 2'])
    expect(canvasLifecycle.getSpaceSession('space-b')?.tabs).toHaveLength(1)
  })

  it('openChat 在 openCanvas=false 时不会因切空间强制打开 canvas', async () => {
    await canvasLifecycle.openChat('space-a', 'conv-a-1', 'A 会话 1')
    canvasLifecycle.setOpen(false)

    await canvasLifecycle.openChat('space-b', 'conv-b-1', 'B 会话 1', '/tmp/space-b', '空间 B', false)

    expect(canvasLifecycle.getCurrentSpaceId()).toBe('space-b')
    expect(canvasLifecycle.getVisibleTabs().map((tab) => tab.title)).toEqual(['B 会话 1'])
    expect(canvasLifecycle.getIsOpen()).toBe(false)
  })

  it('openChat 在 openCanvas=false 时保持调用前 isOpen=true（切到空 space）', async () => {
    await canvasLifecycle.openChat('space-a', 'conv-a-1', 'A 会话 1')
    canvasLifecycle.setOpen(true)

    await canvasLifecycle.openChat('space-c', 'conv-c-1', 'C 会话 1', '/tmp/space-c', '空间 C', false)

    expect(canvasLifecycle.getCurrentSpaceId()).toBe('space-c')
    expect(canvasLifecycle.getVisibleTabs().map((tab) => tab.title)).toEqual(['C 会话 1'])
    expect(canvasLifecycle.getIsOpen()).toBe(true)
  })

  it('跨 space 的 tabId 不应被当前 session 的 tab 操作影响', async () => {
    const tabA = await canvasLifecycle.openChat('space-a', 'conv-a-1', 'A 会话 1')
    await canvasLifecycle.switchSpaceSession('space-b')
    await canvasLifecycle.openChat('space-b', 'conv-b-1', 'B 会话 1')

    await canvasLifecycle.closeTab(tabA)
    canvasLifecycle.updateTabContent(tabA, 'ignored')
    await canvasLifecycle.refreshTab(tabA)
    const saveResult = await canvasLifecycle.saveFile(tabA)

    expect(saveResult).toBe(false)
    expect(canvasLifecycle.getSpaceSession('space-a')?.tabs).toHaveLength(1)
    expect(canvasLifecycle.getSpaceSession('space-a')?.tabs[0]?.isDirty).toBe(false)
  })

  it('删除会话时可按 spaceId + conversationId 联动关闭该会话相关 tabs', async () => {
    await canvasLifecycle.openChat('space-a', 'conv-1', '会话 1')
    await canvasLifecycle.openPlan('计划 1', 'Plan 1', 'space-a', 'conv-1')
    await canvasLifecycle.openChat('space-a', 'conv-2', '会话 2')

    await canvasLifecycle.switchSpaceSession('space-b')
    await canvasLifecycle.openChat('space-b', 'conv-1', 'B 会话 1')

    canvasLifecycle.closeConversationTabs('space-a', 'conv-1')

    const spaceATabs = canvasLifecycle.getSpaceSession('space-a')?.tabs ?? []
    const spaceBTabs = canvasLifecycle.getSpaceSession('space-b')?.tabs ?? []

    expect(spaceATabs.map((tab) => tab.conversationId)).toEqual(['conv-2'])
    expect(spaceATabs.every((tab) => tab.conversationId !== 'conv-1')).toBe(true)
    expect(spaceBTabs.some((tab) => tab.conversationId === 'conv-1')).toBe(true)
  })
})
