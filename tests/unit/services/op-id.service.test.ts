import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      opIdTtlMs: 60_000,
      opIdCapacity: 10
    }
  }))
}))

import { executeIdempotentOperation } from '../../../src/main/services/agent/op-id.service'

describe('op-id.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('同 scope + operation + opId 仅执行一次并回放结果', async () => {
    const execute = vi.fn(async () => ({ ok: true }))

    const first = await executeIdempotentOperation({
      scopeKey: 'scope-a',
      operation: 'stop',
      opId: 'op-1',
      execute
    })
    const second = await executeIdempotentOperation({
      scopeKey: 'scope-a',
      operation: 'stop',
      opId: 'op-1',
      execute
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.result).toEqual({ ok: true })
  })

  it('缺失 opId 时不做幂等去重', async () => {
    const execute = vi.fn(async () => ({ ok: true }))

    await executeIdempotentOperation({
      scopeKey: 'scope-a',
      operation: 'approve',
      execute
    })
    await executeIdempotentOperation({
      scopeKey: 'scope-a',
      operation: 'approve',
      execute
    })

    expect(execute).toHaveBeenCalledTimes(2)
  })
})

