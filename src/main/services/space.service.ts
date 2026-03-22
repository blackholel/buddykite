/**
 * Space Service - Manages workspaces/spaces
 */

import { shell } from 'electron'
import { homedir } from 'os'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { getKiteDir, getLegacySpacesDir, getTempSpacePath, getSpacesDir } from './config.service'
import { updateSpaceConfig } from './space-config.service'
import { v4 as uuidv4 } from 'uuid'
import { isPathWithinBasePaths } from '../utils/path-validation'

interface Space {
  id: string
  name: string
  icon: string
  path: string
  isTemp: boolean
  createdAt: string
  updatedAt: string
  stats: {
    artifactCount: number
    conversationCount: number
  }
  preferences?: SpacePreferences
}

// Layout preferences for a space
interface SpaceLayoutPreferences {
  artifactRailExpanded?: boolean
  chatWidth?: number
}

// Skills preferences for a space
interface SpaceSkillsPreferences {
  favorites?: string[]
}

// All space preferences
interface SpacePreferences {
  layout?: SpaceLayoutPreferences
  skills?: SpaceSkillsPreferences
}

interface SpaceMeta {
  id: string
  name: string
  icon: string
  createdAt: string
  updatedAt: string
  preferences?: SpacePreferences
}

// Space index for tracking custom path spaces
interface SpaceIndex {
  customPaths: string[]  // Array of paths to spaces outside the default spaces root.
}

const WINDOWS_RESERVED_FOLDER_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

