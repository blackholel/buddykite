import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { getConfig } from './config.service'
import { getLockedConfigSourceMode, getLockedUserConfigRootDir } from './config-source-mode.service'
import { listEnabledPlugins } from './plugins.service'
import { getAllSpacePaths } from './space.service'
import type { ResourceType } from '../../shared/resource-access'

export const RESOURCE_DISPLAY_I18N_FILE_NAME = 'resource-display.i18n.json'

interface LocaleTextMap {
  [locale: string]: string
}

interface ResourceDisplayEntry {
  title?: LocaleTextMap
  description?: LocaleTextMap
  auto?: ResourceDisplayAutoMeta
}

interface ResourceDisplayFieldMeta {
  sourceTextHash?: string
  updatedAt?: string
}

interface ResourceDisplayAutoMeta {
  title?: Record<string, ResourceDisplayFieldMeta>
  description?: Record<string, ResourceDisplayFieldMeta>
}

interface ResourceDisplayResources {
  skills?: Record<string, ResourceDisplayEntry>
  agents?: Record<string, ResourceDisplayEntry>
  commands?: Record<string, ResourceDisplayEntry>
}

interface ResourceDisplaySidecar {
  version?: number
  defaultLocale?: string
  resources?: ResourceDisplayResources
}

interface CachedSidecar {
  signature: string
  data: ResourceDisplaySidecar | null
}

export interface ResourceDisplayOverride {
  titleLocale?: string
  titleDefault?: string
  descriptionLocale?: string
  descriptionDefault?: string
}

export interface ResourceDisplayTranslationCacheInfo {
  titleLocale?: string
  descriptionLocale?: string
  titleSourceTextHash?: string
  descriptionSourceTextHash?: string
}

export interface UpsertResourceDisplayTranslationInput {
  rootPath: string
  type: ResourceType
  resourceKey: string
  locale: string
  sourceTextHash: string
  title?: string
  description?: string
  allowOverwriteTitleWithoutHash?: boolean
  allowOverwriteDescriptionWithoutHash?: boolean
}

export interface ResourceDisplayI18nRoot {
  rootPath: string
  workDir?: string
}

const sidecarCache = new Map<string, CachedSidecar>()

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveGlobalPath(path: string): string {
  return path.startsWith('/') ? path : join(homedir(), path)
}

function normalizeLocaleCandidates(locale?: string): string[] {
  if (!locale) return []
  const normalized = locale.trim()
  if (!normalized) return []

  const candidates = new Set<string>([
    normalized,
    normalized.toLowerCase(),
    normalized.replace(/-/g, '_'),
    normalized.toLowerCase().replace(/-/g, '_'),
    normalized.replace(/_/g, '-'),
    normalized.toLowerCase().replace(/_/g, '-')
  ])

  const separatorIndex = normalized.search(/[-_]/)
  if (separatorIndex > 0) {
    const language = normalized.slice(0, separatorIndex)
    if (language) {
      candidates.add(language)
      candidates.add(language.toLowerCase())
    }
  }

  return Array.from(candidates).filter(Boolean)
}

function getSidecarPath(rootPath: string): string {
  return join(rootPath, 'i18n', RESOURCE_DISPLAY_I18N_FILE_NAME)
}

function getFileSignature(filePath: string): string {
  try {
    const stats = statSync(filePath)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return 'missing'
  }
}

function normalizeLocaleMap(input: unknown): LocaleTextMap | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const output: LocaleTextMap = {}

  for (const [key, value] of Object.entries(input)) {
    const locale = trimString(key)
    const text = trimString(value)
    if (!locale || !text) continue
    output[locale] = text
  }

  return Object.keys(output).length > 0 ? output : undefined
}

function normalizeFieldMeta(input: unknown): ResourceDisplayFieldMeta | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const sourceTextHash = trimString(record.sourceTextHash)
  const updatedAt = trimString(record.updatedAt)
  if (!sourceTextHash && !updatedAt) return undefined
  return {
    ...(sourceTextHash ? { sourceTextHash } : {}),
    ...(updatedAt ? { updatedAt } : {})
  }
}

