import { describe, expect, it } from 'vitest'
import { computeWindowChromeInsets, type PlatformInfo } from '../../../src/renderer/utils/window-chrome'

function createPlatform(overrides: Partial<PlatformInfo>): PlatformInfo {
  return {
    platform: 'linux',
    isMac: false,
    isWindows: false,
    isLinux: true,
    ...overrides
  }
}

describe('window-chrome computeWindowChromeInsets', () => {
  it('网页模式不保留窗口控制安全区', () => {
    const insets = computeWindowChromeInsets({
      inElectron: false,
      platform: createPlatform({ isMac: true, platform: 'darwin', isLinux: false })
    })

    expect(insets).toEqual({ top: 0, left: 0, right: 0 })
  })

  it('macOS Electron 预留 traffic lights 安全区', () => {
    const insets = computeWindowChromeInsets({
      inElectron: true,
      platform: createPlatform({ platform: 'darwin', isMac: true, isLinux: false })
    })

    expect(insets).toEqual({ top: 32, left: 64, right: 0 })
  })

  it('Windows/Linux Electron 预留右侧 titleBarOverlay 安全区', () => {
    const insets = computeWindowChromeInsets({
      inElectron: true,
      platform: createPlatform({ platform: 'win32', isWindows: true, isLinux: false })
    })

    expect(insets).toEqual({ top: 0, left: 0, right: 128 })
  })

  it('Linux Electron 同样预留右侧 titleBarOverlay 安全区', () => {
    const insets = computeWindowChromeInsets({
      inElectron: true,
      platform: createPlatform({ platform: 'linux', isLinux: true })
    })

    expect(insets).toEqual({ top: 0, left: 0, right: 128 })
  })
})
