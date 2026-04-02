import { createHash } from 'crypto'
import { getConfig } from './config.service'
import { resolveProvider } from './agent/provider-resolver'
import {
  getResourceDisplayTranslationCacheInfo,
  upsertResourceDisplayTranslation
} from './resource-display-i18n.service'
import {
  ensureAiConfig,
  isValidOpenAICompatEndpoint,
  type ApiProfile
} from '../../shared/types/ai-profile'
import type { ResourceType } from '../../shared/resource-access'

interface ResourceDisplayTranslationRequest {
  rootPath?: string
  resourceType: ResourceType
  resourceKey: string
  locale?: string
  displayNameBase?: string
  descriptionBase?: string
}

interface TranslationResult {
  title?: string
  description?: string
}

type TranslationFailureKind =
  | 'rate_limit'
  | 'network_timeout'
  | 'http_error'
  | 'parse_error'
  | 'empty_payload'

interface TranslationAttemptResult {
  ok: boolean
  failureKind?: TranslationFailureKind
  status?: number
  parsed?: TranslationResult
  text?: string
  elapsedMs: number
  payload?: unknown
}

const inFlightTranslations = new Map<string, Promise<void>>()
const pendingTranslationQueue: Array<{ dedupeKey: string; request: ResourceDisplayTranslationRequest }> = []
const pendingTranslationKeys = new Set<string>()
let activeTranslationWorkers = 0
let preferredTranslationProfileId: string | null = null
let selectedTranslationProfileId: string | null = null

const MAX_TRANSLATION_CONCURRENCY = 3
const TRANSLATION_REQUEST_TIMEOUT_MS = 8_000
const PROFILE_429_COOLDOWN_BASE_MS = 10_000
const PROFILE_429_COOLDOWN_MAX_MS = 60_000
const PROFILE_NETWORK_TIMEOUT_COOLDOWN_MS = 20_000
const PROFILE_SERVER_HTTP_COOLDOWN_MS = 15_000

interface ProfileTranslationHealth {
  cooldownUntil: number
  consecutive429: number
  consecutiveFailures: number
}

const profileTranslationHealth = new Map<string, ProfileTranslationHealth>()

