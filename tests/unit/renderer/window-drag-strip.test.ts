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
  it('Electron 桌面端在所有平台与视图都显示拖拽条', () => {
    const platforms: PlatformInfo[] = [
      createPlatform({ platform: 'win32', isWindows: true, isLinux: false }),
      createPlatform({ platform: 'darwin', isMac: true, isLinux: false }),
      createPlatform({ platform: 'linux', isLinux: true })
    ]
    const visibleViews: AppView[] = ['gitBashSetup', 'home', 'space', 'unified', 'settings']

    for (const platform of platforms) {
      for (const view of visibleViews) {
        expect(shouldShowWindowDragStrip({
          view,
          platform,
          inElectron: true
        })).toBe(true)
      }
    }
  })

  it('非 Electron 不显示拖拽条', () => {
    expect(shouldShowWindowDragStrip({
      view: 'home',
      platform: createPlatform({ platform: 'darwin', isMac: true, isLinux: false }),
      inElectron: false
    })).toBe(false)
  })
})
