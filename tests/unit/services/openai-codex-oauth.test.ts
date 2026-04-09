import { describe, expect, it, vi } from 'vitest'

import { InMemoryOpenAICodexCredentialStore } from '../../../src/main/services/openai-codex/credential-store'
import { OpenAICodexOAuthService } from '../../../src/main/services/openai-codex/oauth.service'

function createFetchResponse(status: number, payload: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  } as Response
}

describe('openai-codex.oauth', () => {
  it('browser auth: 先生成 authorize URL，再完成 code 交换并持久化 credential', async () => {
    const fetchImpl = vi.fn(async () =>
      createFetchResponse(200, {
        access_token: 'access-token-1',
        refresh_token: 'refresh-token-1',
        expires_in: 3600,
        account_id: 'acct-1',
        scope: 'openid profile offline_access'
      })
    )
    const store = new InMemoryOpenAICodexCredentialStore()
    const service = new OpenAICodexOAuthService({
      clientId: 'client-id-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      credentialStore: store,
      callbackPort: 1455
    })

    const start = await service.startBrowserAuth({ tenantId: 'tenant-a' })
    const authUrl = new URL(start.authUrl)
    expect(authUrl.origin).toBe('https://auth.openai.com')
    expect(authUrl.searchParams.get('client_id')).toBe('client-id-1')
    expect(authUrl.searchParams.get('response_type')).toBe('code')
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('state')).toBe(start.state)

    const finish = await service.finishBrowserAuth({
      state: start.state,
      code: 'auth-code-1'
    })
    expect(finish.token.accessToken).toBe('access-token-1')
    expect(finish.credential.accountId).toBe('acct-1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const fetchBody = `${fetchImpl.mock.calls[0]?.[1]?.body || ''}`
    expect(fetchBody).toContain('grant_type=authorization_code')
    expect(fetchBody).toContain('code=auth-code-1')

    const active = await service.getActiveCredential('tenant-a', 'acct-1')
    expect(active?.accessToken).toBe('access-token-1')
  })

  it('device auth: pending 后再次轮询授权成功', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse(200, {
          device_code: 'device-code-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://chatgpt.com/auth/device',
          interval: 5,
          expires_in: 1800
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse(400, {
          error: 'authorization_pending'
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse(200, {
          access_token: 'access-token-2',
          refresh_token: 'refresh-token-2',
          expires_in: 3600,
          account_id: 'acct-2'
        })
      )
    const store = new InMemoryOpenAICodexCredentialStore()
    const service = new OpenAICodexOAuthService({
      clientId: 'client-id-2',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      credentialStore: store
    })

    const start = await service.startDeviceAuth({ tenantId: 'tenant-b' })
    expect(start.deviceCode).toBe('device-code-1')
    expect(start.userCode).toBe('ABCD-EFGH')

    const pending = await service.pollDeviceAuth({ deviceCode: start.deviceCode })
    expect(pending.status).toBe('pending')

    const authorized = await service.pollDeviceAuth({ deviceCode: start.deviceCode })
    expect(authorized.status).toBe('authorized')
    if (authorized.status === 'authorized') {
      expect(authorized.token.accessToken).toBe('access-token-2')
      expect(authorized.credential.accountId).toBe('acct-2')
    }

    const active = await service.getActiveCredential('tenant-b', 'acct-2')
    expect(active?.accessToken).toBe('access-token-2')
  })

  it('browser auth session 过期后应返回明确错误，且可重新发起授权', async () => {
    const fetchImpl = vi.fn()
    const service = new OpenAICodexOAuthService({
      clientId: 'client-id-expired-browser',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      credentialStore: new InMemoryOpenAICodexCredentialStore()
    })

    const started = await service.startBrowserAuth({ tenantId: 'tenant-c' })
    const sessions = (service as any).browserSessions as Map<string, { session: unknown; expiresAt: number }>
    const entry = sessions.get(started.state)!
    sessions.set(started.state, { ...entry, expiresAt: Date.now() - 1 })

    await expect(
      service.finishBrowserAuth({
        state: started.state,
        code: ''
      })
    ).rejects.toThrow('expired')

    const restarted = await service.startBrowserAuth({ tenantId: 'tenant-c' })
    expect(restarted.state).not.toBe(started.state)
    expect(sessions.has(started.state)).toBe(false)
    expect(sessions.has(restarted.state)).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('device auth session 过期后应提示重新开始授权', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse(200, {
          device_code: 'device-code-expired',
          user_code: 'AAAA-BBBB',
          verification_uri: 'https://chatgpt.com/auth/device',
          interval: 5,
          expires_in: 1800
        })
      )
    const service = new OpenAICodexOAuthService({
      clientId: 'client-id-expired-device',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      credentialStore: new InMemoryOpenAICodexCredentialStore()
    })

    const started = await service.startDeviceAuth({ tenantId: 'tenant-d' })
    const sessions = (service as any).deviceSessions as Map<string, { session: unknown; expiresAt: number }>
    const entry = sessions.get(started.deviceCode)!
    sessions.set(started.deviceCode, { ...entry, expiresAt: Date.now() - 1 })

    await expect(
      service.pollDeviceAuth({ deviceCode: started.deviceCode })
    ).rejects.toThrow('expired')
  })
})
