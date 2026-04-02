import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getConfigMock = vi.fn()
const resolveProviderMock = vi.fn()
const getCacheInfoMock = vi.fn()
const upsertTranslationMock = vi.fn()

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: (...args: unknown[]) => getConfigMock(...args)
}))

vi.mock('../../../src/main/services/agent/provider-resolver', () => ({
  resolveProvider: (...args: unknown[]) => resolveProviderMock(...args)
}))

vi.mock('../../../src/main/services/resource-display-i18n.service', () => ({
  getResourceDisplayTranslationCacheInfo: (...args: unknown[]) => getCacheInfoMock(...args),
  upsertResourceDisplayTranslation: (...args: unknown[]) => upsertTranslationMock(...args)
}))

import {
  queueResourceDisplayTranslation,
  _testResetResourceDisplayTranslationState
} from '../../../src/main/services/resource-display-translation.service'

function buildDefaultConfig(): Record<string, unknown> {
  return {
    api: {
      provider: 'anthropic',
      apiKey: '',
      apiUrl: 'https://api.anthropic.com',
      model: 'claude-opus-4-5-20251101'
    },
    ai: {
      defaultProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: 'Default',
          vendor: 'anthropic',
          protocol: 'anthropic_official',
          apiUrl: 'https://api.anthropic.com',
          apiKey: 'test-key',
          defaultModel: 'claude-opus-4-5-20251101',
          modelCatalog: ['claude-opus-4-5-20251101'],
          enabled: true
        }
      ]
    }
  }
}

function successResponse(text = '{"title":"代码审查","description":"用于检查代码质量"}'): {
  ok: boolean
  status: number
  json: () => Promise<unknown>
} {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [
        {
          type: 'text',
          text
        }
      ]
    })
  }
}