function trimText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeLocale(locale?: string): string | undefined {
  if (!locale) return undefined
  const trimmed = locale.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isEnglishLocale(locale: string): boolean {
  const normalized = locale.toLowerCase()
  return normalized === 'en' || normalized.startsWith('en-') || normalized.startsWith('en_')
}

function buildSourceTextHash(title?: string, description?: string): string {
  const raw = JSON.stringify({
    title: title || '',
    description: description || ''
  })
  return createHash('sha256').update(raw).digest('hex')
}

function listEnabledProfilesForTranslation(): ApiProfile[] {
  const config = getConfig()
  const aiConfig = ensureAiConfig(config.ai, config.api)
  const enabledProfiles: ApiProfile[] = []
  for (const profile of aiConfig.profiles) {
    if (profile.enabled === false) continue
    if (!trimText(profile.apiKey)) continue
    if (profile.protocol === 'openai_compat' && !isValidOpenAICompatEndpoint(profile.apiUrl)) continue
    enabledProfiles.push(profile)
  }
  return enabledProfiles
}

function orderProfilesForAttempt(profiles: ApiProfile[]): ApiProfile[] {
  const now = Date.now()
  const availableProfiles = profiles.filter((profile) => !isProfileCoolingDown(profile.id, now))
  if (availableProfiles.length <= 1) return availableProfiles

  const config = getConfig()
  const aiConfig = ensureAiConfig(config.ai, config.api)
  const ids: string[] = []
  const pushId = (id: string | null | undefined): void => {
    if (!id) return
    if (!availableProfiles.some((profile) => profile.id === id)) return
    if (ids.includes(id)) return
    ids.push(id)
  }

  pushId(selectedTranslationProfileId)
  pushId(preferredTranslationProfileId)
  pushId(trimText(aiConfig.defaultProfileId))

  for (const profile of availableProfiles) {
    if (!ids.includes(profile.id)) ids.push(profile.id)
  }

  return ids
    .map((id) => availableProfiles.find((profile) => profile.id === id))
    .filter((profile): profile is ApiProfile => Boolean(profile))
}

function isProfileCoolingDown(profileId: string, now = Date.now()): boolean {
  const health = profileTranslationHealth.get(profileId)
  if (!health) return false
  return health.cooldownUntil > now
}

function markProfileTranslationSuccess(profileId: string): void {
  profileTranslationHealth.delete(profileId)
  if (preferredTranslationProfileId !== profileId) {
    preferredTranslationProfileId = profileId
  }
  if (selectedTranslationProfileId !== profileId) {
    selectedTranslationProfileId = profileId
  }
}

function computeCooldownMs(
  previous: ProfileTranslationHealth,
  failureKind: TranslationFailureKind,
  status?: number
): number {
  if (failureKind === 'rate_limit') {
    const nextConsecutive429 = previous.consecutive429 + 1
    return Math.min(
      PROFILE_429_COOLDOWN_MAX_MS,
      PROFILE_429_COOLDOWN_BASE_MS * Math.pow(2, Math.max(0, nextConsecutive429 - 1))
    )
  }

  if (failureKind === 'network_timeout') {
    return PROFILE_NETWORK_TIMEOUT_COOLDOWN_MS
  }

  if (failureKind === 'http_error' && (status === 408 || (typeof status === 'number' && status >= 500))) {
    return PROFILE_SERVER_HTTP_COOLDOWN_MS
  }

  return 0
}

function markProfileTranslationFailure(
  profileId: string,
  failureKind: TranslationFailureKind,
  status?: number
): void {
  const now = Date.now()
  if (preferredTranslationProfileId === profileId) preferredTranslationProfileId = null
  if (selectedTranslationProfileId === profileId) selectedTranslationProfileId = null
  const previous = profileTranslationHealth.get(profileId) || {
    cooldownUntil: 0,
    consecutive429: 0,
    consecutiveFailures: 0
  }

  const cooldownMs = computeCooldownMs(previous, failureKind, status)
  const nextConsecutive429 = failureKind === 'rate_limit' ? previous.consecutive429 + 1 : 0
  const nextConsecutiveFailures = previous.consecutiveFailures + 1

  if (cooldownMs <= 0) {
    profileTranslationHealth.delete(profileId)
    return
  }

  profileTranslationHealth.set(profileId, {
    cooldownUntil: now + cooldownMs,
    consecutive429: nextConsecutive429,
    consecutiveFailures: nextConsecutiveFailures
  })
}

function resolveMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.endsWith('/v1/messages')) return normalized
  return `${normalized}/v1/messages`
}

function normalizeTranslationResult(input: unknown): TranslationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const record = input as Record<string, unknown>
  return {
    ...(trimText(record.title) ? { title: trimText(record.title) } : {}),
    ...(trimText(record.description) ? { description: trimText(record.description) } : {})
  }
}

function parseTranslationJson(rawText: string): TranslationResult {
  const direct = normalizeTranslationResult(JSON.parse(rawText))
  if (direct.title || direct.description) return direct
  return {}
}

function parseTranslationPayload(rawText: string): TranslationResult {
  const normalized = rawText.trim()
  if (!normalized) return {}

  try {
    return parseTranslationJson(normalized)
  } catch {
    // continue
  }

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try {
      return parseTranslationJson(fenced[1].trim())
    } catch {
      // continue
    }
  }

  const firstBrace = normalized.indexOf('{')
  const lastBrace = normalized.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return parseTranslationJson(normalized.slice(firstBrace, lastBrace + 1))
    } catch {
      // ignore
    }
  }

  return {}
}

function extractTextFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>

  const contentBlocks = Array.isArray(record.content)
    ? (record.content as Array<Record<string, unknown>>)
    : []
  const contentTexts = contentBlocks
    .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : undefined))
    .filter((item): item is string => Boolean(item))
  if (contentTexts.length > 0) return contentTexts.join('\n')

  const outputText = trimText(record.output_text)
  if (outputText) return outputText

  const choices = Array.isArray(record.choices)
    ? (record.choices as Array<Record<string, unknown>>)
    : []
  const choiceTexts: string[] = []
  for (const choice of choices) {
    const message = choice?.message
    if (!message || typeof message !== 'object') continue
    const messageRecord = message as Record<string, unknown>
    const directText = trimText(messageRecord.content)
    if (directText) {
      choiceTexts.push(directText)
      continue
    }
    if (Array.isArray(messageRecord.content)) {
      for (const item of messageRecord.content as Array<Record<string, unknown>>) {
        const text = trimText(item?.text)
        if (text) choiceTexts.push(text)
      }
    }
  }
  if (choiceTexts.length > 0) return choiceTexts.join('\n')

  return undefined
}

function isSameText(left: string | undefined, right: string | undefined): boolean {
  const a = trimText(left)
  const b = trimText(right)
  if (!a || !b) return false
  return a === b
}

function shouldTreatAsStaleLocalePlaceholder(locale: string, localizedText: string | undefined): boolean {
  const normalizedLocale = locale.trim().toLowerCase()
  const text = trimText(localizedText)
  if (!text) return false
  if (normalizedLocale === 'en' || normalizedLocale.startsWith('en-') || normalizedLocale.startsWith('en_')) {
    return false
  }

  if (normalizedLocale.startsWith('zh')) {
    if (/[一-鿿]/.test(text)) return false
    return /[a-z]/i.test(text)
  }

  return false
}

function buildUserPrompt(params: {
  locale: string
  title?: string
  description?: string
}): string {
  return [
    `Target locale: ${params.locale}`,
    '',
    'Translate ONLY UI display texts for a resource card.',
    'Keep these unchanged: product names, code identifiers, slash tokens, mention tokens, file names, namespaces, resource keys.',
    'Title should be short and direct for non-technical users.',
    'Description should simply explain what the skill/agent/command does.',
    'Return strict JSON only: {"title":"...","description":"..."}.',
    '',
    `title: ${params.title || ''}`,
    `description: ${params.description || ''}`
  ].join('\n')
}

function shouldRetryWithoutThinking(attempt: TranslationAttemptResult): boolean {
  if (attempt.ok) return false
  if (attempt.failureKind !== 'http_error') return false
  if (typeof attempt.status !== 'number' || attempt.status < 400 || attempt.status >= 500) return false

  const payloadText = typeof attempt.payload === 'string'
    ? attempt.payload
    : JSON.stringify(attempt.payload || {})
  const normalized = payloadText.toLowerCase()
  return (
    normalized.includes('thinking')
    || normalized.includes('unsupported')
    || normalized.includes('unknown field')
    || normalized.includes('not allowed')
    || normalized.includes('additional properties')
    || normalized.includes('extra inputs')
  )
}

async function runTranslationAttempt(params: {
  url: string
  apiKey: string
  body: Record<string, unknown>
}): Promise<TranslationAttemptResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), TRANSLATION_REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(params.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(params.body),
      signal: controller.signal
    })
  } catch (error) {
    clearTimeout(timeoutHandle)
    const failureKind: TranslationFailureKind =
      error instanceof Error && error.name === 'AbortError'
        ? 'network_timeout'
        : 'http_error'
    return {
      ok: false,
      failureKind,
      elapsedMs: Date.now() - startedAt
    }
  }

  clearTimeout(timeoutHandle)

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      failureKind: response.status === 429 ? 'rate_limit' : 'http_error',
      elapsedMs: Date.now() - startedAt,
      payload
    }
  }

  const text = extractTextFromPayload(payload)
  if (!text) {
    return {
      ok: false,
      status: response.status,
      failureKind: 'empty_payload',
      elapsedMs: Date.now() - startedAt,
      payload
    }
  }

  const parsed = parseTranslationPayload(text)
  if (parsed.title || parsed.description) {
    return {
      ok: true,
      status: response.status,
      parsed,
      text,
      elapsedMs: Date.now() - startedAt,
      payload
    }
  }

  return {
    ok: false,
    status: response.status,
    failureKind: 'parse_error',
    text,
    elapsedMs: Date.now() - startedAt,
    payload
  }
}

