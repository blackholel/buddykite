import type { ApiProfile, ProviderPresetKey, ProviderProtocol, ProviderVendor } from '../../types'
import { DEFAULT_MODEL } from '../../types'
import {
  getPresetRecommendedModels,
  inferProfilePresetKey,
  isValidOpenAICompatEndpoint
} from '../../../shared/types/ai-profile'

export { isValidOpenAICompatEndpoint }

export function isValidAnthropicCompatEndpoint(url: string): boolean {
  return !isValidOpenAICompatEndpoint(url)
}

export interface AiProfileTemplate {
  key: string
  presetKey: ProviderPresetKey
  label: string
  vendor: ProviderVendor
  protocol: ProviderProtocol
  connectionMode: 'builtin' | 'custom'
  apiUrlBehavior: 'hidden' | 'advanced' | 'required'
  supportsModelDiscovery: boolean
  apiUrl: string
  defaultModel: string
  modelCatalog: string[]
  recommendedModels: string[]
  docUrl: string
  setupCopy: {
    whatIsThis: string
    whereToGetKey: string
    whatHappensAfterConnect: string
    apiUrlHelp: string
    modelHelp: string
  }
}

export const AI_PROFILE_TEMPLATES: AiProfileTemplate[] = [
  {
    key: 'minimax',
    presetKey: 'minimax',
    label: 'MiniMax',
    vendor: 'minimax',
    protocol: 'anthropic_compat',
    connectionMode: 'builtin',
    apiUrlBehavior: 'hidden',
    supportsModelDiscovery: false,
    apiUrl: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.5',
    modelCatalog: ['MiniMax-M2.5'],
    recommendedModels: getPresetRecommendedModels('minimax'),
    docUrl: 'https://platform.minimaxi.com/docs/coding-plan/claude-code',
    setupCopy: {
      whatIsThis: '这是您的 MiniMax API 访问凭证，用于让 buddykite 代表您发起模型请求。',
      whereToGetKey: '登录 MiniMax 控制台，在 API Key 或开发者设置中创建并复制新的密钥。',
      whatHappensAfterConnect: '连接后，buddykite 会通过您的 MiniMax 账户调用模型，相关费用计入您的 MiniMax 账户。',
      apiUrlHelp: 'MiniMax 使用预置连接地址，通常无需修改。',
      modelHelp: '推荐先使用 MiniMax-M2.5。'
    }
  },
  {
    key: 'moonshot',
    presetKey: 'moonshot',
    label: 'Kimi / Moonshot',
    vendor: 'moonshot',
    protocol: 'anthropic_compat',
    connectionMode: 'builtin',
    apiUrlBehavior: 'hidden',
    supportsModelDiscovery: false,
    apiUrl: 'https://api.moonshot.cn/anthropic',
    defaultModel: 'kimi-k2-thinking',
    modelCatalog: ['kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
    recommendedModels: getPresetRecommendedModels('moonshot'),
    docUrl: 'https://platform.moonshot.cn/docs/guide/agent-support',
    setupCopy: {
      whatIsThis: '这是您的 Moonshot API 访问凭证，用于让 buddykite 调用 Kimi 系列模型。',
      whereToGetKey: '登录 Moonshot 控制台，在 API Key 或开发者中心创建并复制密钥。',
      whatHappensAfterConnect: '连接后，buddykite 会通过您的 Moonshot 账户发起请求，相关费用计入您的 Moonshot 账户。',
      apiUrlHelp: 'Kimi / Moonshot 使用预置连接地址，通常无需修改。',
      modelHelp: '推荐先使用 kimi-k2-thinking。'
    }
  },
  {
    key: 'glm',
    presetKey: 'glm',
    label: 'GLM',
    vendor: 'zhipu',
    protocol: 'anthropic_compat',
    connectionMode: 'builtin',
    apiUrlBehavior: 'hidden',
    supportsModelDiscovery: false,
    apiUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultModel: 'glm-4.7',
    modelCatalog: ['glm-4.7'],
    recommendedModels: getPresetRecommendedModels('glm'),
    docUrl: 'https://open.bigmodel.cn/dev/api',
    setupCopy: {
      whatIsThis: '这是您的智谱 GLM API 访问凭证，用于让 buddykite 调用 GLM 模型。',
      whereToGetKey: '登录智谱开放平台，在 API Key 页面创建并复制密钥。',
      whatHappensAfterConnect: '连接后，buddykite 会通过您的智谱账户发起模型请求，相关费用计入您的智谱账户。',
      apiUrlHelp: 'GLM 使用预置连接地址，通常无需修改。',
      modelHelp: '推荐先使用 glm-4.7。'
    }
  },
  {
    key: 'openai',
    presetKey: 'openai',
    label: 'OpenAI',
    vendor: 'openai',
    protocol: 'openai_compat',
    connectionMode: 'builtin',
    apiUrlBehavior: 'hidden',
    supportsModelDiscovery: true,
    apiUrl: 'https://api.openai.com/v1/responses',
    defaultModel: 'gpt-4o-mini',
    modelCatalog: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-5', 'gpt-5.4', 'gpt-5-codex', 'gpt-5.3-codex'],
    recommendedModels: getPresetRecommendedModels('openai'),
    docUrl: 'https://platform.openai.com/docs/api-reference/responses',
    setupCopy: {
      whatIsThis: '这是您的 OpenAI API Key，用于让 buddykite 使用您的 OpenAI 账户调用模型。',
      whereToGetKey: '登录 OpenAI 控制台，在 API keys 页面创建并复制新的密钥。',
      whatHappensAfterConnect: '连接后，buddykite 会通过您的 OpenAI 账户发起请求，相关费用计入您的 OpenAI 账户。',
      apiUrlHelp: 'OpenAI 使用预置连接地址，通常无需修改。',
      modelHelp: '推荐先使用 gpt-4o-mini 或 gpt-4.1-mini。'
    }
  },
  {
    key: 'anthropic_official',
    presetKey: 'anthropic_official',
    label: 'Anthropic 官方',
    vendor: 'anthropic',
    protocol: 'anthropic_official',
    connectionMode: 'builtin',
    apiUrlBehavior: 'hidden',
    supportsModelDiscovery: false,
    apiUrl: 'https://api.anthropic.com',
    defaultModel: DEFAULT_MODEL,
    modelCatalog: [DEFAULT_MODEL],
    recommendedModels: getPresetRecommendedModels('anthropic_official'),
    docUrl: 'https://docs.anthropic.com',
    setupCopy: {
      whatIsThis: '这是您的 Anthropic API Key，用于让 buddykite 使用您的 Anthropic 账户调用 Claude 模型。',
      whereToGetKey: '登录 Anthropic Console，在 API Keys 页面创建并复制新的密钥。',
      whatHappensAfterConnect: '连接后，buddykite 会通过您的 Anthropic 账户调用 Claude，相关费用计入您的 Anthropic 账户。',
      apiUrlHelp: 'Anthropic 官方接入使用预置地址，无需修改。',
      modelHelp: '推荐先使用当前默认 Claude 模型。'
    }
  },
  {
    key: 'anthropic_compat',
    presetKey: 'custom',
    label: '自定义接入',
    vendor: 'custom',
    protocol: 'anthropic_compat',
    connectionMode: 'custom',
    apiUrlBehavior: 'required',
    supportsModelDiscovery: false,
    apiUrl: 'https://provider.example.com/anthropic',
    defaultModel: DEFAULT_MODEL,
    modelCatalog: [DEFAULT_MODEL],
    recommendedModels: [],
    docUrl: 'https://docs.anthropic.com',
    setupCopy: {
      whatIsThis: '这是您已有模型服务的访问凭证，用于让 buddykite 连接代理、本地服务或企业网关。',
      whereToGetKey: '请到您正在使用的模型服务平台、代理或企业网关中查找并复制 API Key。',
      whatHappensAfterConnect: '连接后，buddykite 会通过您提供的地址与凭证发起模型请求，费用与权限规则取决于该服务本身。',
      apiUrlHelp: '只有在使用代理、本地服务或企业网关时才需要填写连接地址。',
      modelHelp: '如果服务未返回模型列表，请手动填写模型名称。'
    }
  }
]

export const VENDOR_LABELS: Record<ProviderVendor, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  zhipu: 'GLM',
  minimax: 'MiniMax',
  moonshot: 'Kimi / Moonshot',
  custom: 'Custom'
}

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  anthropic_official: 'Anthropic Official',
  anthropic_compat: 'Anthropic Compatible',
  openai_compat: 'OpenAI Compatible'
}