async function flushAsync(ticks = 2): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitUntil timeout after ${timeoutMs}ms`)
    }
    await flushAsync()
  }
}

describe('resource-display-translation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _testResetResourceDisplayTranslationState()

    getConfigMock.mockReturnValue(buildDefaultConfig())
    resolveProviderMock.mockResolvedValue({
      anthropicBaseUrl: 'https://api.anthropic.com',
      anthropicApiKey: 'test-key',
      sdkModel: 'claude-opus-4-5-20251101'
    })
    getCacheInfoMock.mockReturnValue({})
    upsertTranslationMock.mockReturnValue(true)

    vi.stubGlobal('fetch', vi.fn(async () => successResponse()))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('缺少可用 profile 时跳过翻译', async () => {
    getConfigMock.mockReturnValue({
      ...buildDefaultConfig(),
      ai: {
        defaultProfileId: 'default',
        profiles: [
          {
            id: 'default',
            name: 'Default',
            vendor: 'anthropic',
            protocol: 'anthropic_official',
            apiUrl: 'https://api.anthropic.com',
            apiKey: '',
            defaultModel: 'claude-opus-4-5-20251101',
            modelCatalog: ['claude-opus-4-5-20251101'],
            enabled: true
          }
        ]
      }
    })

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })

    await flushAsync()

    expect(resolveProviderMock).not.toHaveBeenCalled()
    expect(upsertTranslationMock).not.toHaveBeenCalled()
  })

  it('displayName/description 都为空时不入队', async () => {
    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review',
      locale: 'zh-CN'
    })

    await flushAsync()

    expect(resolveProviderMock).not.toHaveBeenCalled()
    expect(upsertTranslationMock).not.toHaveBeenCalled()
  })

  it('locale 缺失项会触发翻译并写入 sidecar', async () => {
    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })

    await flushAsync()

    expect(resolveProviderMock).toHaveBeenCalled()
    expect(upsertTranslationMock).toHaveBeenCalledTimes(1)
    expect(upsertTranslationMock).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: '/tmp/.kite',
      type: 'skill',
      resourceKey: 'review',
      locale: 'zh-CN',
      title: '代码审查',
      description: '用于检查代码质量'
    }))
  })

  it('已有手工翻译时不会覆盖', async () => {
    getCacheInfoMock.mockReturnValueOnce({
      titleLocale: '手工标题',
      descriptionLocale: '手工描述'
    })

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })

    await flushAsync()

    expect(resolveProviderMock).not.toHaveBeenCalled()
    expect(upsertTranslationMock).not.toHaveBeenCalled()
  })

  it('旧 sidecar 占位文案（与原文相同且无 hash）会触发翻译并覆盖', async () => {
    getCacheInfoMock.mockReturnValueOnce({
      titleLocale: 'Code Review',
      descriptionLocale: 'Checks code quality'
    })

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })

    await flushAsync()

    expect(resolveProviderMock).toHaveBeenCalled()
    expect(upsertTranslationMock).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: '/tmp/.kite',
      type: 'skill',
      resourceKey: 'review',
      locale: 'zh-CN',
      title: '代码审查',
      description: '用于检查代码质量',
      allowOverwriteTitleWithoutHash: true,
      allowOverwriteDescriptionWithoutHash: true
    }))
  })

  it('zh-CN 旧英文占位（无 hash 且与当前原文不同）会触发翻译并覆盖', async () => {
    getCacheInfoMock.mockReturnValueOnce({
      titleLocale: 'Use when starting any conversation - establishes operational guardrails.',
      descriptionLocale: 'Use when encountering any bug, test failure, or unexpected behavior.'
    })

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'systematic-debugging',
      locale: 'zh-CN',
      displayNameBase: 'Systematic Debugging',
      descriptionBase: 'Investigate root causes before proposing fixes'
    })

    await flushAsync()

    expect(resolveProviderMock).toHaveBeenCalled()
    expect(upsertTranslationMock).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: '/tmp/.kite',
      type: 'skill',
      resourceKey: 'systematic-debugging',
      locale: 'zh-CN',
      title: '代码审查',
      description: '用于检查代码质量',
      allowOverwriteTitleWithoutHash: true,
      allowOverwriteDescriptionWithoutHash: true
    }))
  })

  it('命中过可用供应商后会优先复用该供应商', async () => {
    getConfigMock.mockReturnValue({
      ...buildDefaultConfig(),
      ai: {
        defaultProfileId: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'P1',
            vendor: 'minimax',
            protocol: 'anthropic_compat',
            apiUrl: 'https://api.vendor-1.com/anthropic',
            apiKey: 'k1',
            defaultModel: 'm1',
            modelCatalog: ['m1'],
            enabled: true
          },
          {
            id: 'p2',
            name: 'P2',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://api.vendor-2.com/v1/responses',
            apiKey: 'k2',
            defaultModel: 'm2',
            modelCatalog: ['m2'],
            enabled: true
          }
        ]
      }
    })
    resolveProviderMock.mockImplementation(async (profile: { id: string }) => ({
      anthropicBaseUrl: `https://router/${profile.id}`,
      anthropicApiKey: `key-${profile.id}`,
      sdkModel: `model-${profile.id}`
    }))

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-a',
      locale: 'zh-CN',
      displayNameBase: 'Code Review A',
      descriptionBase: 'Checks code quality A'
    })
    await flushAsync()

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-b',
      locale: 'zh-CN',
      displayNameBase: 'Code Review B',
      descriptionBase: 'Checks code quality B'
    })
    await flushAsync()

    const calledProfileIds = resolveProviderMock.mock.calls
      .map((call) => (call[0] as { id?: string } | undefined)?.id)
      .filter((id): id is string => Boolean(id))
    expect(calledProfileIds.length).toBeGreaterThan(0)
    expect(new Set(calledProfileIds)).toEqual(new Set(['p1']))
    expect(upsertTranslationMock).toHaveBeenCalledTimes(2)
  })

  it('p1 超时后同任务会快速切换到 p2 成功', async () => {
    getConfigMock.mockReturnValue({
      ...buildDefaultConfig(),
      ai: {
        defaultProfileId: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'P1',
            vendor: 'minimax',
            protocol: 'anthropic_compat',
            apiUrl: 'https://api.vendor-1.com/anthropic',
            apiKey: 'k1',
            defaultModel: 'm1',
            modelCatalog: ['m1'],
            enabled: true
          },
          {
            id: 'p2',
            name: 'P2',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://api.vendor-2.com/v1/responses',
            apiKey: 'k2',
            defaultModel: 'm2',
            modelCatalog: ['m2'],
            enabled: true
          }
        ]
      }
    })
    resolveProviderMock.mockImplementation(async (profile: { id: string }) => ({
      anthropicBaseUrl: `https://router/${profile.id}`,
      anthropicApiKey: `key-${profile.id}`,
      sdkModel: `model-${profile.id}`
    }))

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/p1/')) {
        const timeoutError = new Error('timeout')
        ;(timeoutError as Error & { name: string }).name = 'AbortError'
        throw timeoutError
      }
      return successResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-timeout-fallback',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })
    await flushAsync(4)

    const calledProfileIds = resolveProviderMock.mock.calls
      .map((call) => (call[0] as { id?: string } | undefined)?.id)
      .filter((id): id is string => Boolean(id))

    expect(calledProfileIds).toContain('p1')
    expect(calledProfileIds).toContain('p2')
    expect(upsertTranslationMock).toHaveBeenCalledTimes(1)
  })

  it('返回 200 但不可解析 JSON 时不会进入长冷却（下一任务仍会尝试）', async () => {
    const fetchMock = vi.fn(async () => successResponse('not-json-output'))
    vi.stubGlobal('fetch', fetchMock)

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-parse-1',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })
    await flushAsync(4)

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-parse-2',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })
    await flushAsync(4)

    expect(resolveProviderMock).toHaveBeenCalledTimes(2)
    expect(upsertTranslationMock).not.toHaveBeenCalled()
  })

  it('p1 连续 429 冷却时，后续任务继续使用 p2', async () => {
    getConfigMock.mockReturnValue({
      ...buildDefaultConfig(),
      ai: {
        defaultProfileId: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'P1',
            vendor: 'minimax',
            protocol: 'anthropic_compat',
            apiUrl: 'https://api.vendor-1.com/anthropic',
            apiKey: 'k1',
            defaultModel: 'm1',
            modelCatalog: ['m1'],
            enabled: true
          },
          {
            id: 'p2',
            name: 'P2',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://api.vendor-2.com/v1/responses',
            apiKey: 'k2',
            defaultModel: 'm2',
            modelCatalog: ['m2'],
            enabled: true
          }
        ]
      }
    })
    resolveProviderMock.mockImplementation(async (profile: { id: string }) => ({
      anthropicBaseUrl: `https://router/${profile.id}`,
      anthropicApiKey: `key-${profile.id}`,
      sdkModel: `model-${profile.id}`
    }))

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/p1/')) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { message: 'rate limited' } })
        }
      }
      return successResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-rate-limit-1',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })
    await flushAsync(4)

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-rate-limit-2',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })
    await flushAsync(4)

    const urls = fetchMock.mock.calls
      .map((call) => call[0] as string)
    const p1Calls = urls.filter((url) => url.includes('/p1/')).length
    const p2Calls = urls.filter((url) => url.includes('/p2/')).length

    expect(p1Calls).toBe(1)
    expect(p2Calls).toBe(2)
    expect(upsertTranslationMock).toHaveBeenCalledTimes(2)
  })

  it('10 个任务会并发处理，最大并发不超过 3', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn(async () => {
      inFlight += 1
      if (inFlight > maxInFlight) maxInFlight = inFlight
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight -= 1
      return successResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < 10; i += 1) {
      queueResourceDisplayTranslation({
        rootPath: '/tmp/.kite',
        resourceType: 'skill',
        resourceKey: `review-concurrency-${i}`,
        locale: 'zh-CN',
        displayNameBase: `Code Review ${i}`,
        descriptionBase: `Checks code quality ${i}`
      })
    }

    await waitUntil(() => upsertTranslationMock.mock.calls.length === 10, 3_000)

    expect(maxInFlight).toBe(3)
    expect(upsertTranslationMock).toHaveBeenCalledTimes(10)
  })

  it('thinking 字段不兼容时只重试一次（第二次去掉 thinking）', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Unknown field: thinking'
          }
        })
      })
      .mockResolvedValueOnce(successResponse())
    vi.stubGlobal('fetch', fetchMock)

    queueResourceDisplayTranslation({
      rootPath: '/tmp/.kite',
      resourceType: 'skill',
      resourceKey: 'review-thinking-retry',
      locale: 'zh-CN',
      displayNameBase: 'Code Review',
      descriptionBase: 'Checks code quality'
    })
    await flushAsync(4)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string))
    const secondBody = JSON.parse(((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string))
    expect(firstBody.thinking).toEqual({ type: 'disabled' })
    expect(secondBody.thinking).toBeUndefined()
    expect(upsertTranslationMock).toHaveBeenCalledTimes(1)
  })
})
