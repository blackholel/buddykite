/**
 * Config Service - Manages application configuration
 */

import { app } from 'electron'
import { basename, dirname, isAbsolute, join, posix as pathPosix, relative, resolve, sep, win32 as pathWin32 } from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { getConfigDir } from '../utils/instance'
import { getKiteAgentsDir, getKiteSkillsDir, getKiteSpacesDir } from './kite-library.service'

// Import analytics config type
import type { AnalyticsConfig } from './analytics/types'
import {
  createAiConfigFromLegacyApi,
  ensureAiConfig,
  ensureLegacyApiConfig,
  getPresetRecommendedModels,
  inferProfilePresetKey,
  mirrorAiToLegacyApi,
  mirrorLegacyApiToAi,
  type ApiValidationResult,
  type AiConfig,
  type LegacyApiConfig,
  type ProviderProtocol
} from '../../shared/types/ai-profile'
import type {
  ObservabilityConfig,
  LangfuseMaskMode
} from '../../shared/types/observability'

// ============================================================================
// Config Change Notification (Callback Pattern)
// ============================================================================
// When API/AI config changes, subscribers are notified.
// This allows agent.service to invalidate sessions without circular dependency.
// agent.service imports onApiConfigChange (agent → config, existing direction)
// config.service calls registered callbacks (no import from agent)
// ============================================================================

type ApiConfigChangeHandler = () => void
type AiConfigChangeHandler = () => void
const apiConfigChangeHandlers: ApiConfigChangeHandler[] = []
const aiConfigChangeHandlers: AiConfigChangeHandler[] = []
const CONFIG_SOURCE_MODE_VALUES = ['kite', 'claude'] as const
const APPEARANCE_THEME_VALUES = ['light', 'dark'] as const
const CHAT_LAYOUT_MODE_VALUES = ['auto', 'manual'] as const
const LANGFUSE_MASK_MODE_VALUES = ['summary_hash', 'off'] as const
const LEGACY_TAXONOMY_CONFIG_KEY = 'extension' + 'Taxonomy'
const LEGACY_WORKFLOW_CONFIG_KEY = 'workflow'
const CHAT_LAYOUT_MANUAL_WIDTH_MIN = 860
const CHAT_LAYOUT_MANUAL_WIDTH_MAX = 1600
const CHAT_LAYOUT_MANUAL_WIDTH_DEFAULT = 1100

export type ConfigSourceMode = (typeof CONFIG_SOURCE_MODE_VALUES)[number]
type AppearanceThemeMode = (typeof APPEARANCE_THEME_VALUES)[number]
type ChatLayoutMode = (typeof CHAT_LAYOUT_MODE_VALUES)[number]

function normalizeLangfuseMaskMode(value: unknown): LangfuseMaskMode {
  if (typeof value === 'string' && (LANGFUSE_MASK_MODE_VALUES as readonly string[]).includes(value)) {
    return value
  }

  if (value !== undefined && value !== null) {
    console.warn('[Observability] Invalid langfuse maskMode. Forced to "summary_hash".', value)
  }

  return 'summary_hash'
}

function normalizeSampleRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1
  }
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function normalizeAppearanceTheme(value: unknown): AppearanceThemeMode {
  if (value === 'light' || value === 'dark') {
    return value
  }

  if (value === 'mono' || value === 'system') {
    console.warn('[ThemeMode] Legacy theme value detected. Migrated to "light".', value)
    return 'light'
  }

  if (value !== undefined && value !== null) {
    console.warn('[ThemeMode] Invalid theme value detected. Forced to "light".', value)
  }

  return 'light'
}

function normalizeChatLayoutMode(value: unknown): ChatLayoutMode {
  if (value === 'auto' || value === 'manual') {
    return value
  }

  if (value !== undefined && value !== null) {
    console.warn('[ChatLayout] Invalid mode detected. Forced to "auto".', value)
  }

  return 'auto'
}

function normalizeChatLayoutManualWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CHAT_LAYOUT_MANUAL_WIDTH_DEFAULT
  }

  const rounded = Math.round(value)
  return Math.max(
    CHAT_LAYOUT_MANUAL_WIDTH_MIN,
    Math.min(CHAT_LAYOUT_MANUAL_WIDTH_MAX, rounded)
  )
}

function normalizeChatLayout(value: unknown): {
  mode: ChatLayoutMode
  manualWidthPx: number
} {
  const record = isPlainObject(value) ? value : {}
  const mode = normalizeChatLayoutMode(record.mode)
  const manualWidthPx = normalizeChatLayoutManualWidth(record.manualWidthPx)

  return { mode, manualWidthPx }
}

export function normalizeConfigSourceMode(value: unknown): ConfigSourceMode {
  if (value === 'kite') {
    return 'kite'
  }

  if (value === 'claude') {
    console.warn('[ConfigSourceMode] "claude" is deprecated. Forced to "kite".')
    return 'kite'
  }

  if (value !== undefined && value !== null) {
    console.warn('[ConfigSourceMode] Invalid value detected. Forced to "kite".', value)
  }

  return 'kite'
}

/**
 * Register a callback to be notified when API config changes.
 * Used by agent.service to invalidate sessions on config change.
 *
 * @returns Unsubscribe function
 */
export function onApiConfigChange(handler: ApiConfigChangeHandler): () => void {
  apiConfigChangeHandlers.push(handler)
  return () => {
    const idx = apiConfigChangeHandlers.indexOf(handler)
    if (idx >= 0) apiConfigChangeHandlers.splice(idx, 1)
  }
}

/**
 * Register a callback to be notified when AI profile config changes.
 *
 * @returns Unsubscribe function
 */
export function onAiConfigChange(handler: AiConfigChangeHandler): () => void {
  aiConfigChangeHandlers.push(handler)
  return () => {
    const idx = aiConfigChangeHandlers.indexOf(handler)
    if (idx >= 0) aiConfigChangeHandlers.splice(idx, 1)
  }
}

interface KiteConfig {
  api: LegacyApiConfig
  ai: AiConfig
  permissions: {
    fileAccess: 'allow' | 'ask' | 'deny'
    commandExecution: 'allow' | 'ask' | 'deny'
    networkAccess: 'allow' | 'ask' | 'deny'
    trustMode: boolean
  }
  appearance: {
    theme: AppearanceThemeMode
    chatLayout: {
      mode: ChatLayoutMode
      manualWidthPx: number
    }
  }
  system: {
    autoLaunch: boolean
    minimizeToTray: boolean
    update: {
      checkOnStartup: boolean
      lastCheckAt: string | null
      latestKnownVersion: string | null
      lastDismissedVersion: string | null
    }
  }
  remoteAccess: {
    enabled: boolean
    port: number
    trustedOrigins?: string[]  // Allowed CORS origins (in addition to localhost)
    fixedToken?: string  // Optional fixed 6-digit token for remote API auth
  }
  onboarding: {
    completed: boolean
    homeGuideHidden: boolean
    starterExperienceHidden: boolean
  }
  // MCP servers configuration (compatible with Cursor / Claude Desktop format)
  mcpServers: Record<string, McpServerConfig>
  isFirstLaunch: boolean
  // Analytics configuration (auto-generated on first launch)
  analytics?: AnalyticsConfig
  // Git Bash configuration (Windows only)
  gitBash?: {
    installed: boolean
    path: string | null
    skipped: boolean
  }
  // Claude Code configuration (plugins, hooks, agents)
  claudeCode?: ClaudeCodeConfig
  resourceCreation?: {
    skill?: {
      strictIntentKeywords?: string[]
    }
  }
  // Configuration source mode (runtime lock consumes this on startup)
  configSourceMode: ConfigSourceMode
  commands?: {
    legacyDependencyRegexEnabled: boolean
  }
  observability?: ObservabilityConfig
}

