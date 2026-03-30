import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfigDir } from '../utils/instance'

export interface ResourceLibraryStateEntry {
  enabled: boolean
  updatedAt: string
}

export interface ResourceLibraryState {
  schemaVersion: 1
  resources: Record<string, ResourceLibraryStateEntry>
}

const RESOURCE_LIBRARY_STATE_FILE = 'resource-library-state.json'

function createDefaultState(): ResourceLibraryState {
  return {
    schemaVersion: 1,
    resources: {}
  }
}

function normalizeState(raw: unknown): ResourceLibraryState {
  if (!raw || typeof raw !== 'object') {
    return createDefaultState()
  }

  const parsed = raw as Record<string, unknown>
  const resourcesRecord = parsed.resources
  const resources: Record<string, ResourceLibraryStateEntry> = {}

  if (resourcesRecord && typeof resourcesRecord === 'object' && !Array.isArray(resourcesRecord)) {
    for (const [key, value] of Object.entries(resourcesRecord)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as Record<string, unknown>
      if (typeof entry.enabled !== 'boolean') continue
      const updatedAt = typeof entry.updatedAt === 'string' && entry.updatedAt.trim().length > 0
        ? entry.updatedAt
        : new Date().toISOString()
      resources[key] = {
        enabled: entry.enabled,
        updatedAt
      }
    }
  }

  return {
    schemaVersion: 1,
    resources
  }
}

export function getResourceLibraryStatePath(configDir: string = getConfigDir()): string {
  return join(configDir, RESOURCE_LIBRARY_STATE_FILE)
}

export function readResourceLibraryState(configDir: string = getConfigDir()): ResourceLibraryState {
  const statePath = getResourceLibraryStatePath(configDir)
  if (!existsSync(statePath)) {
    return createDefaultState()
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as unknown
    return normalizeState(parsed)
  } catch (error) {
    console.warn('[ResourceLibraryState] Failed to parse state file:', error)
    return createDefaultState()
  }
}

export function writeResourceLibraryState(
  nextState: ResourceLibraryState,
  configDir: string = getConfigDir()
): ResourceLibraryState {
  const normalizedState = normalizeState(nextState)
  const statePath = getResourceLibraryStatePath(configDir)
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  writeFileSync(statePath, JSON.stringify(normalizedState, null, 2), 'utf-8')
  return normalizedState
}

export function buildResourceLibraryStateKey(
  type: 'skill' | 'agent',
  source: string,
  name: string,
  namespace?: string
): string {
  if (namespace && namespace.trim().length > 0) {
    return `${type}:${source}:${namespace}:${name}`
  }
  return `${type}:${source}:${name}`
}

export function getResourceEnabledState(
  key: string,
  configDir: string = getConfigDir()
): boolean {
  const state = readResourceLibraryState(configDir)
  const entry = state.resources[key]
  if (!entry) return true
  return entry.enabled !== false
}

export function setResourceEnabledState(
  key: string,
  enabled: boolean,
  configDir: string = getConfigDir()
): ResourceLibraryState {
  const current = readResourceLibraryState(configDir)
  current.resources[key] = {
    enabled,
    updatedAt: new Date().toISOString()
  }
  return writeResourceLibraryState(current, configDir)
}

export function deleteResourceState(key: string, configDir: string = getConfigDir()): ResourceLibraryState {
  const current = readResourceLibraryState(configDir)
  if (!current.resources[key]) {
    return current
  }
  delete current.resources[key]
  return writeResourceLibraryState(current, configDir)
}

export function pruneMissingResourceState(
  validKeys: Iterable<string>,
  configDir: string = getConfigDir()
): ResourceLibraryState {
  const current = readResourceLibraryState(configDir)
  const valid = new Set(validKeys)
  let changed = false
  for (const key of Object.keys(current.resources)) {
    if (valid.has(key)) continue
    delete current.resources[key]
    changed = true
  }
  if (!changed) return current
  return writeResourceLibraryState(current, configDir)
}