async function requestTranslation(params: {
  locale: string
  resourceKey: string
  title?: string
  description?: string
}): Promise<TranslationResult> {
  const profiles = orderProfilesForAttempt(listEnabledProfilesForTranslation())
  if (profiles.length === 0) return {}

  const userPrompt = buildUserPrompt(params)
  for (const profile of profiles) {
    const queueDepth = pendingTranslationQueue.length
    try {
      const resolved = await resolveProvider(profile, profile.defaultModel)
      const url = resolveMessagesUrl(resolved.anthropicBaseUrl)
      const baseBody = {
        model: resolved.sdkModel,
        temperature: 0,
        max_tokens: 220,
        stream: false,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      }

      const firstAttempt = await runTranslationAttempt({
        url,
        apiKey: resolved.anthropicApiKey,
        body: {
          ...baseBody,
          thinking: { type: 'disabled' }
        }
      })
      if (firstAttempt.ok) {
        markProfileTranslationSuccess(profile.id)
        return firstAttempt.parsed || {}
      }

      let finalAttempt = firstAttempt
      if (shouldRetryWithoutThinking(firstAttempt)) {
        const secondAttempt = await runTranslationAttempt({
          url,
          apiKey: resolved.anthropicApiKey,
          body: baseBody
        })
        if (secondAttempt.ok) {
          markProfileTranslationSuccess(profile.id)
          return secondAttempt.parsed || {}
        }
        finalAttempt = secondAttempt
      }

      const failureKind = finalAttempt.failureKind || 'http_error'
      markProfileTranslationFailure(profile.id, failureKind, finalAttempt.status)
      console.warn('[DisplayTranslation] Provider translation failed:', {
        resourceKey: params.resourceKey,
        profileId: profile.id,
        failureKind,
        status: finalAttempt.status,
        elapsedMs: finalAttempt.elapsedMs,
        queueDepth
      })
    } catch (error) {
      markProfileTranslationFailure(profile.id, 'http_error')
      console.warn('[DisplayTranslation] Provider attempt failed:', {
        resourceKey: params.resourceKey,
        profileId: profile.id,
        failureKind: 'http_error',
        elapsedMs: 0,
        queueDepth,
        error: error instanceof Error ? error.message : String(error)
      })
      // try next enabled profile
    }
  }
  return {}
}

