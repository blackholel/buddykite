import { beforeEach, describe, expect, it, vi } from 'vitest'

const isElectronMock = vi.fn(() => true)
const httpRequestMock = vi.fn()

vi.mock('../../../src/renderer/api/transport', () => ({
  isElectron: isElectronMock,
  httpRequest: httpRequestMock,
  onEvent: vi.fn(() => () => {}),
  connectWebSocket: vi.fn(),
  disconnectWebSocket: vi.fn(),
  subscribeToConversation: vi.fn(),
  unsubscribeFromConversation: vi.fn(),
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(() => null)
}))

describe('api.createArtifactEntry fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
      kite: {
        createFile: vi.fn(async () => ({ success: true })),
        createFolder: vi.fn(async () => ({ success: true }))
      }
    }
  })

  it('旧 preload 未注入 createArtifactEntry 时回退到 createFile', async () => {
    const { api } = await import('../../../src/renderer/api')
    const windowRef = globalThis as unknown as { window: { kite: { createFile: ReturnType<typeof vi.fn> } } }

    const result = await api.createArtifactEntry({
      type: 'file',
      parentPath: '/tmp/workspace',
      name: 'a.md'
    })

    expect(result.success).toBe(true)
    expect(windowRef.window.kite.createFile).toHaveBeenCalledWith('/tmp/workspace/a.md', undefined)
  })

  it('旧 preload 未注入 createArtifactEntry 时回退到 createFolder', async () => {
    const { api } = await import('../../../src/renderer/api')
    const windowRef = globalThis as unknown as { window: { kite: { createFolder: ReturnType<typeof vi.fn> } } }

    const result = await api.createArtifactEntry({
      type: 'folder',
      parentPath: '/tmp/workspace',
      name: 'docs'
    })

    expect(result.success).toBe(true)
    expect(windowRef.window.kite.createFolder).toHaveBeenCalledWith('/tmp/workspace/docs')
  })
})

