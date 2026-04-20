import fs from 'fs'
import { dirname, join } from 'path'

import { describe, expect, it } from 'vitest'
import { getTestDir } from '../setup'

import {
  FileOpenAICodexCredentialStore,
  InMemoryOpenAICodexCredentialStore
} from '../../../src/main/services/openai-codex/credential-store'

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitUntil timeout')
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('openai-codex.credential-store', () => {
  it('upsert 后可按 tenant/provider/account 读取 active credential', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()

    await store.upsert({
      id: 'cred-1',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-1',
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 60_000
    })

    const credential = await store.getActive('tenant-a', 'openai-codex', 'acct-1')
    expect(credential?.id).toBe('cred-1')
    expect(credential?.accessToken).toBe('token-1')
  })

  it('markRevoked 后不会再返回为 active', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()

    await store.upsert({
      id: 'cred-1',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-1',
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 60_000
    })

    await store.markRevoked('cred-1', 'invalid_grant')

    const credential = await store.getActive('tenant-a', 'openai-codex', 'acct-1')
    expect(credential).toBeNull()
  })

  it('file store 可持久化并跨实例读取', async () => {
    const filePath = join(getTestDir(), '.kite', 'auth.json')
    const storeA = new FileOpenAICodexCredentialStore(filePath)

    await storeA.upsert({
      id: 'cred-file-1',
      tenantId: 'tenant-z',
      providerId: 'openai-codex',
      authMethod: 'oauth_device',
      accountId: 'acct-z',
      accessToken: 'token-z',
      refreshToken: 'refresh-z',
      expiresAt: Date.now() + 120_000
    })

    const storeB = new FileOpenAICodexCredentialStore(filePath)
    const credential = await storeB.getActive('tenant-z', 'openai-codex', 'acct-z')
    expect(credential?.id).toBe('cred-file-1')
    expect(credential?.accessToken).toBe('token-z')
  })

  it('同账号重复授权时 file store 仅保留最新一条', async () => {
    const filePath = join(getTestDir(), '.kite', 'auth-replace.json')
    const store = new FileOpenAICodexCredentialStore(filePath)

    await store.upsert({
      id: 'cred-replace-old',
      tenantId: 'tenant-r',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-r',
      accessToken: 'token-r-old',
      refreshToken: 'refresh-r-old',
      expiresAt: Date.now() + 60_000
    })
    await store.upsert({
      id: 'cred-replace-new',
      tenantId: 'tenant-r',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-r',
      accessToken: 'token-r-new',
      refreshToken: 'refresh-r-new',
      expiresAt: Date.now() + 120_000
    })

    const credential = await store.getActive('tenant-r', 'openai-codex', 'acct-r')
    expect(credential?.id).toBe('cred-replace-new')
    expect(credential?.accessToken).toBe('token-r-new')

    const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { credentials: Array<{ id: string }> }
    expect(snapshot.credentials).toHaveLength(1)
    expect(snapshot.credentials[0].id).toBe('cred-replace-new')
  })

  it('未提供 accountId 时，回退读取最近 active credential', async () => {
    const store = new InMemoryOpenAICodexCredentialStore()

    await store.upsert({
      id: 'cred-older',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-1',
      accessToken: 'token-older',
      refreshToken: 'refresh-older',
      expiresAt: Date.now() + 30_000
    })
    await store.upsert({
      id: 'cred-newer',
      tenantId: 'tenant-a',
      providerId: 'openai-codex',
      authMethod: 'oauth_device',
      accountId: 'acct-2',
      accessToken: 'token-newer',
      refreshToken: 'refresh-newer',
      expiresAt: Date.now() + 60_000
    })

    const credential = await store.getActive('tenant-a', 'openai-codex')
    expect(credential?.id).toBe('cred-newer')
    expect(credential?.accessToken).toBe('token-newer')
  })

  it('accountId 不匹配时不应回退到其他 active credential', async () => {
    const filePath = join(getTestDir(), '.kite', 'auth.json')
    const store = new FileOpenAICodexCredentialStore(filePath)

    await store.upsert({
      id: 'cred-single',
      tenantId: 'tenant-single',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-real',
      accessToken: 'token-single',
      refreshToken: 'refresh-single',
      expiresAt: Date.now() + 60_000
    })

    const credential = await store.getActive('tenant-single', 'openai-codex', 'acct-other')
    expect(credential).toBeNull()
  })

  it('file store 多次 getActive 命中内存快照，后续磁盘变化不影响读取结果', async () => {
    const filePath = join(getTestDir(), '.kite', 'auth-snapshot.json')
    fs.mkdirSync(dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        credentials: [
          {
            id: 'cred-cache',
            tenantId: 'tenant-cache',
            providerId: 'openai-codex',
            authMethod: 'oauth_browser',
            accountId: 'acct-cache',
            accessToken: 'token-cache'
          }
        ]
      }),
      'utf-8'
    )

    const store = new FileOpenAICodexCredentialStore(filePath)

    const first = await store.getActive('tenant-cache', 'openai-codex', 'acct-cache')
    fs.writeFileSync(filePath, JSON.stringify({ credentials: [] }), 'utf-8')
    const second = await store.getActive('tenant-cache', 'openai-codex', 'acct-cache')

    expect(first?.id).toBe('cred-cache')
    expect(second?.id).toBe('cred-cache')
  })

  it('同一路径的多实例应共享内存快照，后创建实例不再要求重读磁盘即可看到更新', async () => {
    const filePath = join(getTestDir(), '.kite', 'auth-shared-state.json')
    const storeA = new FileOpenAICodexCredentialStore(filePath)
    const storeB = new FileOpenAICodexCredentialStore(filePath)

    const before = await storeB.getActive('tenant-shared', 'openai-codex', 'acct-shared')
    expect(before).toBeNull()

    await storeA.upsert({
      id: 'cred-shared',
      tenantId: 'tenant-shared',
      providerId: 'openai-codex',
      authMethod: 'oauth_browser',
      accountId: 'acct-shared',
      accessToken: 'token-shared',
      refreshToken: 'refresh-shared',
      expiresAt: Date.now() + 60_000
    })

    const after = await storeB.getActive('tenant-shared', 'openai-codex', 'acct-shared')
    expect(after?.id).toBe('cred-shared')
    expect(after?.accessToken).toBe('token-shared')
  })

  it('file store 首次加载历史脏数据时会自动压缩为每账号仅一条最新记录', async () => {
    const filePath = join(getTestDir(), '.kite', 'auth-compact.json')
    fs.mkdirSync(dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        credentials: [
          {
            id: 'cred-old',
            tenantId: 'tenant-compact',
            providerId: 'openai-codex',
            authMethod: 'oauth_browser',
            accountId: 'acct-1',
            accessToken: 'token-old'
          },
          {
            id: 'cred-other',
            tenantId: 'tenant-compact',
            providerId: 'openai-codex',
            authMethod: 'oauth_browser',
            accountId: 'acct-2',
            accessToken: 'token-other'
          },
          {
            id: 'cred-latest',
            tenantId: 'tenant-compact',
            providerId: 'openai-codex',
            authMethod: 'oauth_browser',
            accountId: 'acct-1',
            accessToken: 'token-latest'
          }
        ]
      }),
      'utf-8'
    )

    const store = new FileOpenAICodexCredentialStore(filePath)
    const credential = await store.getActive('tenant-compact', 'openai-codex', 'acct-1')
    expect(credential?.id).toBe('cred-latest')

    await waitUntil(() => {
      const compacted = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { credentials: Array<{ id: string }> }
      return compacted.credentials.length === 2
    })

    const compacted = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { credentials: Array<{ id: string }> }
    expect(compacted.credentials.map(item => item.id)).toEqual(['cred-other', 'cred-latest'])
  })
})
