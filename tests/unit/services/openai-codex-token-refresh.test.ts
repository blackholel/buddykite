import { describe, expect, it, vi } from 'vitest'

import { InMemoryOpenAICodexCredentialStore } from '../../../src/main/services/openai-codex/credential-store'
import { OpenAICodexRefreshCoordinator } from '../../../src/main/services/openai-codex/refresh-coordinator'
import { OpenAICodexTokenRefreshService } from '../../../src/main/services/openai-codex/token-refresh.service'

function createFetchResponse(status: number, payload: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  } as Response
}

describe('openai-codex.token-refresh', () => {
  it('未过期时直接返回现有 access token', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    await store.upsert({
      id: 'cred-1',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-1',
      accessToken: 'token-current',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3600_000
    })

    const fetchImpl = vi.fn()
    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    const result = await service.ensureValidAccessToken({
      tenantId: 'tenant-a',
      accountId: 'acct-1'
    })

    expect(result.accessToken).toBe('token-current')
    expect(result.source).toBe('credential')
    expect(result.refreshState).toBe('not_needed')
    expect(result.accountId).toBe('acct-1')
    expect(result.tenantId).toBe('tenant-a')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('临近过期时触发刷新，并发请求只刷新一次', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    await store.upsert({
      id: 'cred-2',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-2',
      accessToken: 'token-old',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 1_000
    })

    const fetchImpl = vi.fn(async () =>
      createFetchResponse(200, {
        access_token: 'token-new',
        refresh_token: 'refresh-2-next',
        expires_in: 3600
      })
    )
    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshCoordinator: new OpenAICodexRefreshCoordinator(),
      refreshSkewSec: 120
    })

    const [a, b] = await Promise.all([
      service.ensureValidAccessToken({ tenantId: 'tenant-a', accountId: 'acct-2' }),
      service.ensureValidAccessToken({ tenantId: 'tenant-a', accountId: 'acct-2' })
    ])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(a.accessToken).toBe('token-new')
    expect(b.accessToken).toBe('token-new')
    expect(a.refreshState).toBe('performed')
    expect(b.refreshState).toBe('performed')
    expect(a.accountId).toBe('acct-2')
    expect(a.tenantId).toBe('tenant-a')

    const credential = await store.getActive('tenant-a', 'openai-codex', 'acct-2')
    expect(credential?.accessToken).toBe('token-new')
    expect(credential?.refreshToken).toBe('refresh-2-next')
  })

  it('refresh 返回 invalid_grant 时撤销 credential', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    await store.upsert({
      id: 'cred-3',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-3',
      accessToken: 'token-old',
      refreshToken: 'refresh-3',
      expiresAt: Date.now() - 1_000
    })

    const fetchImpl = vi.fn(async () =>
      createFetchResponse(400, {
        error: 'invalid_grant'
      })
    )
    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshSkewSec: 120
    })

    await expect(
      service.ensureValidAccessToken({ tenantId: 'tenant-a', accountId: 'acct-3' })
    ).rejects.toThrow('invalid_grant')

    const credential = await store.getActive('tenant-a', 'openai-codex', 'acct-3')
    expect(credential).toBeNull()
  })

  it('refresh 错误为对象时应返回可读错误文本', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    await store.upsert({
      id: 'cred-object-error',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-object',
      accessToken: 'token-old',
      refreshToken: 'refresh-object',
      expiresAt: Date.now() - 1_000
    })

    const fetchImpl = vi.fn(async () =>
      createFetchResponse(401, {
        error: {
          code: 'invalid_token',
          message: 'refresh token expired'
        }
      })
    )
    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await expect(
      service.ensureValidAccessToken({ tenantId: 'tenant-a', accountId: 'acct-object' })
    ).rejects.toThrow('Token refresh failed: {"code":"invalid_token","message":"refresh token expired"}')
  })

  it('无 credential 时可回退到 fallbackAccessToken', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: vi.fn() as unknown as typeof fetch
    })

    const result = await service.ensureValidAccessToken({
      tenantId: 'tenant-a',
      accountId: 'acct-missing',
      fallbackAccessToken: 'fallback-token'
    })

    expect(result.accessToken).toBe('fallback-token')
    expect(result.source).toBe('fallback')
    expect(result.refreshState).toBe('fallback')
    expect(result.accountId).toBe('acct-missing')
    expect(result.tenantId).toBe('tenant-a')
  })

  it('accountId 缺失时优先使用 tenant 下现有 credential，不回退 fallbackAccessToken', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    await store.upsert({
      id: 'cred-no-account',
      tenantId: 'tenant-b',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-known',
      accessToken: 'token-from-credential',
      refreshToken: 'refresh-b',
      expiresAt: Date.now() + 3600_000
    })

    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: vi.fn() as unknown as typeof fetch
    })

    const result = await service.ensureValidAccessToken({
      tenantId: 'tenant-b',
      fallbackAccessToken: 'sk-user-fallback'
    })

    expect(result.accessToken).toBe('token-from-credential')
    expect(result.source).toBe('credential')
    expect(result.refreshState).toBe('not_needed')
    expect(result.accountId).toBe('acct-known')
    expect(result.tenantId).toBe('tenant-b')
  })

  it('requireCredential=true 且 tenant 不匹配时应失败，不回退 fallbackAccessToken', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    await store.upsert({
      id: 'cred-other-tenant',
      tenantId: 'tenant-actual',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-known',
      accessToken: 'token-from-credential',
      refreshToken: 'refresh-known',
      expiresAt: Date.now() + 3600_000
    })

    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: vi.fn() as unknown as typeof fetch
    })

    await expect(
      service.ensureValidAccessToken({
        tenantId: 'tenant-mismatch',
        accountId: 'acct-known',
        fallbackAccessToken: 'oauth-fallback',
        requireCredential: true
      })
    ).rejects.toThrow('No active OpenAI Codex credential found')
  })

  it('token 已过期且无 refresh_token 时应报错，不返回过期 access token', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()
    await store.upsert({
      id: 'cred-no-refresh-token-expired',
      tenantId: 'tenant-expired',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-expired',
      accessToken: 'token-expired',
      expiresAt: Date.now() - 1_000
    })

    const service = new OpenAICodexTokenRefreshService({
      credentialStore: store,
      fetchImpl: vi.fn() as unknown as typeof fetch
    })

    await expect(
      service.ensureValidAccessToken({
        tenantId: 'tenant-expired',
        accountId: 'acct-expired'
      })
    ).rejects.toThrow('Token refresh failed: missing refresh_token')
  })
})
