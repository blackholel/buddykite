/**
 * Header Component - Apple-style minimal title bar
 *
 * Design:
 * - Clean, transparent header with glass-subtle effect
 * - Minimal visual weight, content takes priority
 * - Platform-aware padding for window controls
 *
 * Platform handling:
 * - macOS Electron: reserve safe inset for traffic lights
 * - Windows/Linux Electron: reserve safe inset for titleBarOverlay controls
 * - Browser/Mobile: no extra padding needed (pl-4)
 *
 * Height: 44px (slightly taller for elegance)
 * Traffic light vertical center formula: y = height/2 - 7 = 15
 */

import type { CSSProperties, ReactNode } from 'react'
import { getPlatformInfo, getWindowChromeInsets } from '../../utils/window-chrome'

interface HeaderProps {
  /** Left side content (after platform padding) */
  left?: ReactNode
  /** Right side content (before platform padding) */
  right?: ReactNode
  /** Additional className for header */
  className?: string
}

export function Header({ left, right, className = '' }: HeaderProps) {
  const chromeInsets = getWindowChromeInsets()
  const style: CSSProperties = {
    paddingLeft: `${16 + chromeInsets.left}px`,
    paddingRight: `${16 + chromeInsets.right}px`
  }

  return (
    <header
      className={`
        flex items-center justify-between h-11
        border-b border-border/30 drag-region
        bg-background/95
        backdrop-filter backdrop-blur-xl backdrop-saturate-180
        relative z-20
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      style={style}
    >
      <div className="flex items-center gap-4 no-drag min-w-0">
        {left}
      </div>

      <div className="flex items-center gap-2 no-drag flex-shrink-0">
        {right}
      </div>
    </header>
  )
}

// Export platform detection hook for use in other components
export function usePlatform() {
  return getPlatformInfo()
}