export const API_KEY_PLACEHOLDER_BY_PROTOCOL: Record<ProviderProtocol, string> = {
  anthropic_official: 'sk-ant-xxxxxxxxxxxxx',
  anthropic_compat: 'sk-ant-xxxxxxxxxxxxx',
  openai_compat: 'sk-xxxxxxxxxxxxx'
}

export const API_URL_PLACEHOLDER_BY_PROTOCOL: Record<ProviderProtocol, string> = {
  anthropic_official: 'https://api.anthropic.com',
  anthropic_compat: 'https://provider.example.com/anthropic',
  openai_compat: 'https://provider.example.com/chat/completions or /responses'
}

export function normalizeModelCatalog(defaultModel: string, rawCatalog: string[] | string): string[] {
  const normalizedDefaultModel = defaultModel.trim() || DEFAULT_MODEL
  const rawItems = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog
      .split(',')
      .map(item => item.trim())

  const deduped: string[] = []
  for (const item of rawItems) {
    const normalizedItem = item.trim()
    if (!normalizedItem || deduped.includes(normalizedItem)) {
      continue
    }
    deduped.push(normalizedItem)
  }

  if (!deduped.includes(normalizedDefaultModel)) {
    deduped.unshift(normalizedDefaultModel)
  }

  return deduped
}