function normalizeFieldMetaMap(input: unknown): Record<string, ResourceDisplayFieldMeta> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const output: Record<string, ResourceDisplayFieldMeta> = {}
  for (const [key, value] of Object.entries(input)) {
    const locale = trimString(key)
    const meta = normalizeFieldMeta(value)
    if (!locale || !meta) continue
    output[locale] = meta
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function normalizeAutoMeta(input: unknown): ResourceDisplayAutoMeta | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const title = normalizeFieldMetaMap(record.title)
  const description = normalizeFieldMetaMap(record.description)
  if (!title && !description) return undefined
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {})
  }
}

function normalizeEntry(input: unknown): ResourceDisplayEntry | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const title = normalizeLocaleMap(record.title)
  const description = normalizeLocaleMap(record.description)
  const auto = normalizeAutoMeta(record.auto)
  if (!title && !description && !auto) return undefined
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(auto ? { auto } : {})
  }
}

function normalizeResourceMap(input: unknown): Record<string, ResourceDisplayEntry> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const output: Record<string, ResourceDisplayEntry> = {}
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = trimString(key)
    const entry = normalizeEntry(value)
    if (!normalizedKey || !entry) continue
    output[normalizedKey] = entry
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function normalizeSidecar(input: unknown): ResourceDisplaySidecar | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const resourcesInput = record.resources

  let resources: ResourceDisplayResources | undefined
  if (resourcesInput && typeof resourcesInput === 'object' && !Array.isArray(resourcesInput)) {
    const resourcesRecord = resourcesInput as Record<string, unknown>
    const skills = normalizeResourceMap(resourcesRecord.skills)
    const agents = normalizeResourceMap(resourcesRecord.agents)
    const commands = normalizeResourceMap(resourcesRecord.commands)
    if (skills || agents || commands) {
      resources = {
        ...(skills ? { skills } : {}),
        ...(agents ? { agents } : {}),
        ...(commands ? { commands } : {})
      }
    }
  }

  const defaultLocale = trimString(record.defaultLocale)
  const version = typeof record.version === 'number' ? record.version : undefined

  return {
    ...(typeof version === 'number' ? { version } : {}),
    ...(defaultLocale ? { defaultLocale } : {}),
    ...(resources ? { resources } : {})
  }
}

function readSidecar(rootPath: string): ResourceDisplaySidecar | null {
  const sidecarPath = getSidecarPath(rootPath)
  const signature = getFileSignature(sidecarPath)
  const cached = sidecarCache.get(sidecarPath)

  if (cached && cached.signature === signature) {
    return cached.data
  }

  if (!existsSync(sidecarPath)) {
    sidecarCache.set(sidecarPath, { signature, data: null })
    return null
  }

  try {
    const raw = readFileSync(sidecarPath, 'utf-8')
    const parsed = normalizeSidecar(JSON.parse(raw))
    sidecarCache.set(sidecarPath, { signature, data: parsed })
    return parsed
  } catch (error) {
    console.warn(`[DisplayI18n] Failed to parse sidecar ${sidecarPath}:`, error)
    sidecarCache.set(sidecarPath, { signature, data: null })
    return null
  }
}

function getResourceMap(
  sidecar: ResourceDisplaySidecar,
  type: ResourceType
): Record<string, ResourceDisplayEntry> | undefined {
  if (!sidecar.resources) return undefined
  if (type === 'skill') return sidecar.resources.skills
  if (type === 'agent') return sidecar.resources.agents
  return sidecar.resources.commands
}

function pickLocalized(map: LocaleTextMap | undefined, locale?: string): string | undefined {
  if (!map) return undefined
  const candidates = normalizeLocaleCandidates(locale)
  for (const candidate of candidates) {
    const value = trimString(map[candidate])
    if (value) return value
  }
  return undefined
}

function pickDefault(map: LocaleTextMap | undefined, defaultLocale?: string): string | undefined {
  if (!map) return undefined
  const locale = trimString(defaultLocale)
  if (!locale) return undefined
  return pickLocalized(map, locale)
}

