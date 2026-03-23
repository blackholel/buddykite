import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pickWorkspaceSwitchTarget,
  persistWorkspaceViewMode,
  readWorkspaceViewMode
} from '../../../src/renderer/utils/workspace-view-mode'

interface MockSpace {
  id: string
}

describe('workspace-view-mode mode lock', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('readWorkspaceViewMode ignores localStorage and always returns unified', () => {
    for (const rawValue of ['classic', 'unified', 'anything-else', null]) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: vi.fn(() => rawValue)
        },
        configurable: true
      })

      expect(readWorkspaceViewMode()).toBe('unified')
    }
  })

  it('persistWorkspaceViewMode always writes unified', () => {
    const setItem = vi.fn()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        setItem
      },
      configurable: true
    })

    persistWorkspaceViewMode('classic')
    persistWorkspaceViewMode('unified')

    expect(setItem).toHaveBeenNthCalledWith(1, 'kite-workspace-view-mode', 'unified')
    expect(setItem).toHaveBeenNthCalledWith(2, 'kite-workspace-view-mode', 'unified')
  })
})

describe('workspace-view-mode pickWorkspaceSwitchTarget', () => {
  it('优先返回 currentSpace', () => {
    const currentSpace = { id: 'current' }
    const kiteSpace = { id: 'kite' }
    const spaces = [{ id: 'space-1' }, { id: 'space-2' }]

    const target = pickWorkspaceSwitchTarget<MockSpace>({
      currentSpace,
      kiteSpace,
      spaces
    })

    expect(target?.id).toBe('current')
  })

  it('currentSpace 为空时返回 kiteSpace', () => {
    const target = pickWorkspaceSwitchTarget<MockSpace>({
      currentSpace: null,
      kiteSpace: { id: 'kite' },
      spaces: [{ id: 'space-1' }]
    })

    expect(target?.id).toBe('kite')
  })

  it('currentSpace 和 kiteSpace 都为空时返回第一个普通空间', () => {
    const target = pickWorkspaceSwitchTarget<MockSpace>({
      currentSpace: null,
      kiteSpace: null,
      spaces: [{ id: 'space-1' }, { id: 'space-2' }]
    })

    expect(target?.id).toBe('space-1')
  })

  it('没有任何空间时返回 null', () => {
    const target = pickWorkspaceSwitchTarget<MockSpace>({
      currentSpace: null,
      kiteSpace: null,
      spaces: []
    })

    expect(target).toBeNull()
  })
})
