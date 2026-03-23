import { isElectron } from '../../api/transport'
import type { AppView } from '../../types'
import { getPlatformInfo, type PlatformInfo } from '../../utils/window-chrome'

const WINDOWS_DRAG_STRIP_VIEWS: AppView[] = ['gitBashSetup', 'home', 'space', 'settings']
const WINDOW_DRAG_STRIP_HEIGHT = 40
const WINDOW_DRAG_STRIP_RIGHT_INSET = 128

export function shouldShowWindowDragStrip(params: {
  view: AppView
  platform: PlatformInfo
  inElectron: boolean
}): boolean {
  const { view, platform, inElectron } = params
  if (!inElectron || !platform.isWindows) return false
  return WINDOWS_DRAG_STRIP_VIEWS.includes(view)
}

export function WindowDragStrip(): JSX.Element | null {
  const platform = getPlatformInfo()
  if (!isElectron() || !platform.isWindows) return null

  return (
    <div
      className="flex-shrink-0 border-b border-border/30 bg-background/90 backdrop-blur-xl"
      style={{ height: `${WINDOW_DRAG_STRIP_HEIGHT}px` }}
      aria-hidden="true"
    >
      <div
        className="drag-region h-full"
        style={{ marginRight: `${WINDOW_DRAG_STRIP_RIGHT_INSET}px` }}
      />
    </div>
  )
}
