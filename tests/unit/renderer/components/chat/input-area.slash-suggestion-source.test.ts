import { describe, expect, it } from 'vitest'
import { resolveSlashSuggestionSource } from '../../../../../src/renderer/components/chat/InputArea'

describe('resolveSlashSuggestionSource', () => {
  it('native + slash 触发 + 有 snapshot 时优先使用 SDK snapshot', () => {
    expect(resolveSlashSuggestionSource({
      slashRuntimeMode: 'native',
      triggerType: 'slash',
      snapshotCommandsCount: 3
    })).toBe('sdk_snapshot')
  })

  it('native + slash 触发 + 无 snapshot 时回退本地候选', () => {
    expect(resolveSlashSuggestionSource({
      slashRuntimeMode: 'native',
      triggerType: 'slash',
      snapshotCommandsCount: 0
    })).toBe('local')
  })

  it('legacy-inject 下始终使用本地候选', () => {
    expect(resolveSlashSuggestionSource({
      slashRuntimeMode: 'legacy-inject',
      triggerType: 'slash',
      snapshotCommandsCount: 5
    })).toBe('local')
  })

  it('非 slash 触发时使用本地候选', () => {
    expect(resolveSlashSuggestionSource({
      slashRuntimeMode: 'native',
      triggerType: 'mention',
      snapshotCommandsCount: 5
    })).toBe('local')
  })
})
