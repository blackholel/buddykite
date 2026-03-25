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
  it('Windows Electron 在核心工作视图显示拖拽条（与 App 顶层判定保持一致）', () => {
    const windows = createPlatform({ platform: 'win32', isWindows: true, isLinux: false })
    const visibleViews: AppView[] = ['gitBashSetup', 'home', 'space', 'unified', 'settings']

    for (const view of visibleViews) {
      expect(shouldShowWindowDragStrip({
        view,
        platform: windows,
        inElectron: true
      })).toBe(true)
    }
  })

  it('splash 视图不显示拖拽条', () => {
    expect(shouldShowWindowDragStrip({
      view: 'splash',
      platform: createPlatform({ platform: 'win32', isWindows: true, isLinux: false }),
      inElectron: true
    })).toBe(false)
  })

  it('非 Windows 平台不显示拖拽条', () => {
    expect(shouldShowWindowDragStrip({
      view: 'home',
      platform: createPlatform({ platform: 'darwin', isMac: true, isLinux: false }),
      inElectron: true
    })).toBe(false)
  })

  it('非 Electron 不显示拖拽条', () => {
    expect(shouldShowWindowDragStrip({
      view: 'home',
      platform: createPlatform({ platform: 'win32', isWindows: true, isLinux: false }),
      inElectron: false
    })).toBe(false)
  })
})