function pickFieldSourceTextHash(
  map: Record<string, ResourceDisplayFieldMeta> | undefined,
  locale?: string
): string | undefined {
  if (!map) return undefined
  const candidates = normalizeLocaleCandidates(locale)
  for (const candidate of candidates) {
    const value = trimString(map[candidate]?.sourceTextHash)
    if (value) return value
  }
  return undefined
}

function toIdentity(rootPath: string, workDir?: string): string {
  return `${rootPath}::${workDir || '__global__'}`
}

function collectGlobalRoots(): string[] {
  const roots = new Set<string>()
  roots.add(getLockedUserConfigRootDir())

  if (getLockedConfigSourceMode() === 'kite') {
    const config = getConfig()
    const skillGlobalPaths = config.claudeCode?.plugins?.globalPaths || []
    const agentGlobalPaths = config.claudeCode?.agents?.paths || []

    for (const globalPath of [...skillGlobalPaths, ...agentGlobalPaths]) {
      roots.add(resolveGlobalPath(globalPath))
    }
  }

  for (const plugin of listEnabledPlugins()) {
    roots.add(plugin.installPath)
  }

  return Array.from(roots)
}

export function getResourceDisplayI18nRoots(): ResourceDisplayI18nRoot[] {
  const roots: ResourceDisplayI18nRoot[] = []
  const seen = new Set<string>()

  for (const rootPath of collectGlobalRoots()) {
    const identity = toIdentity(rootPath)
    if (seen.has(identity)) continue
    seen.add(identity)
    roots.push({ rootPath })
  }

  for (const workDir of getAllSpacePaths()) {
    const spaceRootPath = join(workDir, '.claude')
    const identity = toIdentity(spaceRootPath, workDir)
    if (seen.has(identity)) continue
    seen.add(identity)
    roots.push({ rootPath: spaceRootPath, workDir })
  }

  return roots
}

export function getResourceDisplayI18nSidecarPaths(workDir?: string): string[] {
  const roots = getResourceDisplayI18nRoots().filter((entry) => {
    if (!workDir) return !entry.workDir
    return !entry.workDir || entry.workDir === workDir
  })

  const paths = new Set<string>()
  for (const entry of roots) {
    paths.add(getSidecarPath(entry.rootPath))
  }
  return Array.from(paths)
}

export function getResourceDisplayI18nIndexEntries(workDir?: string): string[] {
  return getResourceDisplayI18nSidecarPaths(workDir).map((sidecarPath) => {
    return `display-i18n:${sidecarPath}:${getFileSignature(sidecarPath)}`
  })
}

export function resolveResourceDisplayOverride(
  rootPath: string | undefined,
  type: ResourceType,
  resourceKey: string,
  locale?: string
): ResourceDisplayOverride {
  if (!rootPath) return {}

  const sidecar = readSidecar(rootPath)
  if (!sidecar) return {}

  const entries = getResourceMap(sidecar, type)
  const entry = entries?.[resourceKey]
  if (!entry) return {}

  return {
    titleLocale: pickLocalized(entry.title, locale),
    titleDefault: pickDefault(entry.title, sidecar.defaultLocale),
    descriptionLocale: pickLocalized(entry.description, locale),
    descriptionDefault: pickDefault(entry.description, sidecar.defaultLocale)
  }
}

export function getResourceDisplayTranslationCacheInfo(params: {
  rootPath: string | undefined
  type: ResourceType
  resourceKey: string
  locale?: string
}): ResourceDisplayTranslationCacheInfo {
  if (!params.rootPath) return {}
  const sidecar = readSidecar(params.rootPath)
  if (!sidecar) return {}
  const entry = getResourceMap(sidecar, params.type)?.[params.resourceKey]
  if (!entry) return {}
  return {
    titleLocale: pickLocalized(entry.title, params.locale),
    descriptionLocale: pickLocalized(entry.description, params.locale),
    titleSourceTextHash: pickFieldSourceTextHash(entry.auto?.title, params.locale),
    descriptionSourceTextHash: pickFieldSourceTextHash(entry.auto?.description, params.locale)
  }
}

