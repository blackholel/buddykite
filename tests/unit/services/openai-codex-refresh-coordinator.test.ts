import { describe, expect, it } from 'vitest'

import { OpenAICodexRefreshCoordinator } from '../../../src/main/services/openai-codex/refresh-coordinator'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

describe('openai-codex.refresh-coordinator', () => {
  it('相同 credentialKey 的并发刷新只执行一次', async () => {
    const coordinator = new OpenAICodexRefreshCoordinator()
    let refreshCount = 0

    const refreshTask = async (): Promise<string> => {
      refreshCount += 1
      await sleep(20)
      return 'token-1'
    }

    const [a, b] = await Promise.all([
      coordinator.run('cred-1', refreshTask),
      coordinator.run('cred-1', refreshTask)
    ])

    expect(refreshCount).toBe(1)
    expect(a).toBe('token-1')
    expect(b).toBe('token-1')
  })

  it('不同 credentialKey 可以并发刷新', async () => {
    const coordinator = new OpenAICodexRefreshCoordinator()
    let refreshCount = 0

    const refreshTask = async (token: string): Promise<string> => {
      refreshCount += 1
      await sleep(10)
      return token
    }

    const [a, b] = await Promise.all([
      coordinator.run('cred-a', () => refreshTask('a')),
      coordinator.run('cred-b', () => refreshTask('b'))
    ])

    expect(refreshCount).toBe(2)
    expect(a).toBe('a')
    expect(b).toBe('b')
  })

  it('刷新失败后应释放锁并允许下一次刷新', async () => {
    const coordinator = new OpenAICodexRefreshCoordinator()
    let refreshCount = 0

    await expect(
      coordinator.run('cred-err', async () => {
        refreshCount += 1
        throw new Error('invalid_grant')
      })
    ).rejects.toThrow('invalid_grant')

    const value = await coordinator.run('cred-err', async () => {
      refreshCount += 1
      return 'token-ok'
    })

    expect(refreshCount).toBe(2)
    expect(value).toBe('token-ok')
  })
})
