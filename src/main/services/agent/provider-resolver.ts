/**
 * Provider Resolution
 *
 * Unified logic for selecting and configuring API providers.
 * Eliminates duplicate provider selection code in ensureSessionWarm() and sendMessage().
 */

import { ensureOpenAICompatRouter, encodeBackendConfig } from '../../openai-compat-router'
import type { ApiProfile, ProviderProtocol } from '../../../shared/types/ai-profile'
import {
  OPENAI_CODEX_RESPONSES_URL,
  getOpenAICodexTokenRefreshService,
  recordOpenAICodexTelemetry,
  resolveOpenAICodexFlags
} from '../openai-codex'

/**
 * Legacy API configuration from config.service (backward compatibility).
 */
export interface ApiConfig {
  provider?: string
  apiUrl: string
  apiKey: string
  model?: string
}

/**
 * Resolved provider configuration ready for SDK
 */
export interface ResolvedProvider {
  anthropicBaseUrl: string
  anthropicApiKey: string
  sdkModel: string
  effectiveModel: string
  protocol: ProviderProtocol
  vendor?: ApiProfile['vendor']
  useAnthropicCompatModelMapping: boolean
  openAICodexContext?: {
    providerId: 'openai-codex'
    authMethod: 'oauth'
    accountId?: string
    tokenSource: 'credential' | 'fallback'
    refreshState: 'not_needed' | 'performed' | 'invalid_grant' | 'failed' | 'fallback' | 'no_refresh_token'
    killSwitch: boolean
  }
}

type ResolveProviderInput = ApiProfile | ApiConfig

const DEFAULT_MODEL = 'claude-opus-4-5-20251101'
const OPENAI_COMPAT_SDK_MODEL = 'claude-sonnet-4-20250514'
const OPENAI_CODEX_TENANT_ID_ENV_KEY = 'KITE_OPENAI_CODEX_TENANT_ID'
const OPENAI_CODEX_ACCOUNT_ID_ENV_KEY = 'KITE_OPENAI_CODEX_ACCOUNT_ID'
const OPENAI_CODEX_REFRESH_SKEW_SEC_ENV_KEY = 'KITE_OPENAI_CODEX_REFRESH_SKEW_SEC'
const ANTHROPIC_COMPAT_ENV_DEFAULT_TIMEOUT_MS = '3000000'
const ANTHROPIC_COMPAT_ENV_DEFAULT_VENDORS = new Set([
  'minimax',
  'moonshot',
  'zhipu',
  'topic',
  'custom'
])

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  const parts = trimmed.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractAccountIdFromClaims(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined

  const direct = `${claims.chatgpt_account_id || ''}`.trim()
  if (direct) return direct

  const apiAuth = claims['https://api.openai.com/auth']
  if (apiAuth && typeof apiAuth === 'object') {
    const nested = `${(apiAuth as Record<string, unknown>).chatgpt_account_id || ''}`.trim()
    if (nested) return nested
  }

  const organizations = claims.organizations
  if (Array.isArray(organizations) && organizations.length > 0) {
    const first = organizations[0]
    if (first && typeof first === 'object') {
      const orgId = `${(first as Record<string, unknown>).id || ''}`.trim()
      if (orgId) return orgId
    }
  }

  return undefined
}

