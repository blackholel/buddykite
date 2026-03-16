import { isElectron } from '../api/transport'

export interface PlatformInfo {
  platform: 'darwin' | 'win32' | 'linux'
  isMac: boolean
  isWindows: boolean
  isLinux: boolean
}

export interface WindowChromeInsets {
  top: number
  left: number
  right: number
}

const ZERO_INSETS: WindowChromeInsets = { top: 0, left: 0, right: 0 }

export function getPlatformInfo(): PlatformInfo {
  if (typeof window !== 'undefined' && window.platform) {
    return window.platform
  }

  return {
    platform: 'linux',
    isMac: false,
    isWindows: false,
    isLinux: true
  }
}

export function computeWindowChromeInsets(params: {
  inElectron: boolean
  platform: PlatformInfo
}): WindowChromeInsets {
  const { inElectron, platform } = params
  if (!inElectron) return ZERO_INSETS

  if (platform.isMac) {
    // Keep content clear of macOS traffic lights in hiddenInset mode.
    return { top: 32, left: 64, right: 0 }
  }

  if (platform.isWindows || platform.isLinux) {
    // Reserve room for titleBarOverlay controls on the right.
    return { top: 0, left: 0, right: 128 }
  }

  return ZERO_INSETS
}

export function getWindowChromeInsets(): WindowChromeInsets {
  return computeWindowChromeInsets({
    inElectron: isElectron(),
    platform: getPlatformInfo()
  })
}
