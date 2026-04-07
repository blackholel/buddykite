import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveOpenAICodexFlags } from '../../../src/main/services/openai-codex/feature-flags'

describe('openai-codex.feature-flags', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('默认关闭实验通道', () => {
    const flags = resolveOpenAICodexFlags()
    expect(flags.enabled).toBe(false)
    expect(flags.experiment).toBe(false)
    expect(flags.killed).toBe(false)
    expect(flags.active).toBe(false)
  })

  it('启用并且未熔断时 active=true', () => {
    vi.stubEnv('PROVIDER_OPENAI_CODEX_ENABLED', '1')
    vi.stubEnv('PROVIDER_OPENAI_CODEX_EXPERIMENT', '1')

    const flags = resolveOpenAICodexFlags()
    expect(flags.enabled).toBe(true)
    expect(flags.experiment).toBe(true)
    expect(flags.killed).toBe(false)
    expect(flags.active).toBe(true)
  })

  it('熔断优先级最高，active=false', () => {
    vi.stubEnv('PROVIDER_OPENAI_CODEX_ENABLED', '1')
    vi.stubEnv('PROVIDER_OPENAI_CODEX_EXPERIMENT', '1')
    vi.stubEnv('CODEX_KILL_SWITCH', 'true')

    const flags = resolveOpenAICodexFlags()
    expect(flags.enabled).toBe(true)
    expect(flags.experiment).toBe(true)
    expect(flags.killed).toBe(true)
    expect(flags.active).toBe(false)
  })
})