function normalizeModel(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function isApiProfile(input: ResolveProviderInput): input is ApiProfile {
  const maybeProfile = input as Partial<ApiProfile>
  return typeof maybeProfile.id === 'string' && typeof maybeProfile.protocol === 'string'
}

function toProtocol(provider: string | undefined): ProviderProtocol {
  if (provider === 'openai') return 'openai_compat'
  if (provider === 'anthropic') return 'anthropic_official'
  return 'anthropic_compat'
}

export function shouldEnableAnthropicCompatEnvDefaults(
  protocol: ProviderProtocol,
  vendor?: ApiProfile['vendor'] | string,
  useAnthropicCompatModelMapping = false
): boolean {
  if (useAnthropicCompatModelMapping) return true
  if (protocol !== 'anthropic_compat') return false
  if (!vendor) return false

  const normalizedVendor = vendor.trim().toLowerCase()
  if (normalizedVendor === 'anthropic') return false

  return ANTHROPIC_COMPAT_ENV_DEFAULT_VENDORS.has(normalizedVendor)
}

export function buildAnthropicCompatEnvDefaults(effectiveModel: string): Record<string, string> {
  return {
    API_TIMEOUT_MS: process.env.API_TIMEOUT_MS || ANTHROPIC_COMPAT_ENV_DEFAULT_TIMEOUT_MS,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ANTHROPIC_MODEL: effectiveModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: effectiveModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: effectiveModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: effectiveModel
  }
}

function resolveInput(
  input: ResolveProviderInput,
  modelHint: string
): {
  protocol: ProviderProtocol
  vendor?: ApiProfile['vendor']
  apiUrl: string
  apiKey: string
  effectiveModel: string
  openAICodexAuthMode?: ApiProfile['openAICodexAuthMode']
  openAICodexTenantId?: string
  openAICodexAccountId?: string
} {
  if (isApiProfile(input)) {
    return {
      protocol: input.protocol,
      vendor: input.vendor,
      apiUrl: input.apiUrl,
      apiKey: input.apiKey,
      effectiveModel: normalizeModel(modelHint) || normalizeModel(input.defaultModel) || DEFAULT_MODEL,
      openAICodexAuthMode: input.openAICodexAuthMode,
      openAICodexTenantId: input.openAICodexTenantId,
      openAICodexAccountId: input.openAICodexAccountId
    }
  }

  return {
    protocol: toProtocol(input.provider),
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    effectiveModel: normalizeModel(input.model) || normalizeModel(modelHint) || DEFAULT_MODEL
  }
}

/**
 * Infer OpenAI wire API type from URL or environment
 */
export function inferOpenAIWireApi(apiUrl: string): 'responses' | 'chat_completions' {
  const envApiType = process.env.KITE_OPENAI_API_TYPE || process.env.KITE_OPENAI_WIRE_API
  if (envApiType) {
    const v = envApiType.toLowerCase()
    if (v.includes('response')) return 'responses'
    if (v.includes('chat')) return 'chat_completions'
  }
  if (apiUrl && apiUrl.includes('/responses')) return 'responses'
  // Default to responses (OpenAI new API format)
  return 'responses'
}

function isOpenAICodexBackendUrl(apiUrl: string): boolean {
  const normalized = apiUrl.trim().toLowerCase()
  return normalized.includes('chatgpt.com/backend-api')
}

function isOpenAICodexOAuthMode(
  mode: ApiProfile['openAICodexAuthMode'] | undefined
): mode is 'oauth_browser' | 'oauth_device' {
  return mode === 'oauth_browser' || mode === 'oauth_device'
}

export function shouldUseOpenAICodexExperiment(
  apiUrl: string,
  authMode: ApiProfile['openAICodexAuthMode'] | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flags = resolveOpenAICodexFlags(env)
  if (flags.killed) return false
  if (!isOpenAICodexOAuthMode(authMode)) return false
  if (env.KITE_OPENAI_CODEX_FORCE === '1') return true
  return isOpenAICodexBackendUrl(apiUrl)
}

/**
 * Resolve provider configuration for SDK
 *
 * Provider modes:
 * - anthropic_official: Official Anthropic API - direct connection
 * - anthropic_compat: Anthropic-compatible backends - direct connection
 * - openai_compat: OpenAI-compatible backends - requires protocol conversion via local Router
 *
 * Backward compatibility:
 * - ApiProfile input: second parameter is `modelOverride`
 * - Legacy ApiConfig input: second parameter is `defaultModel`
 * @returns Resolved provider configuration
 */
export async function resolveProvider(
  profile: ApiProfile,
  modelOverride?: string
): Promise<ResolvedProvider>
export async function resolveProvider(
  apiConfig: ApiConfig,
  defaultModel?: string
): Promise<ResolvedProvider>
export async function resolveProvider(
  input: ResolveProviderInput,
  modelOverrideOrDefaultModel = DEFAULT_MODEL
): Promise<ResolvedProvider> {
  const resolved = resolveInput(input, modelOverrideOrDefaultModel)
  // Default: direct model passthrough for anthropic_compat vendors.
  // Opt-in mapping mode is kept for specific gateways that require Claude alias models.
  const forceCompatModelMapping = process.env.KITE_FORCE_ANTHROPIC_COMPAT_MODEL_MAPPING === '1'
  const useAnthropicCompatModelMapping =
    forceCompatModelMapping &&
    resolved.protocol === 'anthropic_compat' &&
    !!resolved.vendor &&
    resolved.vendor !== 'anthropic'
  let anthropicBaseUrl = resolved.apiUrl
  let anthropicApiKey = resolved.apiKey
  let sdkModel = useAnthropicCompatModelMapping ? OPENAI_COMPAT_SDK_MODEL : resolved.effectiveModel
  let openAICodexContext: ResolvedProvider['openAICodexContext']

  if (resolved.protocol === 'openai_compat') {
    const codexOAuthRequested =
      isOpenAICodexOAuthMode(resolved.openAICodexAuthMode) &&
      isOpenAICodexBackendUrl(resolved.apiUrl)
    const codexApiKeyMisconfigured =
      resolved.openAICodexAuthMode === 'api_key' &&
      isOpenAICodexBackendUrl(resolved.apiUrl)
    const codexFlags = resolveOpenAICodexFlags()
    if (codexApiKeyMisconfigured) {
      throw new Error(
        '当前配置为 API Key 模式，不能使用 ChatGPT Codex endpoint。请切换为 ChatGPT 授权模式，或把 API URL 改为 https://api.openai.com/v1/responses。'
      )
    }
    if (codexOAuthRequested && codexFlags.killed) {
      throw new Error('OpenAI Codex channel is disabled by kill switch.')
    }
    const useOpenAICodexExperiment = shouldUseOpenAICodexExperiment(
      resolved.apiUrl,
      resolved.openAICodexAuthMode
    )
    const targetUrl = useOpenAICodexExperiment ? OPENAI_CODEX_RESPONSES_URL : resolved.apiUrl
    const apiType = useOpenAICodexExperiment ? 'responses' : inferOpenAIWireApi(resolved.apiUrl)
    const profileAccountId = useOpenAICodexExperiment
      ? (resolved.openAICodexAccountId || '').trim()
      : ''
    const envAccountId = useOpenAICodexExperiment
      ? (process.env[OPENAI_CODEX_ACCOUNT_ID_ENV_KEY] || '').trim()
      : ''
    const inferredAccountId = useOpenAICodexExperiment
      ? (extractAccountIdFromClaims(decodeJwtPayload(resolved.apiKey)) || '')
      : ''
    const requestedAccountId = profileAccountId || envAccountId || inferredAccountId
    const tenantId = useOpenAICodexExperiment
      ? (
          (resolved.openAICodexTenantId || '').trim() ||
          (process.env[OPENAI_CODEX_TENANT_ID_ENV_KEY] || 'default').trim() ||
          'default'
        )
      : 'default'
    const refreshSkewSec = useOpenAICodexExperiment
      ? Number(process.env[OPENAI_CODEX_REFRESH_SKEW_SEC_ENV_KEY] || 0) || undefined
      : undefined

    // OpenAI compatibility mode: enable local Router for protocol conversion
    // - resolved.apiUrl/apiKey holds user's "real OpenAI-compatible backend" info
    // - ANTHROPIC_* injected to Claude Code points to local Router
    // - Pass a fake Claude model name to CC (CC may validate model must start with claude-*)
    //   Real model is in encodeBackendConfig, Router uses it for requests
    const routerPromise = ensureOpenAICompatRouter({ debug: false })
    const accessTokenPromise = useOpenAICodexExperiment
      ? getOpenAICodexTokenRefreshService().ensureValidAccessToken({
          tenantId,
          accountId: requestedAccountId || undefined,
          refreshSkewSec,
          fallbackAccessToken: resolved.apiKey
        })
      : Promise.resolve({
          accessToken: resolved.apiKey,
          source: 'fallback' as const,
          refreshState: 'fallback' as const,
          tenantId,
          accountId: undefined
        })
    let resolvedAccessTokenResult:
      | {
          accessToken: string
          source: 'credential' | 'fallback'
          refreshState: 'not_needed' | 'performed' | 'invalid_grant' | 'failed' | 'fallback' | 'no_refresh_token'
          tenantId: string
          accountId?: string
        }
      | {
          accessToken: string
          source: 'fallback'
          refreshState: 'fallback'
          tenantId: string
          accountId?: string
        }
    try {
      const [router, accessTokenResult] = await Promise.all([routerPromise, accessTokenPromise])
      anthropicBaseUrl = router.baseUrl
      resolvedAccessTokenResult = accessTokenResult
    } catch (error) {
      const message = `${(error as Error).message || ''}`.toLowerCase()
      if (
        useOpenAICodexExperiment &&
        (message.includes('invalid_grant') || message.includes('no active openai codex credential found'))
      ) {
        throw new Error('ChatGPT 授权失效，请在设置中重新连接账号。')
      }
      throw error
    }
    const resolvedAccessToken = resolvedAccessTokenResult.accessToken
    const accountId =
      profileAccountId ||
      resolvedAccessTokenResult.accountId ||
      envAccountId ||
      inferredAccountId
    if (
      useOpenAICodexExperiment &&
      resolvedAccessTokenResult.source === 'fallback' &&
      /^sk-[a-z0-9_-]+/i.test(resolvedAccessToken)
    ) {
      throw new Error('ChatGPT 授权失效，请在设置中重新连接账号。')
    }
    anthropicApiKey = encodeBackendConfig({
      url: targetUrl,
      key: resolvedAccessToken,
      model: resolved.effectiveModel, // Real model passed to Router
      ...(apiType ? { apiType } : {}),
      ...(accountId ? { headers: { 'ChatGPT-Account-Id': accountId } } : {})
    })

    if (useOpenAICodexExperiment) {
      if (!accountId) {
        throw new Error('缺少 ChatGPT Account ID，请在设置中重新连接账号。')
      }
      openAICodexContext = {
        providerId: 'openai-codex',
        authMethod: 'oauth',
        accountId: accountId || undefined,
        tokenSource: resolvedAccessTokenResult.source,
        refreshState: resolvedAccessTokenResult.refreshState,
        killSwitch: codexFlags.killed
      }
    }

    recordOpenAICodexTelemetry({
      type: 'provider_resolve',
      experimentActive: useOpenAICodexExperiment,
      killSwitch: codexFlags.killed
    })
    // Pass a fake Claude model to CC for normal request handling
    sdkModel = OPENAI_COMPAT_SDK_MODEL
  }

  return {
    anthropicBaseUrl,
    anthropicApiKey,
    sdkModel,
    effectiveModel: resolved.effectiveModel,
    protocol: resolved.protocol,
    vendor: resolved.vendor,
    useAnthropicCompatModelMapping,
    ...(openAICodexContext ? { openAICodexContext } : {})
  }
}
