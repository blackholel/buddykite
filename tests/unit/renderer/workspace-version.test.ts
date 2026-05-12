import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getVersionStatus: vi.fn(),
  initVersionControl: vi.fn(),
  createVersion: vi.fn(),
}))

vi.mock('../../../src/renderer/api', () => ({ api }))

import { saveWorkspaceVersion } from '../../../src/renderer/utils/workspace-version'
import type { TabState } from '../../../src/renderer/services/canvas-lifecycle'

describe('saveWorkspaceVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes version management and treats the initial version as saved', async () => {
    api.getVersionStatus.mockResolvedValue({ success: true, data: { kind: 'disabled', enabled: false } })
    api.initVersionControl.mockResolvedValue({ success: true, data: {} })

    const result = await saveWorkspaceVersion({
      spaceId: 'space-a',
      getDirtyFileTabs: () => [],
      saveDirtyFileTabs: vi.fn(),
    })

    expect(result).toBe('saved')
    expect(api.initVersionControl).toHaveBeenCalledWith('space-a')
    expect(api.createVersion).not.toHaveBeenCalled()
  })

  it('saves dirty tabs before creating a version for an enabled workspace', async () => {
    const saveDirtyFileTabs = vi.fn().mockResolvedValue({ saved: ['tab-1'], failed: [] })
    api.getVersionStatus.mockResolvedValue({ success: true, data: { kind: 'enabled', enabled: true } })
    api.createVersion.mockResolvedValue({ success: true, data: { id: 'abc1234' } })

    const result = await saveWorkspaceVersion({
      spaceId: 'space-a',
      getDirtyFileTabs: () => [{ id: 'tab-1' } as TabState],
      saveDirtyFileTabs,
    })

    expect(result).toBe('saved')
    expect(saveDirtyFileTabs).toHaveBeenCalledWith('space-a')
    expect(api.createVersion).toHaveBeenCalled()
  })
})
