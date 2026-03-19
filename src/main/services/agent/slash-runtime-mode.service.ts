import type { ClaudeCodeSlashRuntimeMode } from '../../../shared/types/claude-code'

export const DEFAULT_SLASH_RUNTIME_MODE: ClaudeCodeSlashRuntimeMode = 'native'
export const SLASH_RUNTIME_MODE_ENV_KEY = 'KITE_SLASH_RUNTIME_MODE'

type SlashRuntimeModeSource = 'env' | 'space' | 'global' | 'default'

export interface ResolveSlashRuntimeModeOptions {
  envValue?: string | null
  spaceMode?: ClaudeCodeSlashRuntimeMode
  globalMode?: ClaudeCodeSlashRuntimeMode
}

export interface ResolvedSlashRuntimeMode {
  mode: ClaudeCodeSlashRuntimeMode
  source: SlashRuntimeModeSource
}

function normalizeSlashRuntimeMode(
  value: unknown
): ClaudeCodeSlashRuntimeMode | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'native') return 'native'
  if (normalized === 'legacy-inject') return 'legacy-inject'
  return null
}

export function resolveSlashRuntimeMode(
  options: ResolveSlashRuntimeModeOptions,
  context: string
): ResolvedSlashRuntimeMode {
  const envRaw = typeof options.envValue === 'string' ? options.envValue.trim() : ''
  const envMode = normalizeSlashRuntimeMode(envRaw)
  if (envRaw.length > 0 && !envMode) {
    console.warn('[telemetry] slash_runtime_mode_resolved', {
      context,
      source: 'env_invalid_ignored',
      envKey: SLASH_RUNTIME_MODE_ENV_KEY,
      invalidValue: envRaw,
      fallback: 'space>global>default'
    })
  }

  const spaceMode = normalizeSlashRuntimeMode(options.spaceMode)
  const globalMode = normalizeSlashRuntimeMode(options.globalMode)

  const resolved: ResolvedSlashRuntimeMode = envMode
    ? { mode: envMode, source: 'env' }
    : spaceMode
      ? { mode: spaceMode, source: 'space' }
      : globalMode
        ? { mode: globalMode, source: 'global' }
        : { mode: DEFAULT_SLASH_RUNTIME_MODE, source: 'default' }

  console.log('[telemetry] slash_runtime_mode_resolved', {
    context,
    source: resolved.source,
    mode: resolved.mode
  })

  return resolved
}
