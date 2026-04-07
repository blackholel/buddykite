import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

vi.mock('../../../openai-compat-router', () => ({
  ensureOpenAICompatRouter: vi.fn(),
  encodeBackendConfig: vi.fn()
}))

import { ensureOpenAICompatRouter, encodeBackendConfig } from '../../../openai-compat-router'
import { getKiteDir } from '../../config.service'
import {
  _testResetOpenAICodexTelemetry,
  _testResetOpenAICodexTokenRefreshService
} from '../../openai-codex'
import * as providerResolver from '../provider-resolver'

describe('provider-resolver', () => {
  const {
    resolveProvider,
    inferOpenAIWireApi,
    shouldEnableAnthropicCompatEnvDefaults,
    shouldUseOpenAICodexExperiment
  } = providerResolver

  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('PROVIDER_OPENAI_CODEX_ENABLED', '1')
    vi.stubEnv('PROVIDER_OPENAI_CODEX_EXPERIMENT', '1')
    _testResetOpenAICodexTokenRefreshService()
    _testResetOpenAICodexTelemetry()
    rmSync(join(getKiteDir(), 'auth.json'), { force: true })
    vi.mocked(ensureOpenAICompatRouter).mockResolvedValue({
      baseUrl: 'http://127.0.0.1:39200'
    } as any)
    vi.mocked(encodeBackendConfig).mockReturnValue('encoded-backend-config')
  })

  it('openai_compat 走本地 router 且使用 model override', async () => {
    const resolved = await resolveProvider({
      id: 'openai-profile',
      name: 'OpenAI',
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'openai-key',
      defaultModel: 'gpt-4.1',
      modelCatalog: ['gpt-4.1'],
      enabled: true
    }, 'gpt-4o-mini')

    expect(resolved.anthropicBaseUrl).toBe('http://127.0.0.1:39200')
    expect(resolved.anthropicApiKey).toBe('encoded-backend-config')
    expect(resolved.sdkModel).toBe('claude-sonnet-4-20250514')
    expect(resolved.effectiveModel).toBe('gpt-4o-mini')
    expect(resolved.protocol).toBe('openai_compat')
    expect(resolved.useAnthropicCompatModelMapping).toBe(false)
    expect(ensureOpenAICompatRouter).toHaveBeenCalledTimes(1)
    expect(encodeBackendConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/responses',
        key: 'openai-key',
        model: 'gpt-4o-mini',
        apiType: 'responses'
      })
    )
  })

  it('anthropic_compat 第三方厂商默认直连 effective model', async () => {
    const resolved = await resolveProvider({
      id: 'glm-profile',
      name: 'GLM',
      vendor: 'zhipu',
      protocol: 'anthropic_compat',
      apiUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'glm-key',
      defaultModel: 'glm-4.5',
      modelCatalog: ['glm-4.5'],
      enabled: true
    }, 'glm-4.5-thinking')

    expect(resolved).toEqual({
      anthropicBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
      anthropicApiKey: 'glm-key',
      sdkModel: 'glm-4.5-thinking',
      effectiveModel: 'glm-4.5-thinking',
      protocol: 'anthropic_compat',
      vendor: 'zhipu',
      useAnthropicCompatModelMapping: false
    })
  })

  it('moonshot anthropic_compat 直传 model 到 sdkModel', async () => {
    const resolved = await resolveProvider({
      id: 'moonshot-profile',
      name: 'Moonshot (Kimi)',
      vendor: 'moonshot',
      protocol: 'anthropic_compat',
      apiUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'moonshot-key',
      defaultModel: 'kimi-k2-turbo',
      modelCatalog: ['kimi-k2-turbo'],
      enabled: true
    }, 'kimi-k2-0905-preview')

    expect(resolved).toEqual({
      anthropicBaseUrl: 'https://api.moonshot.cn/anthropic',
      anthropicApiKey: 'moonshot-key',
      sdkModel: 'kimi-k2-0905-preview',
      effectiveModel: 'kimi-k2-0905-preview',
      protocol: 'anthropic_compat',
      vendor: 'moonshot',
      useAnthropicCompatModelMapping: false
    })
  })

  it('设置 KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING=1 时启用映射模式', async () => {
    vi.stubEnv('KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING', '1')

    const resolved = await resolveProvider({
      id: 'glm-profile',
      name: 'GLM',
      vendor: 'zhipu',
      protocol: 'anthropic_compat',
      apiUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'glm-key',
      defaultModel: 'glm-4.5',
      modelCatalog: ['glm-4.5'],
      enabled: true
    }, 'glm-4.5-thinking')

    expect(resolved.sdkModel).toBe('claude-sonnet-4-20250514')
    expect(resolved.useAnthropicCompatModelMapping).toBe(true)
  })

  it('兼容 legacy ApiConfig 输入', async () => {
    const resolved = await resolveProvider({
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com',
      apiKey: 'legacy-key',
      model: 'claude-3-7-sonnet'
    })

    expect(resolved).toEqual({
      anthropicBaseUrl: 'https://api.anthropic.com',
      anthropicApiKey: 'legacy-key',
      sdkModel: 'claude-3-7-sonnet',
      effectiveModel: 'claude-3-7-sonnet',
      protocol: 'anthropic_official',
      vendor: undefined,
      useAnthropicCompatModelMapping: false
    })
  })

  it('inferOpenAIWireApi 优先读取 env 判定 wire api', () => {
    vi.stubEnv('KITE_OPENAI_API_TYPE', 'chat_completions')
    expect(inferOpenAIWireApi('https://api.openai.com/v1/responses')).toBe('chat_completions')

    vi.unstubAllEnvs()
    vi.stubEnv('KITE_OPENAI_WIRE_API', 'responses')
    expect(inferOpenAIWireApi('https://api.openai.com/v1/chat/completions')).toBe('responses')
  })

  it('openai-codex oauth 模式且 apiUrl 为 chatgpt backend 时，走 codex 路由', async () => {
    const authPath = join(getKiteDir(), 'auth.json')
    if (!existsSync(getKiteDir())) {
      mkdirSync(getKiteDir(), { recursive: true })
    }
    writeFileSync(
      authPath,
      JSON.stringify(
        {
          credentials: [
            {
              id: 'cred-route-1',
              tenantId: 'tenant-001',
              providerId: 'openai-codex',
              authMethod: 'oauth_browser',
              accountId: 'acct-001',
              accessToken: 'token-for-route-test',
              refreshToken: 'refresh-route-1',
              expiresAt: Date.now() + 3600_000
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    )
    vi.stubEnv('KITE_OPENAI_CODEX_ACCOUNT_ID', 'acct-001')

    const resolved = await resolveProvider({
      id: 'openai-codex-profile',
      name: 'OpenAI Codex',
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
      apiKey: 'oauth-access-token',
      openAICodexAuthMode: 'oauth_browser',
      openAICodexTenantId: 'tenant-001',
      defaultModel: 'gpt-5-codex',
      modelCatalog: ['gpt-5-codex'],
      enabled: true
    }, 'gpt-5-codex')

    expect(resolved.anthropicBaseUrl).toBe('http://127.0.0.1:39200')
    expect(resolved.sdkModel).toBe('claude-sonnet-4-20250514')
    expect(resolved.openAICodexContext).toEqual({
      providerId: 'openai-codex',
      authMethod: 'oauth',
      accountId: 'acct-001',
      tokenSource: 'credential',
      refreshState: 'not_needed',
      killSwitch: false
    })
    expect(encodeBackendConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://chatgpt.com/backend-api/codex/responses',
        key: 'token-for-route-test',
        model: 'gpt-5-codex',
        apiType: 'responses',
        headers: {
          'ChatGPT-Account-Id': 'acct-001'
        }
      })
    )
  })

  it('openai-codex oauth 模式优先使用 credential store 中的 access token', async () => {
    const authPath = join(getKiteDir(), 'auth.json')
    if (!existsSync(getKiteDir())) {
      mkdirSync(getKiteDir(), { recursive: true })
    }
    writeFileSync(
      authPath,
      JSON.stringify(
        {
          credentials: [
            {
              id: 'cred-1',
              tenantId: 'tenant-001',
              providerId: 'openai-codex',
              authMethod: 'oauth_browser',
              accountId: 'acct-001',
              accessToken: 'token-from-store',
              refreshToken: 'refresh-1',
              expiresAt: Date.now() + 3600_000
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    )

    await resolveProvider({
      id: 'openai-codex-profile',
      name: 'OpenAI Codex',
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
      apiKey: 'oauth-access-token-fallback',
      openAICodexAuthMode: 'oauth_device',
      openAICodexTenantId: 'tenant-001',
      openAICodexAccountId: 'acct-001',
      defaultModel: 'gpt-5-codex',
      modelCatalog: ['gpt-5-codex'],
      enabled: true
    }, 'gpt-5-codex')

    expect(encodeBackendConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'token-from-store',
        headers: {
          'ChatGPT-Account-Id': 'acct-001'
        }
      })
    )
  })

  it('openai-codex oauth 模式命中熔断时，直接阻断请求', async () => {
    vi.stubEnv('CODEX_KILL_SWITCH', '1')

    await expect(
      resolveProvider({
        id: 'openai-profile',
        name: 'OpenAI',
        vendor: 'openai',
        protocol: 'openai_compat',
        apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
        apiKey: 'oauth-access-token',
        openAICodexAuthMode: 'oauth_browser',
        defaultModel: 'gpt-5-codex',
        modelCatalog: ['gpt-5-codex'],
        enabled: true
      }, 'gpt-5-codex')
    ).rejects.toThrow('OpenAI Codex channel is disabled by kill switch')
  })

  it('openai-codex api_key 模式 + codex endpoint 视为配置错误并阻断', async () => {
    await expect(
      resolveProvider({
        id: 'openai-profile',
        name: 'OpenAI',
        vendor: 'openai',
        protocol: 'openai_compat',
        apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
        apiKey: 'api-key-token',
        openAICodexAuthMode: 'api_key',
        defaultModel: 'gpt-5-codex',
        modelCatalog: ['gpt-5-codex'],
        enabled: true
      }, 'gpt-5-codex')
    ).rejects.toThrow('当前配置为 API Key 模式')
  })

  it('codex oauth 路由下若无凭据且仅有 sk- API key，抛出明确错误', async () => {
    await expect(
      resolveProvider({
        id: 'openai-codex-profile',
        name: 'OpenAI Codex',
        vendor: 'openai',
        protocol: 'openai_compat',
        apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
        apiKey: 'sk-user-invalid-fallback',
        openAICodexAuthMode: 'oauth_browser',
        openAICodexTenantId: 'tenant-x',
        defaultModel: 'gpt-5-codex',
        modelCatalog: ['gpt-5-codex'],
        enabled: true
      }, 'gpt-5-codex')
    ).rejects.toThrow('ChatGPT 授权失效')
  })

  it('shouldUseOpenAICodexExperiment 仅在 oauth 模式 + codex url 时开启', () => {
    expect(shouldUseOpenAICodexExperiment('https://chatgpt.com/backend-api/codex/responses', 'oauth_browser')).toBe(true)
    expect(shouldUseOpenAICodexExperiment('https://chatgpt.com/backend-api/codex/responses', 'oauth_device')).toBe(true)
    expect(shouldUseOpenAICodexExperiment('https://chatgpt.com/backend-api/codex/responses', 'api_key')).toBe(false)
    expect(shouldUseOpenAICodexExperiment('https://api.openai.com/v1/responses', 'oauth_browser')).toBe(false)

    vi.stubEnv('KITE_OPENAI_CODEX_FORCE', '1')
    expect(shouldUseOpenAICodexExperiment('https://api.openai.com/v1/responses', 'api_key')).toBe(false)
    expect(shouldUseOpenAICodexExperiment('https://api.openai.com/v1/responses', 'oauth_browser')).toBe(true)

    vi.unstubAllEnvs()
    expect(shouldUseOpenAICodexExperiment('https://chatgpt.com/backend-api/codex/responses', 'oauth_browser')).toBe(true)
    expect(shouldUseOpenAICodexExperiment('https://chatgpt.com/backend-api/codex/responses', undefined)).toBe(false)
  })

  it('profile 配置 accountId 优先级高于 env 与 jwt 推断', async () => {
    vi.stubEnv('KITE_OPENAI_CODEX_ACCOUNT_ID', 'acct-from-env')
    const fakeJwt =
      'eyJhbGciOiJub25lIn0.' +
      'eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJhY2N0LWZyb20tand0In0.' +
      'signature'

    await resolveProvider({
      id: 'openai-codex-profile',
      name: 'OpenAI Codex',
      vendor: 'openai',
      protocol: 'openai_compat',
      apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
      apiKey: fakeJwt,
      openAICodexAuthMode: 'oauth_browser',
      openAICodexTenantId: 'tenant-priority',
      openAICodexAccountId: 'acct-from-profile',
      defaultModel: 'gpt-5-codex',
      modelCatalog: ['gpt-5-codex'],
      enabled: true
    }, 'gpt-5-codex')

    expect(encodeBackendConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'ChatGPT-Account-Id': 'acct-from-profile'
        }
      })
    )
  })

  it('router 初始化失败时应透传错误（并行链路错误传播）', async () => {
    vi.mocked(ensureOpenAICompatRouter).mockRejectedValueOnce(new Error('router init failed'))

    await expect(
      resolveProvider({
        id: 'openai-codex-profile',
        name: 'OpenAI Codex',
        vendor: 'openai',
        protocol: 'openai_compat',
        apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
        apiKey: 'oauth-fallback-token',
        openAICodexAuthMode: 'oauth_browser',
        openAICodexTenantId: 'tenant-router-fail',
        openAICodexAccountId: 'acct-router-fail',
        defaultModel: 'gpt-5-codex',
        modelCatalog: ['gpt-5-codex'],
        enabled: true
      }, 'gpt-5-codex')
    ).rejects.toThrow('router init failed')
  })

  it('compat env 判定：moonshot/minimax/zhipu 启用，anthropic 官方禁用', () => {
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'moonshot', false)).toBe(true)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'minimax', false)).toBe(true)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'zhipu', false)).toBe(true)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_official', 'anthropic', false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'anthropic', false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('openai_compat', 'moonshot', false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', undefined, false)).toBe(false)
    expect(shouldEnableAnthropicCompatEnvDefaults('anthropic_compat', 'custom', true)).toBe(true)
  })
})
