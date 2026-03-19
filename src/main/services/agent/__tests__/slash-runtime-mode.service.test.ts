import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SLASH_RUNTIME_MODE,
  SLASH_RUNTIME_MODE_ENV_KEY,
  resolveSlashRuntimeMode
} from '../slash-runtime-mode.service'

describe('slash-runtime-mode.service', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('按优先级解析：env > space > global > default(native)', () => {
    const envResolved = resolveSlashRuntimeMode(
      {
        envValue: 'legacy-inject',
        spaceMode: 'native',
        globalMode: 'native'
      },
      'test.env'
    )
    expect(envResolved).toEqual({ mode: 'legacy-inject', source: 'env' })

    const spaceResolved = resolveSlashRuntimeMode(
      {
        envValue: '',
        spaceMode: 'legacy-inject',
        globalMode: 'native'
      },
      'test.space'
    )
    expect(spaceResolved).toEqual({ mode: 'legacy-inject', source: 'space' })

    const globalResolved = resolveSlashRuntimeMode(
      {
        envValue: '',
        spaceMode: undefined,
        globalMode: 'legacy-inject'
      },
      'test.global'
    )
    expect(globalResolved).toEqual({ mode: 'legacy-inject', source: 'global' })

    const defaultResolved = resolveSlashRuntimeMode(
      {
        envValue: '',
        spaceMode: undefined,
        globalMode: undefined
      },
      'test.default'
    )
    expect(defaultResolved).toEqual({ mode: DEFAULT_SLASH_RUNTIME_MODE, source: 'default' })
  })

  it('非法 env 值会被忽略并告警，然后继续按下一级解析', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const resolved = resolveSlashRuntimeMode(
      {
        envValue: 'bad-mode',
        spaceMode: 'legacy-inject',
        globalMode: 'native'
      },
      'test.invalid-env'
    )

    expect(resolved).toEqual({ mode: 'legacy-inject', source: 'space' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[telemetry] slash_runtime_mode_resolved',
      expect.objectContaining({
        context: 'test.invalid-env',
        source: 'env_invalid_ignored',
        envKey: SLASH_RUNTIME_MODE_ENV_KEY,
        invalidValue: 'bad-mode'
      })
    )
  })

  it('大小写与空白会被归一化', () => {
    const resolved = resolveSlashRuntimeMode(
      {
        envValue: '  LEGACY-INJECT  ',
        spaceMode: 'native',
        globalMode: 'native'
      },
      'test.normalize'
    )
    expect(resolved).toEqual({ mode: 'legacy-inject', source: 'env' })
  })
})