// MCP server configuration types
type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig

interface McpStdioServerConfig {
  type?: 'stdio'  // Optional, defaults to stdio
  command: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  disabled?: boolean  // Kite extension: temporarily disable this server
}

interface McpHttpServerConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
  disabled?: boolean  // Kite extension: temporarily disable this server
}

interface McpSseServerConfig {
  type: 'sse'
  url: string
  headers?: Record<string, string>
  disabled?: boolean  // Kite extension: temporarily disable this server
}

// ============================================
// Claude Code Configuration Types
// ============================================

// Re-export shared types for backward compatibility
export type {
  HooksConfig,
  HookDefinition,
  HookCommand,
  PluginsConfig,
  AgentsConfig,
  ClaudeCodeConfig
} from '../../shared/types/claude-code'

import type { ClaudeCodeConfig } from '../../shared/types/claude-code'

// Paths
// Use getConfigDir() from instance utils to support KITE_CONFIG_DIR environment variable
// This enables running multiple Kite instances in parallel (e.g., different git worktrees)
export function getKiteDir(): string {
  return getConfigDir()
}

export function getConfigPath(): string {
  return join(getKiteDir(), 'config.json')
}

export function getTempSpacePath(): string {
  return join(getKiteDir(), 'temp')
}

export function resolveSpacesRootFromConfigDir(
  configDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    const normalizedConfigDir = pathWin32.resolve(configDir)
    const configBaseName = pathWin32.basename(normalizedConfigDir)
    const isDotKiteDir = configBaseName.toLowerCase() === '.kite'

    if (isDotKiteDir) {
      return pathWin32.resolve(pathWin32.join(pathWin32.dirname(normalizedConfigDir), 'kite'))
    }

    return pathWin32.resolve(pathWin32.join(normalizedConfigDir, 'kite'))
  }

  const normalizedConfigDir = pathPosix.resolve(configDir)
  const configBaseName = basename(normalizedConfigDir)
  const isDotKiteDir = configBaseName === '.kite'

  if (isDotKiteDir) {
    return pathPosix.resolve(join(dirname(normalizedConfigDir), 'kite'))
  }

  return pathPosix.resolve(join(normalizedConfigDir, 'kite'))
}

export function getSpacesDir(): string {
  return getKiteSpacesDir(getKiteDir())
}

export function getLegacySpacesDir(
  configDir: string = getKiteDir(),
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    return pathWin32.resolve(pathWin32.join(pathWin32.resolve(configDir), 'spaces'))
  }

  return pathPosix.resolve(pathPosix.join(pathPosix.resolve(configDir), 'spaces'))
}

// Default model (Opus 4.5)
const DEFAULT_MODEL = 'claude-opus-4-5-20251101'
const DEFAULT_API_CONFIG: LegacyApiConfig = {
  provider: 'anthropic',
  apiKey: '',
  apiUrl: 'https://api.anthropic.com',
  model: DEFAULT_MODEL
}

const DEFAULT_MCP_SERVERS: Record<string, McpServerConfig> = {
  'chrome-devtools': {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9222'],
    disabled: false
  }
}

// Default configuration
const DEFAULT_CONFIG: KiteConfig = {
  api: DEFAULT_API_CONFIG,
  ai: createAiConfigFromLegacyApi(DEFAULT_API_CONFIG),
  permissions: {
    fileAccess: 'allow',
    commandExecution: 'ask',
    networkAccess: 'allow',
    trustMode: false
  },
  appearance: {
    theme: 'light',
    chatLayout: {
      mode: 'auto',
      manualWidthPx: CHAT_LAYOUT_MANUAL_WIDTH_DEFAULT
    }
  },
  system: {
    autoLaunch: false,
    minimizeToTray: false,
    update: {
      checkOnStartup: true,
      lastCheckAt: null,
      latestKnownVersion: null,
      lastDismissedVersion: null
    }
  },
  remoteAccess: {
    enabled: false,
    port: 3456
  },
  onboarding: {
    completed: false,
    homeGuideHidden: false,
    starterExperienceHidden: false
  },
  mcpServers: DEFAULT_MCP_SERVERS,
  isFirstLaunch: true,
  configSourceMode: 'kite',
  commands: {
    legacyDependencyRegexEnabled: true
  },
  observability: {
    langfuse: {
      enabled: false,
      host: 'https://cloud.langfuse.com',
      publicKey: '',
      secretKey: '',
      sampleRate: 1,
      maskMode: 'summary_hash',
      devApiEnabled: false
    }
  },
  claudeCode: {
    resourceRuntimePolicy: 'app-single-source',
    skillMissingPolicy: 'skip',
    slashRuntimeMode: 'native'
  }
}

const BUILTIN_SEED_ENV_KEY = 'KITE_BUILTIN_SEED_DIR'
const DISABLE_BUILTIN_SEED_ENV_KEY = 'KITE_DISABLE_BUILTIN_SEED'
const SEED_STATE_FILE = '.seed-state.json'
const RESOURCE_EXPOSURE_CLEANUP_MARKER_FILE = 'resource-exposure-cleanup.v2.json'
const KITE_ROOT_TEMPLATE = '__KITE_ROOT__'
const BUILTIN_SEED_IGNORED_NAMES = new Set([
  SEED_STATE_FILE,
  'seed-manifest.json'
])

