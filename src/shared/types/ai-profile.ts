/**
 * Shared AI profile types and compatibility helpers.
 *
 * New model: config.ai (profiles + defaultProfileId)
 * Legacy compatibility: config.api (single provider/model)
 */

export const LEGACY_API_PROVIDERS = [
  'anthropic',
  'anthropic-compat',
  'openai',
  'zhipu',
  'minimax',
  'custom'
] as const

export type LegacyApiProvider = (typeof LEGACY_API_PROVIDERS)[number]

export interface LegacyApiConfig {
  provider: LegacyApiProvider
  apiKey: string
  apiUrl: string
  model: string
}

export type ProviderVendor =
  | 'anthropic'
  | 'openai'
  | 'zhipu'
  | 'minimax'
  | 'moonshot'
  | 'custom'
export type ProviderProtocol = 'anthropic_official' | 'anthropic_compat' | 'openai_compat'
export type ProviderPresetKey =
  | 'openai'
  | 'anthropic_official'
  | 'minimax'
  | 'moonshot'
  | 'glm'
  | 'custom'
export type OpenAICodexAuthMode = 'api_key' | 'oauth_browser' | 'oauth_device'

export interface ApiValidationResult {
  valid: boolean
  message?: string
  model?: string
  resolvedModel?: string
  availableModels: string[]
  manualModelInputRequired: boolean
  connectionSummary?: string
}

export interface ApiProfile {
  id: string
  name: string
  vendor: ProviderVendor
  protocol: ProviderProtocol
  presetKey?: ProviderPresetKey
  apiUrl: string
  apiKey: string
  defaultModel: string
  modelCatalog: string[]
  docUrl?: string
  openAICodexAuthMode?: OpenAICodexAuthMode
  openAICodexTenantId?: string
  openAICodexAccountId?: string
  enabled: boolean
}

export interface ConversationAiConfig {
  profileId: string
  modelOverride?: string
}

export interface AiConfig {
  profiles: ApiProfile[]
  defaultProfileId: string
}

export type AiSetupMissingReason =
  | 'missing_profile'
  | 'missing_api_key'
  | 'disabled_profile'
  | 'invalid_url'

export interface AiSetupState {
  configured: boolean
  reason: AiSetupMissingReason | null
}

export interface AiSetupConfigInput {
  ai?: Partial<AiConfig> | null
  api?: Partial<LegacyApiConfig> | null
}

export const LEGACY_DEFAULT_PROFILE_ID = 'legacy-default'
export const LEGACY_DEFAULT_PROFILE_NAME = 'Default'
export const DEFAULT_LEGACY_MODEL = 'claude-opus-4-5-20251101'

export const DEFAULT_LEGACY_API_CONFIG: LegacyApiConfig = {
  provider: 'anthropic',
  apiKey: '',
  apiUrl: 'https://api.anthropic.com',
  model: DEFAULT_LEGACY_MODEL
}

