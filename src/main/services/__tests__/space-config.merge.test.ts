import { describe, expect, it } from 'vitest'
import { mergeClaudeCodeConfigs, type SpaceClaudeCodeConfig } from '../space-config.service'
import type { ClaudeCodeConfig } from '../config.service'

describe('space-config mergeClaudeCodeConfigs', () => {
  it('global 为空时保留 space.slashRuntimeMode', () => {
    const merged = mergeClaudeCodeConfigs(undefined, {
      slashRuntimeMode: 'legacy-inject'
    })

    expect(merged.slashRuntimeMode).toBe('legacy-inject')
  })

  it('space 配置优先覆盖 global.slashRuntimeMode', () => {
    const globalConfig: ClaudeCodeConfig = {
      slashRuntimeMode: 'native'
    }
    const spaceConfig: SpaceClaudeCodeConfig = {
      slashRuntimeMode: 'legacy-inject'
    }

    const merged = mergeClaudeCodeConfigs(globalConfig, spaceConfig)
    expect(merged.slashRuntimeMode).toBe('legacy-inject')
  })
})