export function normalizeModelCatalogForDefaultModelChange(
  nextDefaultModel: string,
  previousDefaultModel: string,
  rawCatalog: string[] | string
): string[] {
  const previous = previousDefaultModel.trim()
  const baseCatalog = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog
      .split(',')
      .map(item => item.trim())

  const filteredCatalog = previous
    ? baseCatalog.filter(item => item.trim() !== previous)
    : baseCatalog

  return normalizeModelCatalog(nextDefaultModel, filteredCatalog)
}

export function normalizeProfileForSave(profile: ApiProfile): ApiProfile {
  const defaultModel = profile.defaultModel.trim() || DEFAULT_MODEL
  return {
    ...profile,
    name: profile.name.trim() || 'Profile',
    presetKey: profile.presetKey || inferProfilePresetKey(profile),
    apiKey: profile.apiKey.trim(),
    apiUrl: profile.apiUrl.trim(),
    defaultModel,
    modelCatalog: normalizeModelCatalog(defaultModel, profile.modelCatalog),
    docUrl: profile.docUrl?.trim() || undefined
  }
}

export function getAiProfileTemplateByPresetKey(presetKey?: ProviderPresetKey): AiProfileTemplate | undefined {
  if (!presetKey) return undefined
  return AI_PROFILE_TEMPLATES.find(template => template.presetKey === presetKey)
}

export function getAiProfileTemplate(profile: Pick<ApiProfile, 'presetKey' | 'vendor' | 'protocol' | 'apiUrl'>): AiProfileTemplate | undefined {
  return (
    getAiProfileTemplateByPresetKey(profile.presetKey) ||
    getAiProfileTemplateByPresetKey(inferProfilePresetKey(profile))
  )
}