interface SeedInstalledPlugin {
  scope?: 'user' | 'project'
  installPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

interface SeedInstalledPluginsRegistry {
  version?: number
  plugins?: Record<string, SeedInstalledPlugin[]>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value
  }
  return JSON.parse(JSON.stringify(value))
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`)
}

function isBuiltInSeedDisabled(): boolean {
  const value = process.env[DISABLE_BUILTIN_SEED_ENV_KEY]
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function stripCliOptionArgs(args: string[], optionNames: string[]): string[] {
  const output: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i]
    const matched = optionNames.find((name) => current === name || current.startsWith(`${name}=`))
    if (!matched) {
      output.push(current)
      continue
    }

    if (current === matched) {
      const next = args[i + 1]
      if (typeof next === 'string' && !next.startsWith('-')) {
        i += 1
      }
    }
  }
  return output
}

function ensureChromeDevtoolsBrowserUrlTarget(
  mcpServers: KiteConfig['mcpServers']
): { servers: KiteConfig['mcpServers']; changed: boolean } {
  if (!isPlainObject(mcpServers)) {
    return { servers: mcpServers, changed: false }
  }

  const rawConfig = mcpServers['chrome-devtools']
  if (!isPlainObject(rawConfig) || typeof rawConfig.command !== 'string') {
    return { servers: mcpServers, changed: false }
  }

  const args = Array.isArray(rawConfig.args)
    ? rawConfig.args.filter((arg): arg is string => typeof arg === 'string')
    : []

  const hasChromeDevtoolsPackage = args.some((arg) => arg.includes('chrome-devtools-mcp'))
  if (!hasChromeDevtoolsPackage) {
    return { servers: mcpServers, changed: false }
  }

  const hasAutoConnect = args.some(
    (arg) => arg === '--autoConnect' || arg === '--auto-connect'
  )
  const hasBrowserUrl = args.some(
    (arg) => arg.startsWith('--browser-url') || arg.startsWith('--browserUrl')
  )
  const hasExplicitConnectTarget = args.some(
    (arg) =>
      arg.startsWith('--ws-endpoint') ||
      arg.startsWith('--wsEndpoint')
  )

  if (hasExplicitConnectTarget) {
    return { servers: mcpServers, changed: false }
  }

  const nextArgs = stripCliOptionArgs(args, ['--autoConnect', '--auto-connect'])
  if (!hasBrowserUrl) {
    nextArgs.push('--browser-url=http://127.0.0.1:9222')
  }

  const changed =
    hasAutoConnect ||
    !hasBrowserUrl ||
    nextArgs.length !== args.length ||
    nextArgs.some((value, idx) => value !== args[idx])
  if (!changed) {
    return { servers: mcpServers, changed: false }
  }

  const updatedServers = { ...mcpServers }
  updatedServers['chrome-devtools'] = {
    ...(rawConfig as Record<string, unknown>),
    args: nextArgs
  } as McpServerConfig

  return { servers: updatedServers, changed: true }
}

function deepFillMissing<T>(target: T, seedValue: unknown): T {
  if (!isPlainObject(seedValue) || !isPlainObject(target)) {
    return target
  }

  const merged: Record<string, unknown> = { ...target }
  for (const [key, incoming] of Object.entries(seedValue)) {
    const existing = merged[key]
    if (existing === undefined) {
      merged[key] = cloneJsonValue(incoming)
      continue
    }
    if (isPlainObject(existing) && isPlainObject(incoming)) {
      merged[key] = deepFillMissing(existing, incoming)
    }
  }

  return merged as T
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    console.warn(`[Seed] Failed to read JSON: ${path}`, error)
    return null
  }
}

function copyFileIfMissing(sourcePath: string, targetPath: string): void {
  if (existsSync(targetPath)) return
  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(sourcePath, targetPath)
}

function copyDirMissingOnly(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyDirMissingOnly(sourcePath, targetPath)
      continue
    }
    if (entry.isFile()) {
      copyFileIfMissing(sourcePath, targetPath)
    }
  }
}

function mergeJsonFileByMissingKeys(sourcePath: string, targetPath: string): void {
  const sourceValue = readJsonFile(sourcePath)
  if (!isPlainObject(sourceValue)) return

  if (!existsSync(targetPath)) {
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, JSON.stringify(sourceValue, null, 2))
    return
  }

  const targetValue = readJsonFile(targetPath)
  if (!isPlainObject(targetValue)) return

  const merged = deepFillMissing(targetValue, sourceValue)
  writeFileSync(targetPath, JSON.stringify(merged, null, 2))
}

function normalizeInstallPath(pathValue: string, kiteDir: string): string {
  if (!pathValue.startsWith(KITE_ROOT_TEMPLATE)) {
    return pathValue
  }

  const suffix = pathValue.slice(KITE_ROOT_TEMPLATE.length).replace(/^[/\\]+/, '')
  if (!suffix) return kiteDir

  const parts = suffix.split(/[\\/]+/).filter(Boolean)
  return join(kiteDir, ...parts)
}

function collectSeedPluginRelativePaths(
  sourceRegistryPath: string,
  kiteDir: string,
  targetPluginsDir: string
): string[] {
  const sourceValue = readJsonFile(sourceRegistryPath)
  if (!isPlainObject(sourceValue)) return []

  const sourceRegistry = sourceValue as SeedInstalledPluginsRegistry
  const sourcePlugins = isPlainObject(sourceRegistry.plugins) ? sourceRegistry.plugins : {}
  const targetPluginsAbs = resolve(targetPluginsDir)
  const relativePaths = new Set<string>()

  for (const installations of Object.values(sourcePlugins)) {
    if (!Array.isArray(installations)) continue
    for (const installation of installations) {
      if (!isPlainObject(installation) || typeof installation.installPath !== 'string') continue
      const normalizedInstallPath = resolve(normalizeInstallPath(installation.installPath, kiteDir))
      if (!isPathInside(targetPluginsAbs, normalizedInstallPath)) continue
      const relPath = relative(targetPluginsAbs, normalizedInstallPath)
      if (!relPath || relPath === '.') continue
      relativePaths.add(relPath.split(/[\\/]+/).filter(Boolean).join('/'))
    }
  }

  return Array.from(relativePaths)
}

function mergePluginRegistryWithTemplatePath(sourcePath: string, targetPath: string, kiteDir: string): void {
  const sourceValue = readJsonFile(sourcePath)
  if (!isPlainObject(sourceValue)) return

  const sourceRegistry = sourceValue as SeedInstalledPluginsRegistry
  const sourcePlugins = isPlainObject(sourceRegistry.plugins) ? sourceRegistry.plugins : {}

  const normalizedSeedPlugins: Record<string, SeedInstalledPlugin[]> = {}
  for (const [fullName, installations] of Object.entries(sourcePlugins)) {
    if (!Array.isArray(installations) || installations.length === 0) continue
    const normalizedInstallations = installations
      .filter((installation) => isPlainObject(installation))
      .map((installation) => {
        const installPathValue = typeof installation.installPath === 'string'
          ? normalizeInstallPath(installation.installPath, kiteDir)
          : undefined
        return {
          ...installation,
          ...(installPathValue ? { installPath: installPathValue } : {})
        }
      })
      .filter((installation) => typeof installation.installPath === 'string')

    if (normalizedInstallations.length > 0) {
      normalizedSeedPlugins[fullName] = normalizedInstallations
    }
  }

  if (Object.keys(normalizedSeedPlugins).length === 0) return

  const targetValue = readJsonFile(targetPath)
  const targetRegistry = isPlainObject(targetValue)
    ? (targetValue as SeedInstalledPluginsRegistry)
    : { version: sourceRegistry.version || 2, plugins: {} }
  const targetPlugins = isPlainObject(targetRegistry.plugins) ? { ...targetRegistry.plugins } : {}

  for (const [fullName, installations] of Object.entries(normalizedSeedPlugins)) {
    if (!Object.prototype.hasOwnProperty.call(targetPlugins, fullName)) {
      targetPlugins[fullName] = installations
    }
  }

  const mergedRegistry: SeedInstalledPluginsRegistry = {
    version: typeof targetRegistry.version === 'number'
      ? targetRegistry.version
      : (sourceRegistry.version || 2),
    plugins: targetPlugins
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, JSON.stringify(mergedRegistry, null, 2))
}

function injectPluginsSeed(sourcePluginsDir: string, targetPluginsDir: string, kiteDir: string): void {
  const sourceRegistryPath = join(sourcePluginsDir, 'installed_plugins.json')
  if (existsSync(sourceRegistryPath)) {
    const relativePluginPaths = collectSeedPluginRelativePaths(sourceRegistryPath, kiteDir, targetPluginsDir)
    for (const relPath of relativePluginPaths) {
      const segments = relPath.split('/').filter(Boolean)
      if (segments.length === 0) continue
      const sourcePluginPath = join(sourcePluginsDir, ...segments)
      if (!isDirectory(sourcePluginPath)) continue
      copyDirMissingOnly(sourcePluginPath, join(targetPluginsDir, ...segments))
    }
  }

  if (existsSync(sourceRegistryPath)) {
    mergePluginRegistryWithTemplatePath(
      sourceRegistryPath,
      join(targetPluginsDir, 'installed_plugins.json'),
      kiteDir
    )
  }
}

function getSeedStatePath(kiteDir: string): string {
  return join(kiteDir, SEED_STATE_FILE)
}

function shouldInjectBuiltInSeed(kiteDir: string, seedDir: string | null): boolean {
  if (isBuiltInSeedDisabled()) {
    console.log('[Seed] Injection disabled by KITE_DISABLE_BUILTIN_SEED')
    return false
  }
  if (!seedDir) return false
  if (!isDirectory(seedDir)) return false
  if (existsSync(getSeedStatePath(kiteDir))) return false
  return true
}

function getDevSeedCandidates(): string[] {
  const candidates: string[] = []
  try {
    const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : null
    if (appPath) {
      candidates.push(join(appPath, '../resources/default-kite-config'))
    }
  } catch {
    // Ignore app path errors in tests/dev environments
  }

  candidates.push(
    join(__dirname, '../../resources/default-kite-config'),
    join(process.cwd(), 'build/default-kite-config'),
    join(process.cwd(), 'resources/default-kite-config')
  )
  return candidates
}

export function resolveSeedDir(): string | null {
  const envSeedPath = process.env[BUILTIN_SEED_ENV_KEY]
  const packagedSeedPath = typeof process.resourcesPath === 'string'
    ? join(process.resourcesPath, 'default-kite-config')
    : null
  const candidates = [
    ...(envSeedPath ? [envSeedPath] : []),
    ...(packagedSeedPath ? [packagedSeedPath] : []),
    ...getDevSeedCandidates()
  ]

  for (const candidate of candidates) {
    if (isDirectory(candidate)) {
      console.log(`[Seed] Using built-in seed dir: ${candidate}`)
      return candidate
    }
  }

  return null
}

function injectBuiltInSeed(seedDir: string, kiteDir: string): boolean {
  let hasSeedEntries = false
  for (const entry of readdirSync(seedDir, { withFileTypes: true })) {
    const entryName = entry.name
    if (BUILTIN_SEED_IGNORED_NAMES.has(entryName)) continue

    const sourcePath = join(seedDir, entryName)
    hasSeedEntries = true
    const targetPath = join(kiteDir, entryName)

    if (entryName === 'config.json' || entryName === 'settings.json') {
      mergeJsonFileByMissingKeys(sourcePath, targetPath)
      continue
    }

    if (entryName === 'plugins' && entry.isDirectory()) {
      injectPluginsSeed(sourcePath, targetPath, kiteDir)
      continue
    }

    if (entry.isDirectory()) {
      copyDirMissingOnly(sourcePath, targetPath)
      continue
    }

    if (entry.isFile()) {
      copyFileIfMissing(sourcePath, targetPath)
    }
  }

  if (!hasSeedEntries) {
    return false
  }

  const seedState = {
    schemaVersion: 1,
    appVersion: app.getVersion(),
    injectedAt: new Date().toISOString()
  }
  writeFileSync(getSeedStatePath(kiteDir), JSON.stringify(seedState, null, 2))
  return true
}

function forcePersistKiteConfigSourceMode(configPath: string): void {
  if (!existsSync(configPath)) {
    return
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content) as Record<string, unknown>
    const normalizedMode = normalizeConfigSourceMode(parsed.configSourceMode)

    if (parsed.configSourceMode === normalizedMode) {
      return
    }

    parsed.configSourceMode = 'kite'
    writeFileSync(configPath, JSON.stringify(parsed, null, 2))
    console.log('[ConfigSourceMode] Migrated persisted configSourceMode to "kite".')
  } catch (error) {
    console.warn('[ConfigSourceMode] Failed to migrate persisted configSourceMode:', error)
  }
}

function getResourceExposureCleanupMarkerPath(kiteDir: string): string {
  return join(kiteDir, RESOURCE_EXPOSURE_CLEANUP_MARKER_FILE)
}

function parseJsonObjectFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content) as unknown
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function resolvePathFromHome(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : join(homedir(), pathValue)
}

function collectCleanupResourceDirs(kiteDir: string, configPath: string): string[] {
  const dirs = new Set<string>([
    getKiteSkillsDir(kiteDir),
    getKiteAgentsDir(kiteDir),
    join(kiteDir, 'commands'),
    join(kiteDir, 'skills'),
    join(kiteDir, 'agents'),
  ])

  const parsedConfig = parseJsonObjectFile(configPath) || {}
  const claudeCode = isPlainObject(parsedConfig.claudeCode) ? parsedConfig.claudeCode : {}
  const plugins = isPlainObject(claudeCode.plugins) ? claudeCode.plugins : {}
  const agents = isPlainObject(claudeCode.agents) ? claudeCode.agents : {}

  for (const globalPath of toStringArray(plugins.globalPaths)) {
    const resolvedGlobalPath = resolvePathFromHome(globalPath)
    dirs.add(join(resolvedGlobalPath, 'skills'))
    dirs.add(join(resolvedGlobalPath, 'commands'))
  }

  for (const agentsPath of toStringArray(agents.paths)) {
    dirs.add(resolvePathFromHome(agentsPath))
  }

  const pluginsRegistryPath = join(kiteDir, 'plugins', 'installed_plugins.json')
  const registry = parseJsonObjectFile(pluginsRegistryPath)
  if (registry && isPlainObject(registry.plugins)) {
    for (const installations of Object.values(registry.plugins)) {
      if (!Array.isArray(installations)) continue
      for (const installation of installations) {
        if (!isPlainObject(installation)) continue
        if (typeof installation.installPath !== 'string' || installation.installPath.trim().length === 0) continue
        dirs.add(join(installation.installPath, 'skills'))
        dirs.add(join(installation.installPath, 'agents'))
        dirs.add(join(installation.installPath, 'commands'))
      }
    }
  }

  const spacePaths = new Set<string>()
  for (const rootPath of [getSpacesDir(), getLegacySpacesDir(kiteDir)]) {
    if (!existsSync(rootPath)) continue
    try {
      for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        spacePaths.add(join(rootPath, entry.name))
      }
    } catch {
      // ignore unreadable roots
    }
  }

  const spacesIndexPath = join(kiteDir, 'spaces-index.json')
  const spacesIndex = parseJsonObjectFile(spacesIndexPath)
  if (spacesIndex) {
    for (const customPath of toStringArray(spacesIndex.customPaths)) {
      spacePaths.add(customPath)
    }
  }

  for (const spacePath of spacePaths) {
    dirs.add(join(spacePath, '.claude', 'skills'))
    dirs.add(join(spacePath, '.claude', 'agents'))
    dirs.add(join(spacePath, '.claude', 'commands'))
  }

  return [...dirs]
}

function stripExposureFrontmatterLine(content: string): string | null {
  const lineBreak = content.startsWith('---\r\n') ? '\r\n' : content.startsWith('---\n') ? '\n' : null
  if (!lineBreak) return null

  const frontmatterStart = 3 + lineBreak.length
  const frontmatterEndToken = `${lineBreak}---${lineBreak}`
  const frontmatterEnd = content.indexOf(frontmatterEndToken, frontmatterStart)
  if (frontmatterEnd < 0) return null

  const frontmatterBody = content.slice(frontmatterStart, frontmatterEnd)
  const frontmatterLines = frontmatterBody.split(/\r?\n/)
  const filteredLines = frontmatterLines.filter((line) => !line.trimStart().startsWith('exposure:'))
  if (filteredLines.length === frontmatterLines.length) return null

  const nextFrontmatter = `---${lineBreak}${filteredLines.join(lineBreak)}${lineBreak}---${lineBreak}`
  return `${nextFrontmatter}${content.slice(frontmatterEnd + frontmatterEndToken.length)}`
}

function cleanupExposureInMarkdownDir(dirPath: string): { scannedFiles: number; cleanedFiles: number } {
  if (!existsSync(dirPath)) {
    return { scannedFiles: 0, cleanedFiles: 0 }
  }

  let scannedFiles = 0
  let cleanedFiles = 0
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return { scannedFiles: 0, cleanedFiles: 0 }
  }

  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const nested = cleanupExposureInMarkdownDir(entryPath)
      scannedFiles += nested.scannedFiles
      cleanedFiles += nested.cleanedFiles
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue

    scannedFiles += 1
    let content: string
    try {
      content = readFileSync(entryPath, 'utf-8')
    } catch {
      continue
    }

    const cleanedContent = stripExposureFrontmatterLine(content)
    if (cleanedContent === null) continue
    try {
      writeFileSync(entryPath, cleanedContent, 'utf-8')
      cleanedFiles += 1
    } catch (error) {
      console.warn(`[Config] Failed to cleanup exposure field in file ${entryPath}:`, error)
    }
  }

  return { scannedFiles, cleanedFiles }
}

function cleanupLegacyResourceExposureArtifacts(kiteDir: string, configPath: string): void {
  const markerPath = getResourceExposureCleanupMarkerPath(kiteDir)
  if (existsSync(markerPath)) return

  let cleanedFiles = 0
  let scannedFiles = 0

  for (const dirPath of collectCleanupResourceDirs(kiteDir, configPath)) {
    const result = cleanupExposureInMarkdownDir(dirPath)
    scannedFiles += result.scannedFiles
    cleanedFiles += result.cleanedFiles
  }

  let removedLegacyExposureConfig = false
  const legacyExposureConfigPath = join(kiteDir, 'taxonomy', 'resource-exposure.json')
  if (existsSync(legacyExposureConfigPath)) {
    rmSync(legacyExposureConfigPath, { force: true })
    removedLegacyExposureConfig = true
  }

  let removedConfigField = false
  const parsedConfig = parseJsonObjectFile(configPath)
  if (parsedConfig && Object.prototype.hasOwnProperty.call(parsedConfig, 'resourceExposure')) {
    delete parsedConfig.resourceExposure
    writeFileSync(configPath, JSON.stringify(parsedConfig, null, 2))
    removedConfigField = true
  }

  writeFileSync(
    markerPath,
    JSON.stringify({
      schemaVersion: 2,
      cleanedAt: new Date().toISOString(),
      scannedFiles,
      cleanedFiles,
      removedLegacyExposureConfig,
      removedConfigField
    }, null, 2),
    'utf-8'
  )
}

// Initialize app directories
export async function initializeApp(): Promise<void> {
  const kiteDir = getKiteDir()
  const tempDir = getTempSpacePath()
  const spacesDir = getSpacesDir()
  const tempArtifactsDir = join(tempDir, 'artifacts')
  const tempConversationsDir = join(tempDir, 'conversations')

  // Create directories if they don't exist
  const dirs = [kiteDir, tempDir, spacesDir, tempArtifactsDir, tempConversationsDir]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const seedDir = resolveSeedDir()
  if (shouldInjectBuiltInSeed(kiteDir, seedDir) && seedDir) {
    try {
      const injected = injectBuiltInSeed(seedDir, kiteDir)
      if (injected) {
        console.log('[Seed] Built-in seed injection complete')
      } else {
        console.log('[Seed] Built-in seed injection skipped (no seed entries)')
      }
    } catch (error) {
      console.error('[Seed] Built-in seed injection failed:', error)
    }
  }

  // Create default config if it doesn't exist
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
  }
  cleanupLegacyResourceExposureArtifacts(kiteDir, configPath)
  forcePersistKiteConfigSourceMode(configPath)
}

// Get configuration
export function getConfig(): KiteConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<KiteConfig> & Record<string, unknown>
    const hadLegacyTaxonomyField = Object.prototype.hasOwnProperty.call(parsed, LEGACY_TAXONOMY_CONFIG_KEY)
    const hadLegacyWorkflowField = Object.prototype.hasOwnProperty.call(parsed, LEGACY_WORKFLOW_CONFIG_KEY)
    const {
      [LEGACY_TAXONOMY_CONFIG_KEY]: _legacyTaxonomyConfig,
      [LEGACY_WORKFLOW_CONFIG_KEY]: _legacyWorkflowConfig,
      ...parsedWithoutLegacy
    } = parsed as Partial<KiteConfig> & Record<string, unknown>
    const legacyApi = ensureLegacyApiConfig(parsed.api, DEFAULT_CONFIG.api)
    const ai = ensureAiConfig(parsed.ai, legacyApi)
    const mirroredApi = mirrorAiToLegacyApi(ai, legacyApi)
    const parsedMcpServers = isPlainObject(parsed.mcpServers)
      ? (parsed.mcpServers as KiteConfig['mcpServers'])
      : {}
    const mergedMcpServersBase = deepFillMissing(parsedMcpServers, DEFAULT_CONFIG.mcpServers)
    const normalizedMcpServers = ensureChromeDevtoolsBrowserUrlTarget(mergedMcpServersBase)
    const mergedMcpServers = normalizedMcpServers.servers
    const shouldPersistChromeDevtoolsDisabledDefault = (() => {
      const rawChrome = isPlainObject(parsedMcpServers)
        ? (parsedMcpServers['chrome-devtools'] as Record<string, unknown> | undefined)
        : undefined
      return isPlainObject(rawChrome) && !Object.prototype.hasOwnProperty.call(rawChrome, 'disabled')
    })()
    const shouldPersistMcpMigration = !isPlainObject(parsed.mcpServers) || Object.keys(DEFAULT_MCP_SERVERS).some(
      (serverName) => !(serverName in parsedMcpServers)
    ) || normalizedMcpServers.changed || shouldPersistChromeDevtoolsDisabledDefault
    const normalizedChatLayout = normalizeChatLayout(parsed.appearance?.chatLayout)
    const rawParsedChatLayout = isPlainObject(parsed.appearance?.chatLayout)
      ? (parsed.appearance?.chatLayout as Record<string, unknown>)
      : null
    const shouldPersistChatLayoutMigration =
      !rawParsedChatLayout
      || rawParsedChatLayout.mode !== normalizedChatLayout.mode
      || rawParsedChatLayout.manualWidthPx !== normalizedChatLayout.manualWidthPx

    // Deep merge to ensure all nested defaults are applied
    const mergedConfig: KiteConfig = {
      ...DEFAULT_CONFIG,
      ...parsedWithoutLegacy,
      api: mirroredApi,
      ai,
      permissions: { ...DEFAULT_CONFIG.permissions, ...parsed.permissions },
      appearance: {
        ...DEFAULT_CONFIG.appearance,
        ...parsed.appearance,
        theme: normalizeAppearanceTheme(parsed.appearance?.theme),
        chatLayout: normalizedChatLayout
      },
      system: {
        ...DEFAULT_CONFIG.system,
        ...parsed.system,
        update: {
          ...DEFAULT_CONFIG.system.update,
          ...(isPlainObject(parsed.system?.update) ? parsed.system.update : {})
        }
      },
      onboarding: { ...DEFAULT_CONFIG.onboarding, ...parsed.onboarding },
      mcpServers: mergedMcpServers,
      // analytics: keep as-is (managed by analytics.service.ts)
      analytics: parsed.analytics,
      configSourceMode: normalizeConfigSourceMode(parsed.configSourceMode),
      commands: {
        legacyDependencyRegexEnabled:
          typeof parsed.commands?.legacyDependencyRegexEnabled === 'boolean'
            ? parsed.commands.legacyDependencyRegexEnabled
            : DEFAULT_CONFIG.commands?.legacyDependencyRegexEnabled !== false
      },
      observability: {
        langfuse: {
          enabled:
            typeof parsed.observability?.langfuse?.enabled === 'boolean'
              ? parsed.observability.langfuse.enabled
              : DEFAULT_CONFIG.observability?.langfuse.enabled === true,
          host:
            typeof parsed.observability?.langfuse?.host === 'string'
              ? parsed.observability.langfuse.host
              : DEFAULT_CONFIG.observability?.langfuse.host || 'https://cloud.langfuse.com',
          publicKey:
            typeof parsed.observability?.langfuse?.publicKey === 'string'
              ? parsed.observability.langfuse.publicKey
              : DEFAULT_CONFIG.observability?.langfuse.publicKey || '',
          secretKey:
            typeof parsed.observability?.langfuse?.secretKey === 'string'
              ? parsed.observability.langfuse.secretKey
              : DEFAULT_CONFIG.observability?.langfuse.secretKey || '',
          sampleRate: normalizeSampleRate(parsed.observability?.langfuse?.sampleRate),
          maskMode: normalizeLangfuseMaskMode(parsed.observability?.langfuse?.maskMode),
          devApiEnabled:
            typeof parsed.observability?.langfuse?.devApiEnabled === 'boolean'
              ? parsed.observability.langfuse.devApiEnabled
              : DEFAULT_CONFIG.observability?.langfuse.devApiEnabled === true
        }
      }
    }

    const hasStarterExperienceFlag = typeof parsed.onboarding?.starterExperienceHidden === 'boolean'
    const hasLegacyHomeGuideHidden = parsed.onboarding?.homeGuideHidden === true
    let shouldPersistOnboardingMigration = false
    if (!hasStarterExperienceFlag && hasLegacyHomeGuideHidden) {
      mergedConfig.onboarding.starterExperienceHidden = true
      shouldPersistOnboardingMigration = true
    }

    const shouldPersistThemeMigration = parsed.appearance?.theme !== undefined
      && parsed.appearance.theme !== mergedConfig.appearance.theme

    if (
      hadLegacyTaxonomyField ||
      hadLegacyWorkflowField ||
      shouldPersistThemeMigration ||
      shouldPersistOnboardingMigration ||
      shouldPersistMcpMigration ||
      shouldPersistChatLayoutMigration
    ) {
      writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2))
    }

    return mergedConfig
  } catch (error) {
    console.error('Failed to read config:', error)
    return DEFAULT_CONFIG
  }
}

// Save configuration
export function saveConfig(config: Partial<KiteConfig>): KiteConfig {
  const currentConfig = getConfig()
  const rawUpdates = config as Record<string, unknown>
  const {
    [LEGACY_TAXONOMY_CONFIG_KEY]: _legacyTaxonomyConfig,
    [LEGACY_WORKFLOW_CONFIG_KEY]: _legacyWorkflowConfig,
    ...updatesWithoutLegacy
  } = rawUpdates
  const newConfig = { ...currentConfig, ...updatesWithoutLegacy } as KiteConfig & Record<string, unknown>
  delete newConfig[LEGACY_TAXONOMY_CONFIG_KEY]
  delete newConfig[LEGACY_WORKFLOW_CONFIG_KEY]
  const hasApiUpdate = config.api !== undefined
  const hasAiUpdate = updatesWithoutLegacy.ai !== undefined

  // Deep merge for nested objects
  if (config.api) {
    newConfig.api = ensureLegacyApiConfig({ ...currentConfig.api, ...config.api }, currentConfig.api)
  }
  if (hasAiUpdate) {
    const aiUpdate = isPlainObject(rawUpdates.ai) ? (rawUpdates.ai as Partial<AiConfig>) : undefined
    const mergedAiInput: Partial<AiConfig> = {
      ...currentConfig.ai,
      ...(aiUpdate || {}),
      profiles: Array.isArray(aiUpdate?.profiles) ? aiUpdate.profiles : currentConfig.ai.profiles
    }
    newConfig.ai = ensureAiConfig(mergedAiInput, newConfig.api)
  }
  if (config.permissions) {
    newConfig.permissions = { ...currentConfig.permissions, ...config.permissions }
  }
  if (config.appearance) {
    const normalizedChatLayout = normalizeChatLayout(
      Object.prototype.hasOwnProperty.call(config.appearance, 'chatLayout')
        ? config.appearance.chatLayout
        : currentConfig.appearance.chatLayout
    )
    newConfig.appearance = {
      ...currentConfig.appearance,
      ...config.appearance,
      theme:
        config.appearance.theme === undefined
          ? currentConfig.appearance.theme
          : normalizeAppearanceTheme(config.appearance.theme),
      chatLayout: normalizedChatLayout
    }
  }
  if (config.system) {
    newConfig.system = {
      ...currentConfig.system,
      ...config.system,
      update: {
        ...currentConfig.system.update,
        ...(isPlainObject(config.system.update) ? config.system.update : {})
      }
    }
  }
  if (config.onboarding) {
    newConfig.onboarding = { ...currentConfig.onboarding, ...config.onboarding }
  }
  newConfig.configSourceMode = 'kite'
  if (updatesWithoutLegacy.commands !== undefined) {
    newConfig.commands = {
      ...currentConfig.commands,
      ...(updatesWithoutLegacy.commands as Record<string, unknown>)
    }
  }
  if (updatesWithoutLegacy.observability !== undefined) {
    const rawObservability = isPlainObject(updatesWithoutLegacy.observability)
      ? updatesWithoutLegacy.observability as Record<string, unknown>
      : {}
    const rawLangfuse = isPlainObject(rawObservability.langfuse)
      ? rawObservability.langfuse as Record<string, unknown>
      : {}
    newConfig.observability = {
      langfuse: {
        ...currentConfig.observability?.langfuse,
        ...rawLangfuse,
        enabled:
          typeof rawLangfuse.enabled === 'boolean'
            ? rawLangfuse.enabled
            : currentConfig.observability?.langfuse.enabled === true,
        host:
          typeof rawLangfuse.host === 'string'
            ? rawLangfuse.host
            : currentConfig.observability?.langfuse.host || DEFAULT_CONFIG.observability?.langfuse.host || 'https://cloud.langfuse.com',
        publicKey:
          typeof rawLangfuse.publicKey === 'string'
            ? rawLangfuse.publicKey
            : currentConfig.observability?.langfuse.publicKey || '',
        secretKey:
          typeof rawLangfuse.secretKey === 'string'
            ? rawLangfuse.secretKey
            : currentConfig.observability?.langfuse.secretKey || '',
        sampleRate:
          rawLangfuse.sampleRate !== undefined
            ? normalizeSampleRate(rawLangfuse.sampleRate)
            : normalizeSampleRate(currentConfig.observability?.langfuse.sampleRate),
        maskMode:
          rawLangfuse.maskMode !== undefined
            ? normalizeLangfuseMaskMode(rawLangfuse.maskMode)
            : normalizeLangfuseMaskMode(currentConfig.observability?.langfuse.maskMode),
        devApiEnabled:
          typeof rawLangfuse.devApiEnabled === 'boolean'
            ? rawLangfuse.devApiEnabled
            : currentConfig.observability?.langfuse.devApiEnabled === true
      }
    }
  }
  // mcpServers: replace entirely when provided (not merged)
  if (updatesWithoutLegacy.mcpServers !== undefined) {
    const nextMcpServers = isPlainObject(updatesWithoutLegacy.mcpServers)
      ? (updatesWithoutLegacy.mcpServers as KiteConfig['mcpServers'])
      : {}
    const mergedMcpServers = deepFillMissing(nextMcpServers, DEFAULT_CONFIG.mcpServers)
    newConfig.mcpServers = ensureChromeDevtoolsBrowserUrlTarget(mergedMcpServers).servers
  }
  // analytics: replace entirely when provided (managed by analytics.service.ts)
  if (updatesWithoutLegacy.analytics !== undefined) {
    newConfig.analytics = updatesWithoutLegacy.analytics as KiteConfig['analytics']
  }
  // gitBash: replace entirely when provided (Windows only)
  if (updatesWithoutLegacy.gitBash !== undefined) {
    newConfig.gitBash = updatesWithoutLegacy.gitBash as KiteConfig['gitBash']
  }

  // Keep ai <-> api mirrored for backward compatibility.
  // If both ai and api are updated together, ai takes precedence.
  if (hasAiUpdate) {
    newConfig.api = mirrorAiToLegacyApi(newConfig.ai, newConfig.api)
  } else if (hasApiUpdate) {
    newConfig.ai = mirrorLegacyApiToAi(newConfig.api, currentConfig.ai)
    newConfig.api = mirrorAiToLegacyApi(newConfig.ai, newConfig.api)
  } else {
    newConfig.ai = ensureAiConfig(newConfig.ai, newConfig.api)
    newConfig.api = mirrorAiToLegacyApi(newConfig.ai, newConfig.api)
  }

  const configPath = getConfigPath()
  delete newConfig[LEGACY_TAXONOMY_CONFIG_KEY]
  delete newConfig[LEGACY_WORKFLOW_CONFIG_KEY]
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2))

  // Detect config changes and notify subscribers.
  const apiChanged =
    newConfig.api.provider !== currentConfig.api.provider ||
    newConfig.api.apiKey !== currentConfig.api.apiKey ||
    newConfig.api.apiUrl !== currentConfig.api.apiUrl
  const aiChanged = JSON.stringify(newConfig.ai) !== JSON.stringify(currentConfig.ai)

  const shouldNotifyApi = apiChanged && apiConfigChangeHandlers.length > 0
  const shouldNotifyAi = aiChanged && aiConfigChangeHandlers.length > 0

  if (shouldNotifyApi || shouldNotifyAi) {
    setTimeout(() => {
      if (shouldNotifyApi) {
        console.log('[Config] API config changed, notifying subscribers...')
        apiConfigChangeHandlers.forEach(handler => {
          try {
            handler()
          } catch (e) {
            console.error('[Config] Error in API config change handler:', e)
          }
        })
      }

      if (shouldNotifyAi) {
        console.log('[Config] AI config changed, notifying subscribers...')
        aiConfigChangeHandlers.forEach(handler => {
          try {
            handler()
          } catch (e) {
            console.error('[Config] Error in AI config change handler:', e)
          }
        })
      }
    }, 0)
  }

  return newConfig
}

// Validate API connection
export async function validateApiConnection(
  apiKey: string,
  apiUrl: string,
  provider: string,
  protocol?: ProviderProtocol,
  model?: string
): Promise<ApiValidationResult> {
  try {
    const isProviderProtocol = (value: unknown): value is ProviderProtocol =>
      value === 'anthropic_official' || value === 'anthropic_compat' || value === 'openai_compat'

    const resolveProtocol = (legacyProvider: string, explicitProtocol?: ProviderProtocol): ProviderProtocol => {
      if (isProviderProtocol(explicitProtocol)) return explicitProtocol
      if (isProviderProtocol(legacyProvider)) return legacyProvider
      if (legacyProvider === 'anthropic') return 'anthropic_official'
      if (legacyProvider === 'openai') return 'openai_compat'
      return 'anthropic_compat'
    }

    const trimSlash = (s: string) => s.replace(/\/+$/, '')

    const resolvedProtocol = resolveProtocol(provider, protocol)

    const resolveOpenAIProbeUrls = (
      endpointUrl: string
    ): { endpoint: string; models: string; endpointSuffix: '/chat/completions' | '/responses' } | null => {
      const normalizedEndpoint = trimSlash(endpointUrl.trim())
      let endpointSuffix: '/chat/completions' | '/responses' | null = null
      if (normalizedEndpoint.endsWith('/chat/completions')) {
        endpointSuffix = '/chat/completions'
      } else if (normalizedEndpoint.endsWith('/responses')) {
        endpointSuffix = '/responses'
      }

      if (!endpointSuffix) return null

      const endpointBase = trimSlash(normalizedEndpoint.slice(0, -endpointSuffix.length))
      const hasV1Segment = endpointBase.endsWith('/v1') || endpointBase.includes('/v1/')
      const baseV1 = hasV1Segment ? endpointBase : `${endpointBase}/v1`
      return {
        endpoint: normalizedEndpoint,
        models: `${baseV1}/models`,
        endpointSuffix
      }
    }

    const resolveAnthropicMessagesUrl = (url: string): string => {
      const normalized = trimSlash(url.trim())
      if (normalized.endsWith('/v1/messages')) {
        return normalized
      }
      return `${normalized}/v1/messages`
    }

    const normalizedModel = typeof model === 'string' ? model.trim() : ''
    const testModel = normalizedModel || undefined

    const buildSuccessResult = (
      input: Omit<ApiValidationResult, 'valid' | 'availableModels' | 'manualModelInputRequired'> & {
        availableModels?: string[]
        manualModelInputRequired?: boolean
      }
    ): ApiValidationResult => ({
      valid: true,
      model: input.model,
      resolvedModel: input.resolvedModel ?? input.model,
      message: input.message,
      availableModels: input.availableModels ?? [],
      manualModelInputRequired: input.manualModelInputRequired ?? false,
      connectionSummary: input.connectionSummary
    })

    const buildFailureResult = (message: string): ApiValidationResult => ({
      valid: false,
      message,
      availableModels: [],
      manualModelInputRequired: false
    })

    const presetKey = inferProfilePresetKey({
      vendor:
        resolvedProtocol === 'openai_compat'
          ? 'openai'
          : apiUrl.includes('api.minimaxi.com')
            ? 'minimax'
            : apiUrl.includes('api.moonshot.cn')
              ? 'moonshot'
              : apiUrl.includes('open.bigmodel.cn')
                ? 'zhipu'
                : 'anthropic',
      protocol: resolvedProtocol,
      apiUrl
    })

    // OpenAI compatible validation:
    // 1) Probe configured endpoint directly (POST /chat/completions or /responses).
    //    Many gateways do not expose GET /v1/models, but endpoint probe is still enough
    //    to verify URL/key reachability.
    // 2) Fallback to GET /v1/models for providers that do support model listing.
    if (resolvedProtocol === 'openai_compat') {
      const probeUrls = resolveOpenAIProbeUrls(apiUrl)
      if (!probeUrls) {
        return buildFailureResult('OpenAI compatible API URL must end with /chat/completions or /responses')
      }

      const endpointResponse = await fetch(probeUrls.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        // If test model is provided, probe with that model to catch model-level errors early.
        body: testModel
          ? JSON.stringify(
            probeUrls.endpointSuffix === '/responses'
              ? {
                  model: testModel,
                  input: 'ping',
                  max_output_tokens: 1
                }
              : {
                  model: testModel,
                  messages: [{ role: 'user', content: 'ping' }],
                  max_tokens: 1
                }
          )
          : '{}'
      })

      if (endpointResponse.status === 401 || endpointResponse.status === 403) {
        const authErrorText = await endpointResponse.text().catch(() => '')
        return buildFailureResult(authErrorText || `HTTP ${endpointResponse.status}`)
      }

      const endpointReachable =
        endpointResponse.ok ||
        endpointResponse.status === 400 ||
        endpointResponse.status === 422 ||
        endpointResponse.status === 429

      if (endpointResponse.status === 400 || endpointResponse.status === 422 || endpointResponse.status === 429) {
        const endpointErrorText = await endpointResponse.text().catch(() => '')
        if (testModel) {
          const lower = endpointErrorText.toLowerCase()
          const pointsToModel =
            lower.includes('model') &&
            (
              lower.includes('not found') ||
              lower.includes('does not exist') ||
              lower.includes('unknown') ||
              lower.includes('unsupported') ||
              lower.includes('invalid')
            )
          if (pointsToModel) {
            return buildFailureResult(endpointErrorText || `Model "${testModel}" is not available on this endpoint`)
          }
        }
      }

      const modelsResponse = await fetch(probeUrls.models, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })

      if (modelsResponse.ok) {
        const data: any = await modelsResponse.json().catch(() => ({}))
        const availableModels = Array.isArray(data?.data)
          ? data.data
            .map((item: any) => (typeof item?.id === 'string' ? item.id.trim() : ''))
            .filter((item: string) => item.length > 0)
          : []
        if (testModel && availableModels.length > 0 && !availableModels.includes(testModel)) {
          return buildFailureResult(`Model "${testModel}" is not listed by provider`)
        }
        const modelId =
          testModel ||
          data?.data?.[0]?.id ||
          data?.model ||
          undefined
        return buildSuccessResult({
          model: modelId,
          resolvedModel: modelId,
          availableModels,
          manualModelInputRequired: false,
          connectionSummary: availableModels.length > 0
            ? `已连接 OpenAI，可继续选择模型`
            : '连接成功，但当前服务未返回模型列表，请手动填写模型名称'
        })
      }

      if (endpointReachable) {
        return buildSuccessResult({
          model: testModel,
          resolvedModel: testModel,
          availableModels: [],
          manualModelInputRequired: true,
          connectionSummary: '连接成功，但当前服务未返回模型列表，请手动填写模型名称'
        })
      }

      const endpointErrorText = await endpointResponse.text().catch(() => '')
      const modelsErrorText = await modelsResponse.text().catch(() => '')
      return buildFailureResult(endpointErrorText || modelsErrorText || `HTTP ${modelsResponse.status}`)
    }

    // Anthropic compatible validation: POST /v1/messages
    const messagesUrl = resolveAnthropicMessagesUrl(apiUrl)
    const response = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: testModel || DEFAULT_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    })

    if (response.ok) {
      const data = await response.json()
      const resolvedModel = data.model || testModel || DEFAULT_MODEL
      const availableModels = presetKey === 'custom' ? [] : getPresetRecommendedModels(presetKey)
      const manualModelInputRequired = presetKey === 'custom'
      return buildSuccessResult({
        model: resolvedModel,
        resolvedModel,
        availableModels,
        manualModelInputRequired,
        connectionSummary: manualModelInputRequired
          ? '连接成功，但当前服务未返回模型列表，请手动填写模型名称'
          : `已连接 ${presetKey === 'anthropic_official' ? 'Anthropic' : '兼容服务'}，可继续选择模型`
      })
    } else {
      const error = await response.json().catch(() => ({}))
      return buildFailureResult(error.error?.message || `HTTP ${response.status}`)
    }
  } catch (error: unknown) {
    const err = error as Error
    return {
      valid: false,
      message: err.message || 'Connection failed',
      availableModels: [],
      manualModelInputRequired: false
    }
  }
}

/**
 * Set auto launch on system startup
 */
export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // Start minimized
    // On macOS, also set to open at login for all users (requires admin)
    // path: process.execPath, // Optional: specify executable path
  })

  // Save to config
  const current = getConfig().system
  saveConfig({
    system: {
      autoLaunch: enabled,
      minimizeToTray: current.minimizeToTray,
      update: current.update
    }
  })
  console.log(`[Config] Auto launch set to: ${enabled}`)
}

/**
 * Get current auto launch status
 */
export function getAutoLaunch(): boolean {
  const settings = app.getLoginItemSettings()
  return settings.openAtLogin
}

/**
 * Set minimize to tray behavior
 */
export function setMinimizeToTray(enabled: boolean): void {
  const current = getConfig().system
  saveConfig({
    system: {
      autoLaunch: current.autoLaunch,
      minimizeToTray: enabled,
      update: current.update
    }
  })
  console.log(`[Config] Minimize to tray set to: ${enabled}`)
}

/**
 * Get minimize to tray setting
 */
export function getMinimizeToTray(): boolean {
  return getConfig().system.minimizeToTray
}
