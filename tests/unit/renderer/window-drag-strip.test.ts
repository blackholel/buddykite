import { describe, expect, it } from 'vitest'
import type { AppView } from '../../../src/renderer/types'
import { shouldShowWindowDragStrip } from '../../../src/renderer/components/layout/WindowDragStrip'
import type { PlatformInfo } from '../../../src/renderer/utils/window-chrome'

function createPlatform(overrides: Partial<PlatformInfo>): PlatformInfo {
  return {
    platform: 'linux',
    isMac: false,
    isWindows: false,
    isLinux: true,
    ...overrides
  }
}

describe('window-drag-strip visibility', () => {
  it('Windows Electron 在非 unified 视图显示拖拽条', () => {
    const windows = createPlatform({ platform: 'win32', isWindows: true, isLinux: false })
    const visibleViews: AppView[] = ['gitBashSetup', 'setup', 'home', 'space', 'settings']

    for (const view of visibleViews) {
      expect(shouldShowWindowDragStrip({
        view,
        platform: windows,
        inElectron: true
      })).toBe(true)
    }
  })

  it('unified 视图不显示拖拽条', () => {
    expect(shouldShowWindowDragStrip({
      view: 'unified',
      platform: createPlatform({ platform: 'win32', isWindows: true, isLinux: false }),
      inElectron: true
    })).toBe(false)
  })

  it('非 Windows 或非 Electron 不显示拖拽条', () => {
    expect(shouldShowWindowDragStrip({
      view: 'home',
      platform: createPlatform({ platform: 'darwin', isMac: true, isLinux: false }),
      inElectron: true
    })).toBe(false)

    expect(shouldShowWindowDragStrip({
      view: 'home',
      platform: createPlatform({ platform: 'win32', isWindows: true, isLinux: false }),
      inElectron: false
    })).toBe(false)
  })
})