const BUILTIN_PRESET_RECOMMENDED_MODELS: Record<Exclude<ProviderPresetKey, 'custom'>, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-5', 'gpt-5.4', 'gpt-5-codex', 'gpt-5.3-codex'],
  anthropic_official: [DEFAULT_LEGACY_MODEL],
  minimax: ['MiniMax-M2.5'],
  moonshot: ['kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
  glm: ['glm-4.7']
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function isLegacyApiProvider(value: unknown): value is LegacyApiProvider {
  return typeof value === 'string' && (LEGACY_API_PROVIDERS as readonly string[]).includes(value)
}

function isVendor(value: unknown): value is ProviderVendor {
  return (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'zhipu' ||
    value === 'minimax' ||
    value === 'moonshot' ||
    value === 'custom'
  )
}

function isProtocol(value: unknown): value is ProviderProtocol {
  return value === 'anthropic_official' || value === 'anthropic_compat' || value === 'openai_compat'
}

function isPresetKey(value: unknown): value is ProviderPresetKey {
  return (
    value === 'openai' ||
    value === 'anthropic_official' ||
    value === 'minimax' ||
    value === 'moonshot' ||
    value === 'glm' ||
    value === 'custom'
  )
}

function isOpenAICodexAuthMode(value: unknown): value is OpenAICodexAuthMode {
  return value === 'api_key' || value === 'oauth_browser' || value === 'oauth_device'
}

function toOptionalTrimmedString(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  return value.trim()
}

function normalizeUrlForMatching(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

export function inferProfilePresetKey(input: {
  vendor: ProviderVendor
  protocol: ProviderProtocol
  apiUrl: string
}): ProviderPresetKey {
  const normalizedUrl = normalizeUrlForMatching(input.apiUrl)

  if (input.vendor === 'openai' && input.protocol === 'openai_compat' && normalizedUrl.includes('api.openai.com/')) {
    return 'openai'
  }
  if (input.vendor === 'anthropic' && input.protocol === 'anthropic_official') {
    return 'anthropic_official'
  }
  if (input.vendor === 'minimax' && input.protocol === 'anthropic_compat' && normalizedUrl.includes('api.minimaxi.com/anthropic')) {
    return 'minimax'
  }
  if (input.vendor === 'moonshot' && input.protocol === 'anthropic_compat' && normalizedUrl.includes('api.moonshot.cn/anthropic')) {
    return 'moonshot'
  }
  if (input.vendor === 'zhipu' && input.protocol === 'anthropic_compat' && normalizedUrl.includes('open.bigmodel.cn/api/anthropic')) {
    return 'glm'
  }
  return 'custom'
}

export function getPresetRecommendedModels(presetKey: ProviderPresetKey): string[] {
  if (presetKey === 'custom') return []
  return [...BUILTIN_PRESET_RECOMMENDED_MODELS[presetKey]]
}

export function legacyProviderToVendor(provider: LegacyApiProvider): ProviderVendor {
  if (provider === 'openai') return 'openai'
  if (provider === 'zhipu') return 'zhipu'
  if (provider === 'minimax') return 'minimax'
  if (provider === 'custom') return 'custom'
  return 'anthropic'
}

export function legacyProviderToProtocol(provider: LegacyApiProvider): ProviderProtocol {
  if (provider === 'anthropic') return 'anthropic_official'
  if (provider === 'openai') return 'openai_compat'
  return 'anthropic_compat'
}

export function vendorProtocolToLegacyProvider(
  vendor: ProviderVendor,
  protocol: ProviderProtocol
): LegacyApiProvider {
  if (protocol === 'openai_compat') return 'openai'
  if (vendor === 'zhipu') return 'zhipu'
  if (vendor === 'minimax') return 'minimax'
  if (vendor === 'custom') return 'custom'
  if (vendor === 'anthropic' && protocol === 'anthropic_official') return 'anthropic'
  return 'anthropic-compat'
}

export function ensureLegacyApiConfig(
  api: Partial<LegacyApiConfig> | null | undefined,
  fallback: LegacyApiConfig = DEFAULT_LEGACY_API_CONFIG
): LegacyApiConfig {
  const safeFallback: LegacyApiConfig = {
    provider: isLegacyApiProvider(fallback.provider)
      ? fallback.provider
      : DEFAULT_LEGACY_API_CONFIG.provider,
    apiKey: asString(fallback.apiKey, DEFAULT_LEGACY_API_CONFIG.apiKey),
    apiUrl: asString(fallback.apiUrl, DEFAULT_LEGACY_API_CONFIG.apiUrl),
    model: asString(fallback.model, DEFAULT_LEGACY_API_CONFIG.model)
  }

  if (!api) return safeFallback

  return {
    provider: isLegacyApiProvider(api.provider) ? api.provider : safeFallback.provider,
    apiKey: asString(api.apiKey, safeFallback.apiKey),
    apiUrl: asString(api.apiUrl, safeFallback.apiUrl),
    model: asString(api.model, safeFallback.model)
  }
}

export function createProfileFromLegacyApi(
  api: LegacyApiConfig,
  options: { id?: string; name?: string; enabled?: boolean } = {}
): ApiProfile {
  const safeApi = ensureLegacyApiConfig(api)
  const profileId = isNonEmptyString(options.id) ? options.id.trim() : LEGACY_DEFAULT_PROFILE_ID
  const profileName = isNonEmptyString(options.name) ? options.name.trim() : LEGACY_DEFAULT_PROFILE_NAME
  const defaultModel = safeApi.model || DEFAULT_LEGACY_MODEL

  return {
    id: profileId,
    name: profileName,
    vendor: legacyProviderToVendor(safeApi.provider),
    protocol: legacyProviderToProtocol(safeApi.provider),
    presetKey: inferProfilePresetKey({
      vendor: legacyProviderToVendor(safeApi.provider),
      protocol: legacyProviderToProtocol(safeApi.provider),
      apiUrl: safeApi.apiUrl
    }),
    apiUrl: safeApi.apiUrl,
    apiKey: safeApi.apiKey,
    defaultModel,
    modelCatalog: defaultModel ? [defaultModel] : [],
    enabled: options.enabled ?? true
  }
}

export function profileToLegacyApi(profile: ApiProfile): LegacyApiConfig {
  return ensureLegacyApiConfig({
    provider: vendorProtocolToLegacyProvider(profile.vendor, profile.protocol),
    apiKey: profile.apiKey,
    apiUrl: profile.apiUrl,
    model: profile.defaultModel
  })
}

function normalizeModelCatalog(modelCatalog: unknown, defaultModel: string): string[] {
  if (!Array.isArray(modelCatalog)) {
    return defaultModel ? [defaultModel] : []
  }

  const normalized = modelCatalog
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0)

  if (defaultModel && !normalized.includes(defaultModel)) {
    normalized.unshift(defaultModel)
  }

  return normalized
}

function normalizeProfile(
  rawProfile: Partial<ApiProfile>,
  fallbackApi: LegacyApiConfig,
  index: number
): ApiProfile {
  const fallback = createProfileFromLegacyApi(fallbackApi, {
    id: `${LEGACY_DEFAULT_PROFILE_ID}-${index}`,
    name: `${LEGACY_DEFAULT_PROFILE_NAME} ${index + 1}`
  })

  const defaultModel =
    isNonEmptyString(rawProfile.defaultModel) ? rawProfile.defaultModel.trim() : fallback.defaultModel
  const vendor = isVendor(rawProfile.vendor) ? rawProfile.vendor : fallback.vendor
  const protocol = isProtocol(rawProfile.protocol) ? rawProfile.protocol : fallback.protocol
  const apiUrl = asString(rawProfile.apiUrl, fallback.apiUrl)
  const explicitAuthMode = isOpenAICodexAuthMode(rawProfile.openAICodexAuthMode)
    ? rawProfile.openAICodexAuthMode
    : undefined
  const inferredCodexOAuthMode =
    !explicitAuthMode &&
    vendor === 'openai' &&
    protocol === 'openai_compat' &&
    apiUrl.trim().toLowerCase().includes('chatgpt.com/backend-api')
      ? 'oauth_browser'
      : undefined
  const openAICodexAuthMode = explicitAuthMode || inferredCodexOAuthMode
  const openAICodexTenantId = toOptionalTrimmedString(rawProfile.openAICodexTenantId)

  return {
    id: isNonEmptyString(rawProfile.id) ? rawProfile.id.trim() : fallback.id,
    name: isNonEmptyString(rawProfile.name) ? rawProfile.name.trim() : fallback.name,
    vendor,
    protocol,
    presetKey: isPresetKey(rawProfile.presetKey)
      ? rawProfile.presetKey
      : inferProfilePresetKey({
          vendor,
          protocol,
          apiUrl
        }),
    apiUrl,
    apiKey: asString(rawProfile.apiKey, fallback.apiKey),
    defaultModel,
    modelCatalog: normalizeModelCatalog(rawProfile.modelCatalog, defaultModel),
    docUrl: isNonEmptyString(rawProfile.docUrl) ? rawProfile.docUrl.trim() : undefined,
    openAICodexAuthMode,
    openAICodexTenantId:
      openAICodexAuthMode && openAICodexAuthMode !== 'api_key'
        ? openAICodexTenantId || 'default'
        : openAICodexTenantId,
    openAICodexAccountId: toOptionalTrimmedString(rawProfile.openAICodexAccountId),
    enabled: typeof rawProfile.enabled === 'boolean' ? rawProfile.enabled : true
  }
}

export function createAiConfigFromLegacyApi(
  api: LegacyApiConfig,
  options: { profileId?: string; profileName?: string } = {}
): AiConfig {
  const profile = createProfileFromLegacyApi(api, {
    id: options.profileId,
    name: options.profileName
  })

  return {
    profiles: [profile],
    defaultProfileId: profile.id
  }
}

export function selectDefaultProfileId(ai: Partial<AiConfig> | null | undefined): string | null {
  if (!ai || !Array.isArray(ai.profiles) || ai.profiles.length === 0) {
    return null
  }

  if (isNonEmptyString(ai.defaultProfileId)) {
    const found = ai.profiles.find(profile => profile && profile.id === ai.defaultProfileId)
    if (found) return found.id
  }

  return ai.profiles[0]?.id || null
}

export function ensureAiConfig(
  ai: Partial<AiConfig> | null | undefined,
  fallbackApi?: LegacyApiConfig
): AiConfig {
  const safeFallbackApi = ensureLegacyApiConfig(fallbackApi, DEFAULT_LEGACY_API_CONFIG)

  if (!ai || !Array.isArray(ai.profiles) || ai.profiles.length === 0) {
    return createAiConfigFromLegacyApi(safeFallbackApi)
  }

  const profiles = ai.profiles.map((profile, index) =>
    normalizeProfile((profile ?? {}) as Partial<ApiProfile>, safeFallbackApi, index)
  )

  if (profiles.length === 0) {
    return createAiConfigFromLegacyApi(safeFallbackApi)
  }

  const defaultProfileId =
    isNonEmptyString(ai.defaultProfileId) && profiles.some(profile => profile.id === ai.defaultProfileId)
      ? ai.defaultProfileId
      : profiles[0].id

  return {
    profiles,
    defaultProfileId
  }
}

export function selectDefaultApiProfile(
  ai: Partial<AiConfig> | null | undefined,
  fallbackApi?: LegacyApiConfig
): ApiProfile | null {
  const normalizedAi = ensureAiConfig(ai, fallbackApi)
  const profileId = selectDefaultProfileId(normalizedAi)
  if (!profileId) return null
  return normalizedAi.profiles.find(profile => profile.id === profileId) || null
}

export function isValidOpenAICompatEndpoint(url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') || normalized.endsWith('/responses')
}

export function getAiSetupState(
  config: AiSetupConfigInput | null | undefined,
  profileId?: string | null
): AiSetupState {
  if (config?.ai && Array.isArray(config.ai.profiles) && config.ai.profiles.length === 0) {
    return { configured: false, reason: 'missing_profile' }
  }

  const fallbackApi = ensureLegacyApiConfig(config?.api, DEFAULT_LEGACY_API_CONFIG)
  const normalizedAi = ensureAiConfig(config?.ai, fallbackApi)
  const requestedProfileId = isNonEmptyString(profileId) ? profileId.trim() : null
  const profile =
    (requestedProfileId
      ? normalizedAi.profiles.find(item => item.id === requestedProfileId)
      : undefined) ||
    selectDefaultApiProfile(normalizedAi, fallbackApi)

  if (!profile) {
    return { configured: false, reason: 'missing_profile' }
  }

  if (profile.enabled === false) {
    return { configured: false, reason: 'disabled_profile' }
  }

  if (!isNonEmptyString(profile.apiKey)) {
    return { configured: false, reason: 'missing_api_key' }
  }

  if (profile.protocol === 'openai_compat' && !isValidOpenAICompatEndpoint(profile.apiUrl)) {
    return { configured: false, reason: 'invalid_url' }
  }

  return { configured: true, reason: null }
}

export function mirrorAiToLegacyApi(
  ai: Partial<AiConfig> | null | undefined,
  fallbackApi?: LegacyApiConfig
): LegacyApiConfig {
  const profile = selectDefaultApiProfile(ai, fallbackApi)
  if (!profile) return ensureLegacyApiConfig(fallbackApi, DEFAULT_LEGACY_API_CONFIG)
  return profileToLegacyApi(profile)
}

export function mirrorLegacyApiToAi(
  api: Partial<LegacyApiConfig> | null | undefined,
  currentAi: Partial<AiConfig> | null | undefined
): AiConfig {
  const fallbackFromAi = mirrorAiToLegacyApi(currentAi, DEFAULT_LEGACY_API_CONFIG)
  const normalizedApi = ensureLegacyApiConfig(api, fallbackFromAi)
  const normalizedAi = ensureAiConfig(currentAi, normalizedApi)
  const defaultProfileId = selectDefaultProfileId(normalizedAi) || LEGACY_DEFAULT_PROFILE_ID
  const existingProfile = normalizedAi.profiles.find(profile => profile.id === defaultProfileId)
  const profileName = existingProfile?.name || LEGACY_DEFAULT_PROFILE_NAME
  const mirroredProfile = createProfileFromLegacyApi(normalizedApi, {
    id: defaultProfileId,
    name: profileName,
    enabled: existingProfile?.enabled ?? true
  })

  return {
    ...normalizedAi,
    defaultProfileId,
    profiles: normalizedAi.profiles.map(profile =>
      profile.id === defaultProfileId
        ? {
            ...mirroredProfile,
            docUrl: profile.docUrl,
            openAICodexAuthMode: profile.openAICodexAuthMode,
            openAICodexTenantId: profile.openAICodexTenantId,
            openAICodexAccountId: profile.openAICodexAccountId
          }
        : profile
    )
  }
}

export function isAiConfig(value: unknown): value is AiConfig {
  if (!value || typeof value !== 'object') return false
  const maybe = value as Partial<AiConfig>
  return Array.isArray(maybe.profiles) && typeof maybe.defaultProfileId === 'string'
}
