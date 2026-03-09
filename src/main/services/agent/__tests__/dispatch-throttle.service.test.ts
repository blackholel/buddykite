import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({}))
}))

import { getConfig } from '../../config.service'
import { acquireSendDispatchSlot, getDispatchQueueStats } from '../dispatch-throttle.service'

describe('dispatch-throttle.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('单空间超过上限时返回 SPACE_QUEUE_FULL', () => {
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        spaceQueueLimit: 1,
        globalQueueLimit: 10
      }
    } as any)

    const release = acquireSendDispatchSlot('space-1')
    expect(() => acquireSendDispatchSlot('space-1')).toThrowError(/SPACE_QUEUE_FULL|Dispatch queue is full/)
    release()
  })

  it('全局超过上限时返回 GLOBAL_QUEUE_FULL', () => {
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        spaceQueueLimit: 10,
        globalQueueLimit: 1
      }
    } as any)

    const release = acquireSendDispatchSlot('space-1')
    expect(() => acquireSendDispatchSlot('space-2')).toThrowError(/GLOBAL_QUEUE_FULL|Global dispatch queue is full/)
    release()
  })

  it('释放后会回收计数', () => {
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        spaceQueueLimit: 2,
        globalQueueLimit: 2
      }
    } as any)

    const releaseA = acquireSendDispatchSlot('space-1')
    const releaseB = acquireSendDispatchSlot('space-1')

    let stats = getDispatchQueueStats()
    expect(stats.inFlightGlobal).toBe(2)
    expect(stats.inFlightBySpace['space-1']).toBe(2)

    releaseA()
    releaseB()

    stats = getDispatchQueueStats()
    expect(stats.inFlightGlobal).toBe(0)
    expect(stats.inFlightBySpace['space-1']).toBeUndefined()
  })
})

