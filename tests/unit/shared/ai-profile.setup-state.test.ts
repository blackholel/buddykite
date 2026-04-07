import { describe, expect, it } from 'vitest'
import { ensureAiConfig, getAiSetupState } from '../../../src/shared/types/ai-profile'

describe('getAiSetupState', () => {
  it('returns missing_profile when ai.profiles is explicitly empty', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [],
        defaultProfileId: ''
      },
      api: {
        provider: 'anthropic',
        apiKey: '',
        apiUrl: 'https://api.anthropic.com',
        model: 'claude-opus-4-5-20251101'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'missing_profile' })
  })

  it('returns missing_api_key when default profile has no key', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'Default',
            vendor: 'anthropic',
            protocol: 'anthropic_official',
            apiUrl: 'https://api.anthropic.com',
            apiKey: '   ',
            defaultModel: 'claude-opus-4-5-20251101',
            modelCatalog: ['claude-opus-4-5-20251101'],
            enabled: true
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'missing_api_key' })
  })

  it('returns disabled_profile when default profile is disabled', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'Default',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://api.openai.com/v1/responses',
            apiKey: 'sk-test',
            defaultModel: 'gpt-4o-mini',
            modelCatalog: ['gpt-4o-mini'],
            enabled: false
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'disabled_profile' })
  })

  it('returns invalid_url for openai_compat profile with invalid endpoint', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'OpenAI',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            defaultModel: 'gpt-4o-mini',
            modelCatalog: ['gpt-4o-mini'],
            enabled: true
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: false, reason: 'invalid_url' })
  })

  it('returns configured=true when profile is valid', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p1',
            name: 'Anthropic',
            vendor: 'anthropic',
            protocol: 'anthropic_official',
            apiUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-test',
            defaultModel: 'claude-sonnet-4-5-20250929',
            modelCatalog: ['claude-sonnet-4-5-20250929'],
            enabled: true
          }
        ],
        defaultProfileId: 'p1'
      }
    })

    expect(state).toEqual({ configured: true, reason: null })
  })

  it('openai-codex endpoint (chatgpt backend /responses) 也应视为有效 openai_compat endpoint', () => {
    const state = getAiSetupState({
      ai: {
        profiles: [
          {
            id: 'p-codex',
            name: 'OpenAI Codex',
            vendor: 'openai',
            protocol: 'openai_compat',
            apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
            apiKey: 'oauth-token',
            defaultModel: 'gpt-5-codex',
            modelCatalog: ['gpt-5-codex'],
            enabled: true
          }
        ],
        defaultProfileId: 'p-codex'
      }
    })

    expect(state).toEqual({ configured: true, reason: null })
  })

  it('uses explicit profileId when provided, even if default profile is invalid', () => {
    const state = getAiSetupState(
      {
        ai: {
          profiles: [
            {
              id: 'p-default',
              name: 'Default',
              vendor: 'anthropic',
              protocol: 'anthropic_official',
              apiUrl: 'https://api.anthropic.com',
              apiKey: '',
              defaultModel: 'claude-sonnet-4-5-20250929',
              modelCatalog: ['claude-sonnet-4-5-20250929'],
              enabled: true
            },
            {
              id: 'p-conversation',
              name: 'Conversation',
              vendor: 'minimax',
              protocol: 'anthropic_compat',
              apiUrl: 'https://api.minimaxi.com/anthropic',
              apiKey: 'mm-key',
              defaultModel: 'MiniMax-Text-01',
              modelCatalog: ['MiniMax-Text-01'],
              enabled: true
            }
          ],
          defaultProfileId: 'p-default'
        }
      },
      'p-conversation'
    )

    expect(state).toEqual({ configured: true, reason: null })
  })

  it('infers presetKey for known built-in provider profiles', () => {
    const ai = ensureAiConfig({
      profiles: [
        {
          id: 'p-openai',
          name: 'OpenAI',
          vendor: 'openai',
          protocol: 'openai_compat',
          apiUrl: 'https://api.openai.com/v1/responses',
          apiKey: 'sk-test',
          defaultModel: 'gpt-4o-mini',
          modelCatalog: ['gpt-4o-mini'],
          enabled: true
        },
        {
          id: 'p-minimax',
          name: 'MiniMax',
          vendor: 'minimax',
          protocol: 'anthropic_compat',
          apiUrl: 'https://api.minimaxi.com/anthropic',
          apiKey: 'mm-key',
          defaultModel: 'MiniMax-M2.5',
          modelCatalog: ['MiniMax-M2.5'],
          enabled: true
        }
      ],
      defaultProfileId: 'p-openai'
    })

    expect(ai.profiles[0].presetKey).toBe('openai')
    expect(ai.profiles[1].presetKey).toBe('minimax')
  })

  it('falls back to custom presetKey when profile does not match built-in template', () => {
    const ai = ensureAiConfig({
      profiles: [
        {
          id: 'p-custom',
          name: 'Corp Gateway',
          vendor: 'anthropic',
          protocol: 'anthropic_compat',
          apiUrl: 'https://gateway.example.com/anthropic',
          apiKey: 'corp-key',
          defaultModel: 'claude-sonnet-4-5-20250929',
          modelCatalog: ['claude-sonnet-4-5-20250929'],
          enabled: true
        }
      ],
      defaultProfileId: 'p-custom'
    })

    expect(ai.profiles[0].presetKey).toBe('custom')
  })

  it('ensureAiConfig 应保留 openai-codex 相关配置字段', () => {
    const ai = ensureAiConfig({
      profiles: [
        {
          id: 'p-codex',
          name: 'OpenAI Codex',
          vendor: 'openai',
          protocol: 'openai_compat',
          apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
          apiKey: 'oauth-token',
          defaultModel: 'gpt-5-codex',
          modelCatalog: ['gpt-5-codex'],
          openAICodexAuthMode: 'oauth_browser',
          openAICodexTenantId: 'tenant-001',
          openAICodexAccountId: 'acct-001',
          enabled: true
        }
      ],
      defaultProfileId: 'p-codex'
    })

    expect(ai.profiles[0].openAICodexAuthMode).toBe('oauth_browser')
    expect(ai.profiles[0].openAICodexTenantId).toBe('tenant-001')
    expect(ai.profiles[0].openAICodexAccountId).toBe('acct-001')
  })

  it('legacy codex profile 缺少 authMode 时应自动迁移为 oauth_browser + default tenant', () => {
    const ai = ensureAiConfig({
      profiles: [
        {
          id: 'p-codex-legacy',
          name: 'OpenAI Codex Legacy',
          vendor: 'openai',
          protocol: 'openai_compat',
          apiUrl: 'https://chatgpt.com/backend-api/codex/responses',
          apiKey: 'sk-user-legacy-token',
          defaultModel: 'gpt-5-codex',
          modelCatalog: ['gpt-5-codex'],
          enabled: true
        }
      ],
      defaultProfileId: 'p-codex-legacy'
    })

    expect(ai.profiles[0].openAICodexAuthMode).toBe('oauth_browser')
    expect(ai.profiles[0].openAICodexTenantId).toBe('default')
  })
})
