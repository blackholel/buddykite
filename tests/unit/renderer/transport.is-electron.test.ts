import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('transport.isElectron fallback detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('window.kite 存在时判定为 Electron', async () => {
    ;(globalThis as any).window = { kite: {} }

    const { isElectron } = await import('../../../src/renderer/api/transport')
    expect(isElectron()).toBe(true)
  })

  it('window.electron.ipcRenderer 存在时判定为 Electron', async () => {
    ;(globalThis as any).window = {
      electron: {
        ipcRenderer: {
          on: vi.fn()
        }
      }
    }

    const { isElectron } = await import('../../../src/renderer/api/transport')
    expect(isElectron()).toBe(true)
  })

  it('无任何桥接对象时判定为非 Electron', async () => {
    ;(globalThis as any).window = {}

    const { isElectron } = await import('../../../src/renderer/api/transport')
    expect(isElectron()).toBe(false)
  })
})
