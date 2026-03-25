import { isElectron } from '../../api/transport'
import type { AppView } from '../../types'
import { getWindowChromeInsets, type PlatformInfo } from '../../utils/window-chrome'

const WINDOW_DRAG_STRIP_HEIGHT = 40

export function shouldShowWindowDragStrip(params: {
  view: AppView
  platform: PlatformInfo
  inElectron: boolean
}): boolean {
  return params.inElectron
}

export function WindowDragStrip(): JSX.Element | null {
  if (!isElectron()) return null
  const chromeInsets = getWindowChromeInsets()

  return (
    <div
      className="flex-shrink-0 border-b border-border/30 bg-background/90 backdrop-blur-xl"
      style={{ height: `${WINDOW_DRAG_STRIP_HEIGHT}px` }}
      aria-hidden="true"
    >
      <div
        className="drag-region h-full"
        style={{
          marginLeft: `${chromeInsets.left}px`,
          marginRight: `${chromeInsets.right}px`
        }}
      />
    </div>
  )
}
