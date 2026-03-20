import { homedir } from 'os'
import { dirname, join, relative, resolve, sep } from 'path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')
const sourceDir = process.env.KITE_SEED_SOURCE_DIR
  ? resolve(process.env.KITE_SEED_SOURCE_DIR)
  : join(homedir(), '.kite')
const outputDir = process.env.KITE_SEED_OUTPUT_DIR
  ? resolve(process.env.KITE_SEED_OUTPUT_DIR)
  : join(projectRoot, 'build', 'default-kite-config')
const packageJsonPath = join(projectRoot, 'package.json')
const installPathTemplate = '__KITE_ROOT__'
const secretKeyPattern = /(key|token|secret|password)/i
const seedStateFileName = '.seed-state.json'
const allowedRootEntries = new Set([
  'config.json',
  'settings.json',
  'plugins',
  'skills',
  'agents',
  'commands',
  'i18n',
  'taxonomy',
  'rules',
  'spaces-index.json'
])
const ignoredRootEntries = new Set([
  seedStateFileName
])
const blockedRootEntries = new Set([
  'instances',
  'temp'
])
const blockedDirectoryNames = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  '.git',
  '.github',
  '.cursor',
  '.opencode',
  '.claude',
  '.codex'
])
const blockedFileNames = new Set([
  '.DS_Store'
])
const excludedPluginFullNames = new Set([
  'everything-claude-code@everything-claude-code'
])
const excludedPluginNames = new Set(
  Array.from(excludedPluginFullNames)
    .map((fullName) => fullName.split('@')[0]?.trim())
    .filter(Boolean)
)
const defaultPackagedMcpServers = {
  'chrome-devtools': {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'],
    disabled: false
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isPathInside(baseDir, targetPath) {
  const rel = relative(baseDir, targetPath)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`)
}

function normalizeRelativePathForMatch(relativePath) {
  return relativePath.split(sep).join('/')
}

function isExcludedPlugin(fullName) {
  return excludedPluginFullNames.has(fullName)
}

function shouldSkipPluginPathBySegments(segments) {
  if (segments.length < 2 || segments[0] !== 'plugins') return false
  for (const segment of segments.slice(1)) {
    if (excludedPluginNames.has(segment)) return true
  }
  return false
}

function shouldSkipSeedEntry(relativePath, isDirectoryEntry) {
  const normalizedPath = normalizeRelativePathForMatch(relativePath)
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length === 0) return false

  const rootEntry = segments[0]
  if (!allowedRootEntries.has(rootEntry)) return true
  if (ignoredRootEntries.has(rootEntry)) return true
  if (blockedRootEntries.has(rootEntry)) return true
  if (shouldSkipPluginPathBySegments(segments)) return true

  for (const segment of segments) {
    if (blockedDirectoryNames.has(segment)) return true
  }

  const fileName = segments[segments.length - 1]
  if (blockedFileNames.has(fileName)) return true
  if (!isDirectoryEntry && fileName.endsWith('.log')) return true
  return false
}

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    console.warn(`[Seed] Invalid JSON skipped: ${path}`, error)
    return null
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function deepFillMissing(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return target
  }

  const merged = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in merged)) {
      merged[key] = JSON.parse(JSON.stringify(value))
      continue
    }

    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = deepFillMissing(merged[key], value)
    }
  }

  return merged
}

function sanitizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const sanitized = sanitizeSecrets(JSON.parse(JSON.stringify(config)))

  // 不随安装包分发个人模型/API配置，避免敏感信息外泄
  delete sanitized.api
  delete sanitized.ai

  if (sanitized.mcpServers && typeof sanitized.mcpServers === 'object') {
    for (const server of Object.values(sanitized.mcpServers)) {
      if (server && typeof server === 'object') {
        server.env = {}
      }
    }
  }

  const mcpServers = isPlainObject(sanitized.mcpServers) ? sanitized.mcpServers : {}
  sanitized.mcpServers = deepFillMissing(mcpServers, defaultPackagedMcpServers)

  delete sanitized.analytics

  if (sanitized.claudeCode && typeof sanitized.claudeCode === 'object') {
    if (sanitized.claudeCode.plugins && typeof sanitized.claudeCode.plugins === 'object') {
      delete sanitized.claudeCode.plugins.globalPaths
    }
    if (sanitized.claudeCode.agents && typeof sanitized.claudeCode.agents === 'object') {
      delete sanitized.claudeCode.agents.paths
    }
  }

  if (Array.isArray(sanitized.plugins)) {
    sanitized.plugins = sanitized.plugins.filter((plugin) => {
      if (!plugin || typeof plugin !== 'object') return false
      if (typeof plugin.name === 'string' && excludedPluginNames.has(plugin.name)) return false
      if (typeof plugin.path === 'string') {
        const normalizedPath = plugin.path.split(/[\\/]+/).filter(Boolean)
        if (normalizedPath.some((segment) => excludedPluginNames.has(segment))) return false
      }
      return true
    })
  }

  return sanitized
}

function sanitizeSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const sanitized = sanitizeSecrets(JSON.parse(JSON.stringify(settings)))
  const enabledPlugins = sanitized.enabledPlugins
  if (enabledPlugins && typeof enabledPlugins === 'object' && !Array.isArray(enabledPlugins)) {
    for (const fullName of Object.keys(enabledPlugins)) {
      if (isExcludedPlugin(fullName)) {
        delete enabledPlugins[fullName]
      }
    }
  }
  return sanitized
}

function sanitizeSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSecrets(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) {
      result[key] = ''
      continue
    }
    result[key] = sanitizeSecrets(child)
  }
  return result
}

function sanitizePluginsRegistry(registry, sourcePluginsDir) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return null
  const sourcePlugins = registry.plugins
  if (!sourcePlugins || typeof sourcePlugins !== 'object' || Array.isArray(sourcePlugins)) {
    return {
      version: registry.version || 2,
      plugins: {}
    }
  }

  const sanitizedPlugins = {}
  for (const [fullName, installations] of Object.entries(sourcePlugins)) {
    if (isExcludedPlugin(fullName)) continue
    if (!Array.isArray(installations)) continue

    const validInstallations = installations
      .filter((installation) => installation && typeof installation === 'object')
      .map((installation) => {
        const installPath = typeof installation.installPath === 'string'
          ? resolve(installation.installPath)
          : null
        if (!installPath || !isPathInside(sourcePluginsDir, installPath) || !isDirectory(installPath)) return null
        const relPath = relative(sourcePluginsDir, installPath).split(sep).join('/')
        return {
          ...installation,
          installPath: `${installPathTemplate}/plugins/${relPath}`
        }
      })
      .filter(Boolean)

    if (validInstallations.length > 0) {
      sanitizedPlugins[fullName] = validInstallations
    }
  }

  return {
    version: registry.version || 2,
    plugins: sanitizedPlugins
  }
}

function sanitizeGenericJsonFile(sourcePath, targetPath) {
  const parsed = readJson(sourcePath)
  if (!parsed || typeof parsed !== 'object') return false

  writeJson(targetPath, sanitizeSecrets(parsed))
  return true
}

function containsExcludedPluginToken(value) {
  if (typeof value !== 'string') return false
  for (const pluginName of excludedPluginNames) {
    if (value.includes(pluginName)) return true
  }
  return false
}

function sanitizeResourceExposureFile(sourcePath, targetPath) {
  const parsed = readJson(sourcePath)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false

  const sanitized = sanitizeSecrets(JSON.parse(JSON.stringify(parsed)))
  const mapKeys = ['resources', 'commands', 'skills', 'agents']
  for (const key of mapKeys) {
    const section = sanitized[key]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    for (const entryKey of Object.keys(section)) {
      if (containsExcludedPluginToken(entryKey)) {
        delete section[entryKey]
      }
    }
  }

  writeJson(targetPath, sanitized)
  return true
}

function copySeedFile(sourcePath, targetPath, relativePath) {
  mkdirSync(dirname(targetPath), { recursive: true })

  if (relativePath === 'config.json') {
    const config = sanitizeConfig(readJson(sourcePath))
    if (config) {
      writeJson(targetPath, config)
      return
    }
    copyFileSync(sourcePath, targetPath)
    return
  }

  if (relativePath === 'settings.json') {
    const settings = sanitizeSettings(readJson(sourcePath))
    if (settings && typeof settings === 'object') {
      writeJson(targetPath, settings)
      return
    }
    copyFileSync(sourcePath, targetPath)
    return
  }

  if (relativePath === 'plugins/installed_plugins.json') {
    // 插件索引里的绝对安装路径改写成模板路径，避免把构建机路径打进包
    const sourcePluginsDir = join(sourceDir, 'plugins')
    const registry = sanitizePluginsRegistry(readJson(sourcePath), resolve(sourcePluginsDir))
    if (registry) {
      writeJson(targetPath, registry)
      return
    }
    copyFileSync(sourcePath, targetPath)
    return
  }

  if (relativePath === 'taxonomy/resource-exposure.json') {
    const handled = sanitizeResourceExposureFile(sourcePath, targetPath)
    if (handled) return
  }

  if (relativePath.endsWith('.json')) {
    const handled = sanitizeGenericJsonFile(sourcePath, targetPath)
    if (handled) return
  }

  copyFileSync(sourcePath, targetPath)
}

function copyAllSeedEntries() {
  const copiedRoots = new Set()
  // 仅复制运行必需的根目录白名单条目，并跳过缓存与构建机噪音文件
  const walk = (currentSourceDir, currentTargetDir, currentRelativeDir = '') => {
    mkdirSync(currentTargetDir, { recursive: true })
    for (const entry of readdirSync(currentSourceDir, { withFileTypes: true })) {
      const relativePath = currentRelativeDir ? `${currentRelativeDir}/${entry.name}` : entry.name
      const isDirectoryEntry = entry.isDirectory()
      if (shouldSkipSeedEntry(relativePath, isDirectoryEntry)) continue

      if (currentRelativeDir === '') {
        copiedRoots.add(entry.name)
      }

      const sourcePath = join(currentSourceDir, entry.name)
      const targetPath = join(currentTargetDir, entry.name)

      if (isDirectoryEntry) {
        walk(sourcePath, targetPath, relativePath)
        continue
      }

      if (!entry.isFile()) continue
      copySeedFile(sourcePath, targetPath, relativePath)
    }
  }

  walk(sourceDir, outputDir)
  return Array.from(copiedRoots)
}

function finalizeSeedSettingsEnabledPlugins(targetRootDir) {
  const registryPath = join(targetRootDir, 'plugins', 'installed_plugins.json')
  const settingsPath = join(targetRootDir, 'settings.json')
  const registry = readJson(registryPath)
  const settings = readJson(settingsPath)

  if (!isPlainObject(registry) || !isPlainObject(settings)) return

  const plugins = isPlainObject(registry.plugins) ? registry.plugins : {}
  const pluginNames = Object.keys(plugins).filter((fullName) => !isExcludedPlugin(fullName))
  if (pluginNames.length === 0) return

  const enabledPlugins = isPlainObject(settings.enabledPlugins)
    ? { ...settings.enabledPlugins }
    : {}

  let changed = !isPlainObject(settings.enabledPlugins)
  const pluginNameSet = new Set(pluginNames)
  for (const fullName of Object.keys(enabledPlugins)) {
    if (isExcludedPlugin(fullName) || !pluginNameSet.has(fullName)) {
      delete enabledPlugins[fullName]
      changed = true
    }
  }
  for (const fullName of pluginNames) {
    if (enabledPlugins[fullName] === undefined) {
      enabledPlugins[fullName] = true
      changed = true
    }
  }

  if (!changed) return

  settings.enabledPlugins = enabledPlugins
  writeJson(settingsPath, settings)
}

function assertSourceDirExists() {
  if (isDirectory(sourceDir)) {
    return
  }
  throw new Error(`[Seed] Source directory does not exist: ${sourceDir}`)
}

function writeManifest(copiedEntries) {
  const pkg = readJson(packageJsonPath) || {}
  const manifest = {
    schemaVersion: 1,
    appVersion: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    generatedAt: new Date().toISOString(),
    source: 'kite-user-home',
    copiedEntries
  }
  writeJson(join(outputDir, 'seed-manifest.json'), manifest)
}

function main() {
  assertSourceDirExists()
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })

  const copiedEntries = copyAllSeedEntries()
  finalizeSeedSettingsEnabledPlugins(outputDir)
  writeManifest(copiedEntries)

  console.log(`[Seed] Prepared built-in seed at: ${outputDir}`)
  console.log(`[Seed] Source: ${sourceDir}`)
  console.log(`[Seed] Copied entries: ${copiedEntries.length > 0 ? copiedEntries.join(', ') : '(none)'}`)
}

try {
  main()
} catch (error) {
  console.error('[Seed] Failed to prepare built-in seed:', error)
  process.exit(1)
}