function sanitizeSpacePreferences(
  input: SpacePreferences | Record<string, unknown> | null | undefined
): SpacePreferences | undefined {
  if (!input || typeof input !== 'object') return undefined

  const raw = input as Record<string, unknown>
  const result: SpacePreferences = {}

  if (raw.layout && typeof raw.layout === 'object') {
    const layoutRaw = raw.layout as Record<string, unknown>
    const layout: SpaceLayoutPreferences = {}
    if (typeof layoutRaw.artifactRailExpanded === 'boolean') {
      layout.artifactRailExpanded = layoutRaw.artifactRailExpanded
    }
    if (typeof layoutRaw.chatWidth === 'number' && Number.isFinite(layoutRaw.chatWidth)) {
      layout.chatWidth = layoutRaw.chatWidth
    }
    if (Object.keys(layout).length > 0) {
      result.layout = layout
    }
  }

  if (raw.skills && typeof raw.skills === 'object') {
    const skillsRaw = raw.skills as Record<string, unknown>
    const favorites = normalizeStringArray(skillsRaw.favorites)
    if (favorites.length > 0) {
      result.skills = { favorites }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function parseSpaceMeta(raw: unknown): SpaceMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const metaRaw = raw as Record<string, unknown>
  if (
    typeof metaRaw.id !== 'string' ||
    typeof metaRaw.name !== 'string' ||
    typeof metaRaw.icon !== 'string' ||
    typeof metaRaw.createdAt !== 'string' ||
    typeof metaRaw.updatedAt !== 'string'
  ) {
    return null
  }

  const meta: SpaceMeta = {
    id: metaRaw.id,
    name: metaRaw.name,
    icon: metaRaw.icon,
    createdAt: metaRaw.createdAt,
    updatedAt: metaRaw.updatedAt
  }

  const preferences = sanitizeSpacePreferences(metaRaw.preferences as SpacePreferences | Record<string, unknown> | null | undefined)
  if (preferences) {
    meta.preferences = preferences
  }

  return meta
}

function readSpaceMetaFile(metaPath: string): SpaceMeta | null {
  if (!existsSync(metaPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf-8'))
    return parseSpaceMeta(parsed)
  } catch {
    return null
  }
}

function sanitizeSpaceDirName(name: string): string {
  let normalized = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')

  if (!normalized) {
    normalized = 'untitled-space'
  }

  if (WINDOWS_RESERVED_FOLDER_NAMES.test(normalized)) {
    normalized = `${normalized}-space`
  }

  return normalized
}

function resolveDefaultSpacePath(name: string): string {
  const spacesDir = getSpacesDir()
  const baseName = sanitizeSpaceDirName(name)
  let candidate = join(spacesDir, baseName)
  let sequence = 2

  while (existsSync(candidate)) {
    candidate = join(spacesDir, `${baseName}-${sequence}`)
    sequence += 1
  }

  return candidate
}

function isInDefaultSpacesRoot(spacePath: string): boolean {
  return isPathWithinBasePaths(spacePath, getDefaultSpaceRoots())
}

function getDefaultSpaceRoots(): string[] {
  const roots = [getSpacesDir(), getLegacySpacesDir()]
  return roots.filter((root, index) => roots.indexOf(root) === index)
}

function normalizeComparisonPath(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function canonicalizePath(pathValue: string): string {
  const resolvedPath = resolve(pathValue)
  const missingSegments: string[] = []
  let cursor = resolvedPath

  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) {
      break
    }
    missingSegments.unshift(cursor.slice(parent.length).replace(/^[/\\]/, ''))
    cursor = parent
  }

  let canonicalBase = cursor
  if (existsSync(cursor)) {
    try {
      canonicalBase = realpathSync(cursor)
    } catch {
      canonicalBase = cursor
    }
  }

  let canonical = canonicalBase
  for (const segment of missingSegments) {
    if (!segment) continue
    canonical = join(canonical, segment)
  }

  return normalizeComparisonPath(canonical)
}

function isPathEqual(targetPath: string, otherPath: string): boolean {
  return canonicalizePath(targetPath) === canonicalizePath(otherPath)
}

function isPathInside(targetPath: string, parentPath: string): boolean {
  const rel = relative(canonicalizePath(parentPath), canonicalizePath(targetPath))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function getSpaceMetaPath(spacePath: string): string {
  return join(spacePath, '.kite', 'meta.json')
}

function readSpaceMeta(spacePath: string): SpaceMeta | null {
  const metaPath = getSpaceMetaPath(spacePath)
  return readSpaceMetaFile(metaPath)
}

function isProtectedDeletionTarget(pathValue: string): boolean {
  const protectedPaths = [
    resolve('/'),
    resolve(homedir()),
    resolve(getKiteDir()),
    resolve(dirname(getKiteDir())),
    resolve(getSpacesDir()),
    resolve(getLegacySpacesDir())
  ]

  return protectedPaths.some((protectedPath) => isPathEqual(pathValue, protectedPath))
}

function loadSpacesFromRoots(roots: string[]): Space[] {
  const spaces: Space[] = []
  const loadedPaths = new Set<string>()

  for (const root of roots) {
    if (!existsSync(root)) {
      continue
    }

    const dirs = readdirSync(root)
    for (const dir of dirs) {
      const spacePath = join(root, dir)

      try {
        if (!statSync(spacePath).isDirectory()) {
          continue
        }
      } catch {
        continue
      }

      if (loadedPaths.has(spacePath)) {
        continue
      }

      const space = loadSpaceFromPath(spacePath)
      if (space) {
        spaces.push(space)
        loadedPaths.add(spacePath)
      }
    }
  }

  return spaces
}

function getSpaceIndexPath(): string {
  return join(getKiteDir(), 'spaces-index.json')
}

function loadSpaceIndex(): SpaceIndex {
  const indexPath = getSpaceIndexPath()
  if (existsSync(indexPath)) {
    try {
      return JSON.parse(readFileSync(indexPath, 'utf-8'))
    } catch {
      return { customPaths: [] }
    }
  }
  return { customPaths: [] }
}

function saveSpaceIndex(index: SpaceIndex): void {
  const indexPath = getSpaceIndexPath()
  writeFileSync(indexPath, JSON.stringify(index, null, 2))
}

function addToSpaceIndex(path: string): void {
  const index = loadSpaceIndex()
  if (!index.customPaths.includes(path)) {
    index.customPaths.push(path)
    saveSpaceIndex(index)
  }
}

function removeFromSpaceIndex(path: string): void {
  const index = loadSpaceIndex()
  index.customPaths = index.customPaths.filter(p => p !== path)
  saveSpaceIndex(index)
}

const KITE_SPACE: Space = {
  id: 'kite-temp',
  name: 'Kite',
  icon: 'sparkles',  // Maps to Lucide Sparkles icon
  path: '',
  isTemp: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  stats: {
    artifactCount: 0,
    conversationCount: 0
  }
}

// Get all valid space paths (for security checks)
export function getAllSpacePaths(): string[] {
  const paths: string[] = []
  const loadedPaths = new Set<string>()

  // Add temp space path
  const tempSpacePath = getTempSpacePath()
  paths.push(tempSpacePath)
  loadedPaths.add(tempSpacePath)

  // Add valid spaces from default roots (including legacy root for backward compatibility)
  const defaultSpaces = loadSpacesFromRoots(getDefaultSpaceRoots())
  for (const space of defaultSpaces) {
    if (!loadedPaths.has(space.path)) {
      paths.push(space.path)
      loadedPaths.add(space.path)
    }
  }

  // Add valid custom path spaces from index
  const index = loadSpaceIndex()
  for (const customPath of index.customPaths) {
    if (!existsSync(customPath) || loadedPaths.has(customPath)) {
      continue
    }

    const space = loadSpaceFromPath(customPath)
    if (space) {
      paths.push(customPath)
      loadedPaths.add(customPath)
    }
  }

  return paths
}

// Get space stats
function getSpaceStats(spacePath: string): { artifactCount: number; conversationCount: number } {
  const artifactsDir = join(spacePath, 'artifacts')
  const conversationsDir = join(spacePath, '.kite', 'conversations')

  let artifactCount = 0
  let conversationCount = 0

  // Count artifacts (all files in artifacts folder)
  if (existsSync(artifactsDir)) {
    const countFiles = (dir: string): number => {
      let count = 0
      const items = readdirSync(dir)
      for (const item of items) {
        const itemPath = join(dir, item)
        const stat = statSync(itemPath)
        if (stat.isFile() && !item.startsWith('.')) {
          count++
        } else if (stat.isDirectory()) {
          count += countFiles(itemPath)
        }
      }
      return count
    }
    artifactCount = countFiles(artifactsDir)
  }

  // For temp space, artifacts are directly in the folder
  if (spacePath === getTempSpacePath()) {
    const tempArtifactsDir = join(spacePath, 'artifacts')
    if (existsSync(tempArtifactsDir)) {
      artifactCount = readdirSync(tempArtifactsDir).filter(f => !f.startsWith('.')).length
    }
  }

  // Count conversations
  if (existsSync(conversationsDir)) {
    conversationCount = readdirSync(conversationsDir).filter(f => f.endsWith('.json')).length
  } else {
    // For temp space
    const tempConvDir = join(spacePath, 'conversations')
    if (existsSync(tempConvDir)) {
      conversationCount = readdirSync(tempConvDir).filter(f => f.endsWith('.json')).length
    }
  }

  return { artifactCount, conversationCount }
}

// Get Kite temp space
export function getKiteSpace(): Space {
  const tempPath = getTempSpacePath()
  const stats = getSpaceStats(tempPath)

  // Load preferences if they exist
  const metaPath = join(tempPath, '.kite', 'meta.json')
  let preferences: SpacePreferences | undefined

  if (existsSync(metaPath)) {
    const meta = readSpaceMetaFile(metaPath)
    preferences = meta?.preferences
  }

  return {
    ...KITE_SPACE,
    path: tempPath,
    stats,
    preferences
  }
}

// Helper to load a space from a path
function loadSpaceFromPath(spacePath: string): Space | null {
  // Deliberate policy: only .kite metadata is recognized.
  // Legacy .halo/meta.json is intentionally ignored (no compatibility fallback).
  const metaPath = join(spacePath, '.kite', 'meta.json')

  if (existsSync(metaPath)) {
    try {
      const meta = readSpaceMetaFile(metaPath)
      if (!meta) {
        return null
      }
      const stats = getSpaceStats(spacePath)

      return {
        id: meta.id,
        name: meta.name,
        icon: meta.icon,
        path: spacePath,
        isTemp: false,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        stats,
        preferences: meta.preferences
      }
    } catch (error) {
      console.error(`Failed to read space meta for ${spacePath}:`, error)
    }
  }
  return null
}

// List all spaces (including custom path spaces)
export function listSpaces(): Space[] {
  const spaces = loadSpacesFromRoots(getDefaultSpaceRoots())
  const loadedPaths = new Set<string>()
  spaces.forEach(space => loadedPaths.add(space.path))

  // Load spaces from custom paths (indexed)
  const index = loadSpaceIndex()
  for (const customPath of index.customPaths) {
    if (!loadedPaths.has(customPath) && existsSync(customPath)) {
      const space = loadSpaceFromPath(customPath)
      if (space) {
        spaces.push(space)
        loadedPaths.add(customPath)
      }
    }
  }

  // Sort by updatedAt (most recent first)
  spaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return spaces
}

// Create a new space
export function createSpace(input: { name: string; icon: string; customPath?: string }): Space {
  const id = uuidv4()
  const now = new Date().toISOString()
  const isCustomPath = !!input.customPath

  // Determine space path
  let spacePath: string
  if (input.customPath) {
    spacePath = input.customPath
  } else {
    spacePath = resolveDefaultSpacePath(input.name)
  }

  // Create directories
  mkdirSync(spacePath, { recursive: true })
  mkdirSync(join(spacePath, '.kite'), { recursive: true })
  mkdirSync(join(spacePath, '.kite', 'conversations'), { recursive: true })

  // Create meta file
  const meta: SpaceMeta = {
    id,
    name: input.name,
    icon: input.icon,
    createdAt: now,
    updatedAt: now
  }

  writeFileSync(join(spacePath, '.kite', 'meta.json'), JSON.stringify(meta, null, 2))

  // Initialize resource policy defaults for global resource availability.
  // Uses updateSpaceConfig to merge safely — preserves existing claudeCode config
  // when customPath points to a directory that already has space-config.json.
  const initResult = updateSpaceConfig(spacePath, (config) => ({
    ...config,
    resourcePolicy: {
      version: 1,
      mode: 'legacy',
      allowMcp: true,
      allowPluginMcpDirective: true,
      allowedSources: ['app', 'global', 'space', 'installed', 'plugin']
    }
  }))

  if (!initResult) {
    console.error(`[Space] Failed to initialize resource policy for space: ${spacePath}`)
  }

  // Register custom path in index
  if (isCustomPath) {
    addToSpaceIndex(spacePath)
  }

  return {
    id,
    name: input.name,
    icon: input.icon,
    path: spacePath,
    isTemp: false,
    createdAt: now,
    updatedAt: now,
    stats: {
      artifactCount: 0,
      conversationCount: 0
    }
  }
}

// Delete a space
export function deleteSpace(spaceId: string): boolean {
  // Find the space first
  const space = getSpace(spaceId)
  if (!space || space.isTemp) {
    return false
  }

  const spacePath = space.path
  const isCustomPath = !isInDefaultSpacesRoot(spacePath)

  try {
    if (!existsSync(spacePath)) {
      console.warn(`[Space] Refusing delete for missing path: ${spacePath}`)
      return false
    }

    if (isProtectedDeletionTarget(spacePath)) {
      console.error(`[Space] Refusing delete for protected path: ${spacePath}`)
      return false
    }

    const spacePathStat = lstatSync(spacePath)
    if (spacePathStat.isSymbolicLink()) {
      console.error(`[Space] Refusing delete for symlink space path: ${spacePath}`)
      return false
    }

    const meta = readSpaceMeta(spacePath)
    if (!meta || meta.id !== space.id) {
      console.error(`[Space] Refusing delete due to missing or mismatched meta id: ${spacePath}`)
      return false
    }

    if (isCustomPath) {
      // For custom path spaces, only delete the .kite folder (preserve user's files)
      const kiteDir = join(spacePath, '.kite')
      if (!existsSync(kiteDir)) {
        console.error(`[Space] Refusing custom space delete without .kite directory: ${spacePath}`)
        return false
      }

      if (isProtectedDeletionTarget(kiteDir)) {
        console.error(`[Space] Refusing delete for protected .kite path: ${kiteDir}`)
        return false
      }

      const kiteDirStat = lstatSync(kiteDir)
      if (kiteDirStat.isSymbolicLink()) {
        console.error(`[Space] Refusing delete for symlink .kite directory: ${kiteDir}`)
        return false
      }

      if (!isPathInside(kiteDir, spacePath)) {
        console.error(`[Space] Refusing delete because .kite is outside space boundary: ${kiteDir}`)
        return false
      }

      rmSync(kiteDir, { recursive: true, force: true })
      // Remove from index
      removeFromSpaceIndex(spacePath)
    } else {
      // For default path spaces, delete the entire folder
      rmSync(spacePath, { recursive: true, force: true })
    }
    return true
  } catch (error) {
    console.error(`Failed to delete space ${spaceId}:`, error)
    return false
  }
}

// Get a specific space by ID
export function getSpace(spaceId: string): Space | null {
  if (spaceId === 'kite-temp') {
    return getKiteSpace()
  }

  const spaces = listSpaces()
  return spaces.find(s => s.id === spaceId) || null
}

// Open space folder in file explorer
export function openSpaceFolder(spaceId: string): boolean {
  const space = getSpace(spaceId)

  if (space) {
    // For temp space, open artifacts folder
    if (space.isTemp) {
      const artifactsPath = join(space.path, 'artifacts')
      if (existsSync(artifactsPath)) {
        shell.openPath(artifactsPath)
        return true
      }
    } else {
      shell.openPath(space.path)
      return true
    }
  }

  return false
}

// Update space metadata
export function updateSpace(spaceId: string, updates: { name?: string; icon?: string }): Space | null {
  const space = getSpace(spaceId)

  if (!space || space.isTemp) {
    return null
  }

  const metaPath = join(space.path, '.kite', 'meta.json')

  try {
    const existingMeta = readSpaceMetaFile(metaPath) ?? {
      id: space.id,
      name: space.name,
      icon: space.icon,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
      ...(space.preferences ? { preferences: space.preferences } : {})
    }

    const nextMeta: SpaceMeta = {
      id: existingMeta.id,
      name: updates.name ?? existingMeta.name,
      icon: updates.icon ?? existingMeta.icon,
      createdAt: existingMeta.createdAt,
      updatedAt: new Date().toISOString(),
      ...(existingMeta.preferences ? { preferences: existingMeta.preferences } : {})
    }

    writeFileSync(metaPath, JSON.stringify(nextMeta, null, 2))

    return getSpace(spaceId)
  } catch (error) {
    console.error('Failed to update space:', error)
    return null
  }
}

// Update space preferences (layout settings, etc.)
export function updateSpacePreferences(
  spaceId: string,
  preferences: Partial<SpacePreferences>
): Space | null {
  const space = getSpace(spaceId)

  if (!space) {
    return null
  }

  const metaPath = join(space.path, '.kite', 'meta.json')

  try {
    // Ensure .kite directory exists for temp space
    const kiteDir = join(space.path, '.kite')
    if (!existsSync(kiteDir)) {
      mkdirSync(kiteDir, { recursive: true })
    }

    const existingMeta = readSpaceMetaFile(metaPath) ?? {
      id: space.id,
      name: space.name,
      icon: space.icon,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
      ...(space.preferences ? { preferences: space.preferences } : {})
    }

    const mergedPreferenceInput: Record<string, unknown> = {}
    const currentPreferences = existingMeta.preferences
    if (currentPreferences?.layout || preferences.layout) {
      mergedPreferenceInput.layout = {
        ...(currentPreferences?.layout ?? {}),
        ...(preferences.layout ?? {})
      }
    }
    if (currentPreferences?.skills || preferences.skills) {
      mergedPreferenceInput.skills = {
        ...(currentPreferences?.skills ?? {}),
        ...(preferences.skills ?? {})
      }
    }

    const nextPreferences = sanitizeSpacePreferences(mergedPreferenceInput)
    const nextMeta: SpaceMeta = {
      id: existingMeta.id,
      name: existingMeta.name,
      icon: existingMeta.icon,
      createdAt: existingMeta.createdAt,
      updatedAt: new Date().toISOString(),
      ...(nextPreferences ? { preferences: nextPreferences } : {})
    }

    writeFileSync(metaPath, JSON.stringify(nextMeta, null, 2))

    console.log(`[Space] Updated preferences for ${spaceId}:`, preferences)

    return getSpace(spaceId)
  } catch (error) {
    console.error('Failed to update space preferences:', error)
    return null
  }
}

// Get space preferences only (lightweight, without full space load)
export function getSpacePreferences(spaceId: string): SpacePreferences | null {
  const space = getSpace(spaceId)

  if (!space) {
    return null
  }

  const metaPath = join(space.path, '.kite', 'meta.json')

  try {
    const meta = readSpaceMetaFile(metaPath)
    if (meta) return meta.preferences || null
    return null
  } catch (error) {
    console.error('Failed to get space preferences:', error)
    return null
  }
}

// Write onboarding artifact - saves a file to the space's artifacts folder
export function writeOnboardingArtifact(spaceId: string, fileName: string, content: string): boolean {
  const space = getSpace(spaceId)
  if (!space) {
    console.error(`[Space] writeOnboardingArtifact: Space not found: ${spaceId}`)
    return false
  }

  try {
    // Determine artifacts directory based on space type
    const artifactsDir = space.isTemp
      ? join(space.path, 'artifacts')
      : space.path  // For regular spaces, save to root

    // Ensure artifacts directory exists
    mkdirSync(artifactsDir, { recursive: true })

    // Write the file
    const filePath = join(artifactsDir, fileName)
    writeFileSync(filePath, content, 'utf-8')

    console.log(`[Space] writeOnboardingArtifact: Saved ${fileName} to ${filePath}`)
    return true
  } catch (error) {
    console.error(`[Space] writeOnboardingArtifact failed:`, error)
    return false
  }
}

// Save onboarding conversation - creates a conversation with the mock messages
export function saveOnboardingConversation(
  spaceId: string,
  userMessage: string,
  aiResponse: string
): string | null {
  const space = getSpace(spaceId)
  if (!space) {
    console.error(`[Space] saveOnboardingConversation: Space not found: ${spaceId}`)
    return null
  }

  try {
    const { v4: uuidv4 } = require('uuid')
    const conversationId = uuidv4()
    const now = new Date().toISOString()

    // Determine conversations directory
    const conversationsDir = space.isTemp
      ? join(space.path, 'conversations')
      : join(space.path, '.kite', 'conversations')

    // Ensure directory exists
    mkdirSync(conversationsDir, { recursive: true })

    // Create conversation data
    const conversation = {
      id: conversationId,
      title: 'Welcome to Kite',
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: uuidv4(),
          role: 'user',
          content: userMessage,
          timestamp: now
        },
        {
          id: uuidv4(),
          role: 'assistant',
          content: aiResponse,
          timestamp: now
        }
      ]
    }

    // Write conversation file
    const filePath = join(conversationsDir, `${conversationId}.json`)
    writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8')

    console.log(`[Space] saveOnboardingConversation: Saved to ${filePath}`)
    return conversationId
  } catch (error) {
    console.error(`[Space] saveOnboardingConversation failed:`, error)
    return null
  }
}