async function translateAndPersist(request: ResourceDisplayTranslationRequest): Promise<void> {
  const rootPath = request.rootPath
  const locale = normalizeLocale(request.locale)
  const title = trimText(request.displayNameBase)
  const description = trimText(request.descriptionBase)
  if (!rootPath || !locale) return
  if (isEnglishLocale(locale)) return
  if (!title && !description) return

  const sourceTextHash = buildSourceTextHash(title, description)
  const cache = getResourceDisplayTranslationCacheInfo({
    rootPath,
    type: request.resourceType,
    resourceKey: request.resourceKey,
    locale
  })
  const staleTitleWithoutHash = Boolean(
    !cache.titleSourceTextHash && shouldTreatAsStaleLocalePlaceholder(locale, cache.titleLocale)
  )
  const staleDescriptionWithoutHash = Boolean(
    !cache.descriptionSourceTextHash && shouldTreatAsStaleLocalePlaceholder(locale, cache.descriptionLocale)
  )

  const shouldTranslateTitle = Boolean(
    title && (
      !cache.titleLocale
      || staleTitleWithoutHash
      || (!cache.titleSourceTextHash && isSameText(cache.titleLocale, title))
      || (cache.titleSourceTextHash && isSameText(cache.titleLocale, title))
      || (cache.titleSourceTextHash && cache.titleSourceTextHash !== sourceTextHash)
    )
  )
  const shouldTranslateDescription = Boolean(
    description && (
      !cache.descriptionLocale
      || staleDescriptionWithoutHash
      || (!cache.descriptionSourceTextHash && isSameText(cache.descriptionLocale, description))
      || (cache.descriptionSourceTextHash && isSameText(cache.descriptionLocale, description))
      || (cache.descriptionSourceTextHash && cache.descriptionSourceTextHash !== sourceTextHash)
    )
  )

  if (!shouldTranslateTitle && !shouldTranslateDescription) return

  const translated = await requestTranslation({
    locale,
    resourceKey: request.resourceKey,
    title,
    description
  })

  const translatedTitle = shouldTranslateTitle ? trimText(translated.title) : undefined
  const translatedDescription = shouldTranslateDescription ? trimText(translated.description) : undefined
  const normalizedTranslatedTitle = translatedTitle && title && isSameText(translatedTitle, title)
    ? undefined
    : translatedTitle
  const normalizedTranslatedDescription = translatedDescription && description && isSameText(translatedDescription, description)
    ? undefined
    : translatedDescription
  if (!normalizedTranslatedTitle && !normalizedTranslatedDescription) return

  const allowOverwriteTitleWithoutHash = Boolean(
    title
    && cache.titleLocale
    && !cache.titleSourceTextHash
    && (isSameText(cache.titleLocale, title) || staleTitleWithoutHash)
  )
  const allowOverwriteDescriptionWithoutHash = Boolean(
    description
    && cache.descriptionLocale
    && !cache.descriptionSourceTextHash
    && (isSameText(cache.descriptionLocale, description) || staleDescriptionWithoutHash)
  )

  upsertResourceDisplayTranslation({
    rootPath,
    type: request.resourceType,
    resourceKey: request.resourceKey,
    locale,
    sourceTextHash,
    title: normalizedTranslatedTitle,
    description: normalizedTranslatedDescription,
    allowOverwriteTitleWithoutHash,
    allowOverwriteDescriptionWithoutHash
  })
}

export function queueResourceDisplayTranslation(request: ResourceDisplayTranslationRequest): void {
  const rootPath = trimText(request.rootPath)
  const locale = normalizeLocale(request.locale)
  if (!rootPath || !locale) return

  const displayNameBase = trimText(request.displayNameBase)
  const descriptionBase = trimText(request.descriptionBase)
  if (!displayNameBase && !descriptionBase) return

  const sourceTextHash = buildSourceTextHash(displayNameBase, descriptionBase)
  const dedupeKey = [
    request.resourceType,
    rootPath,
    request.resourceKey,
    locale,
    sourceTextHash
  ].join('|')

  if (inFlightTranslations.has(dedupeKey) || pendingTranslationKeys.has(dedupeKey)) return

  pendingTranslationQueue.push({
    dedupeKey,
    request: {
      ...request,
      rootPath,
      locale,
      ...(displayNameBase ? { displayNameBase } : {}),
      ...(descriptionBase ? { descriptionBase } : {})
    }
  })
  pendingTranslationKeys.add(dedupeKey)
  drainTranslationQueue()
}

function drainTranslationQueue(): void {
  while (activeTranslationWorkers < MAX_TRANSLATION_CONCURRENCY && pendingTranslationQueue.length > 0) {
    const next = pendingTranslationQueue.shift()
    if (!next) return

    pendingTranslationKeys.delete(next.dedupeKey)
    activeTranslationWorkers += 1

    const task = translateAndPersist(next.request)
      .catch((error) => {
        console.warn('[DisplayTranslation] Failed to translate resource display text:', {
          resourceType: next.request.resourceType,
          resourceKey: next.request.resourceKey,
          locale: next.request.locale,
          queueDepth: pendingTranslationQueue.length,
          error: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        inFlightTranslations.delete(next.dedupeKey)
        activeTranslationWorkers = Math.max(0, activeTranslationWorkers - 1)
        drainTranslationQueue()
      })

    inFlightTranslations.set(next.dedupeKey, task)
  }
}

export function _testResetResourceDisplayTranslationState(): void {
  inFlightTranslations.clear()
  pendingTranslationQueue.length = 0
  pendingTranslationKeys.clear()
  activeTranslationWorkers = 0
  preferredTranslationProfileId = null
  selectedTranslationProfileId = null
  profileTranslationHealth.clear()
}