function readWritableSidecar(sidecarPath: string): Record<string, unknown> {
  if (!existsSync(sidecarPath)) {
    return {
      version: 1,
      defaultLocale: 'en',
      resources: {}
    }
  }

  try {
    const raw = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        version: 1,
        defaultLocale: 'en',
        resources: {}
      }
    }
    return raw as Record<string, unknown>
  } catch {
    return {
      version: 1,
      defaultLocale: 'en',
      resources: {}
    }
  }
}

function ensureRecord(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = target[key]
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, unknown>
  }
  const next: Record<string, unknown> = {}
  target[key] = next
  return next
}

function shouldWriteField(
  existingValue: string | undefined,
  existingSourceTextHash: string | undefined,
  nextSourceTextHash: string,
  allowOverwriteWithoutHash = false
): boolean {
  if (!existingValue) return true
  if (!existingSourceTextHash) return allowOverwriteWithoutHash
  return existingSourceTextHash !== nextSourceTextHash
}

export function upsertResourceDisplayTranslation(input: UpsertResourceDisplayTranslationInput): boolean {
  const locale = trimString(input.locale)
  const sourceTextHash = trimString(input.sourceTextHash)
  const title = trimString(input.title)
  const description = trimString(input.description)
  const allowOverwriteTitleWithoutHash = input.allowOverwriteTitleWithoutHash === true
  const allowOverwriteDescriptionWithoutHash = input.allowOverwriteDescriptionWithoutHash === true
  if (!locale || !sourceTextHash) return false
  if (!title && !description) return false

  const sidecarPath = getSidecarPath(input.rootPath)
  const sidecar = readWritableSidecar(sidecarPath)
  if (typeof sidecar.version !== 'number') {
    sidecar.version = 1
  }
  if (!trimString(sidecar.defaultLocale)) {
    sidecar.defaultLocale = 'en'
  }

  const resources = ensureRecord(sidecar, 'resources')
  const mapKey = input.type === 'skill' ? 'skills' : input.type === 'agent' ? 'agents' : 'commands'
  const resourceMap = ensureRecord(resources, mapKey)
  const entry = ensureRecord(resourceMap, input.resourceKey)
  const titleMap = ensureRecord(entry, 'title')
  const descriptionMap = ensureRecord(entry, 'description')
  const auto = ensureRecord(entry, 'auto')
  const autoTitleMap = ensureRecord(auto, 'title')
  const autoDescriptionMap = ensureRecord(auto, 'description')

  const existingTitle = trimString(titleMap[locale])
  const existingDescription = trimString(descriptionMap[locale])
  const existingTitleHash = trimString((autoTitleMap[locale] as Record<string, unknown> | undefined)?.sourceTextHash)
  const existingDescriptionHash = trimString((autoDescriptionMap[locale] as Record<string, unknown> | undefined)?.sourceTextHash)

  let wrote = false
  const now = new Date().toISOString()

  if (title && shouldWriteField(existingTitle, existingTitleHash, sourceTextHash, allowOverwriteTitleWithoutHash)) {
    titleMap[locale] = title
    autoTitleMap[locale] = { sourceTextHash, updatedAt: now }
    wrote = true
  }

  if (description && shouldWriteField(
    existingDescription,
    existingDescriptionHash,
    sourceTextHash,
    allowOverwriteDescriptionWithoutHash
  )) {
    descriptionMap[locale] = description
    autoDescriptionMap[locale] = { sourceTextHash, updatedAt: now }
    wrote = true
  }

  if (!wrote) return false

  mkdirSync(dirname(sidecarPath), { recursive: true })
  writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8')
  sidecarCache.delete(sidecarPath)
  return true
}

export function clearResourceDisplayI18nCache(rootPaths?: string[]): void {
  if (!rootPaths || rootPaths.length === 0) {
    sidecarCache.clear()
    return
  }

  for (const rootPath of rootPaths) {
    sidecarCache.delete(getSidecarPath(rootPath))
  }
}
