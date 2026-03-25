import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../../src/renderer/api', () => ({
  api: {
    deleteSpace: vi.fn(),
    listSpaces: vi.fn(async () => ({ success: true, data: [] })),
    getKiteSpace: vi.fn(async () => ({ success: true, data: null })),
    createSpace: vi.fn(async () => ({ success: true, data: null })),
    updateSpace: vi.fn(async () => ({ success: true, data: null })),
    openSpaceFolder: vi.fn(async () => ({ success: true })),
    getSpace: vi.fn(async () => ({ success: true, data: null })),
    updateSpacePreferences: vi.fn(async () => ({ success: true, data: null }))
  }
}))

import { api } from '../../../src/renderer/api'
import { useSpaceStore } from '../../../src/renderer/stores/space.store'

describe('space.store deleteSpace semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSpaceStore.setState({
      kiteSpace: null,
      currentSpace: {
        id: 'space-a',
        name: 'Space A',
        icon: 'folder',
        path: '/tmp/space-a',
        isTemp: false,
        createdAt: '2026-03-25T10:00:00.000Z',
        updatedAt: '2026-03-25T10:00:00.000Z',
        stats: { artifactCount: 0, conversationCount: 1 }
      },
      spaces: [{
        id: 'space-a',
        name: 'Space A',
        icon: 'folder',
        path: '/tmp/space-a',
        isTemp: false,
        createdAt: '2026-03-25T10:00:00.000Z',
        updatedAt: '2026-03-25T10:00:00.000Z',
        stats: { artifactCount: 0, conversationCount: 1 }
      }],
      isLoading: false,
      error: null
    })
  })

  it('当 API 返回 success=true 但 data=false 时，不应移除本地工作区', async () => {
    ;(api.deleteSpace as Mock).mockResolvedValueOnce({ success: true, data: false })

    const ok = await useSpaceStore.getState().deleteSpace('space-a')

    expect(ok).toBe(false)
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(useSpaceStore.getState().spaces[0]?.id).toBe('space-a')
  })

  it('当 API 返回 success=true 且 data=true 时，移除本地工作区', async () => {
    ;(api.deleteSpace as Mock).mockResolvedValueOnce({ success: true, data: true })

    const ok = await useSpaceStore.getState().deleteSpace('space-a')

    expect(ok).toBe(true)
    expect(useSpaceStore.getState().spaces).toHaveLength(0)
    expect(useSpaceStore.getState().currentSpace).toBeNull()
  })
})
