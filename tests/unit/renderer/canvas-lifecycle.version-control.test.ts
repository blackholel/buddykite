import { beforeEach, describe, expect, it, vi } from 'vitest'

const writeArtifactContent = vi.hoisted(() => vi.fn())
const readArtifactContent = vi.hoisted(() => vi.fn())

vi.mock('../../../src/renderer/api', () => ({
  api: {
    readArtifactContent,
    writeArtifactContent,
    openArtifact: vi.fn(),
  },
}))

import { canvasLifecycle } from '../../../src/renderer/services/canvas-lifecycle'

describe('canvasLifecycle version control tabs', () => {
  beforeEach(async () => {
    await canvasLifecycle.closeAll()
    readArtifactContent.mockResolvedValue({ success: true, data: { content: 'saved\n' } })
    writeArtifactContent.mockResolvedValue({ success: true })
  })

  it('opens version management as a dedicated Space-scoped Canvas tab', async () => {
    const firstId = await canvasLifecycle.openVersionControl('space-a')
    const secondId = await canvasLifecycle.openVersionControl('space-a')

    expect(secondId).toBe(firstId)
    expect(canvasLifecycle.getActiveTabId()).toBe(firstId)
    expect(canvasLifecycle.getTab(firstId)).toMatchObject({
      type: 'version-control',
      title: '版本管理',
      spaceId: 'space-a',
      isDirty: false,
      isLoading: false,
    })
    expect(canvasLifecycle.getTabs().filter((tab) => tab.type === 'version-control')).toHaveLength(1)
  })

  it('saves dirty file tabs for a Space even when version management is the active tab', async () => {
    const fileTabId = await canvasLifecycle.openFile('space-a', '/tmp/space-a/note.md', 'note.md')
    await new Promise((resolve) => setTimeout(resolve, 0))
    writeArtifactContent.mockClear()
    canvasLifecycle.updateTabContent(fileTabId, 'dirty\n')
    await canvasLifecycle.openVersionControl('space-a')

    const dirtyBefore = canvasLifecycle.getDirtyFileTabs('space-a')
    const result = await canvasLifecycle.saveDirtyFileTabs('space-a')

    expect(dirtyBefore.map((tab) => tab.id)).toEqual([fileTabId])
    expect(result).toEqual({ saved: [fileTabId], failed: [] })
    expect(writeArtifactContent).toHaveBeenCalledWith('/tmp/space-a/note.md', 'dirty\n')
    expect(canvasLifecycle.getSpaceSession('space-a')?.tabs.find((tab) => tab.id === fileTabId)?.isDirty).toBe(false)
    expect(canvasLifecycle.getActiveTab()?.type).toBe('version-control')
  })
})
