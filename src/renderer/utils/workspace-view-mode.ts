export type WorkspaceViewMode = 'classic' | 'unified'

const WORKSPACE_VIEW_MODE_KEY = 'kite-workspace-view-mode'

interface WorkspaceSwitchTargetOptions<T> {
  currentSpace: T | null
  kiteSpace: T | null
  spaces: T[]
}

export function readWorkspaceViewMode(): WorkspaceViewMode {
  try {
    const raw = localStorage.getItem(WORKSPACE_VIEW_MODE_KEY)
    return raw === 'unified' ? 'unified' : 'classic'
  } catch {
    return 'classic'
  }
}

export function persistWorkspaceViewMode(mode: WorkspaceViewMode): void {
  try {
    localStorage.setItem(WORKSPACE_VIEW_MODE_KEY, mode)
  } catch {
    // Ignore localStorage failures (private mode / quota).
  }
}

export function pickWorkspaceSwitchTarget<T>(options: WorkspaceSwitchTargetOptions<T>): T | null {
  const { currentSpace, kiteSpace, spaces } = options
  return currentSpace || kiteSpace || spaces[0] || null
}
