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
const outputDir = join(projectRoot, 'build', 'default-kite-config')
const packageJsonPath = join(projectRoot, 'package.json')
const installPathTemplate = '__KITE_ROOT__'
const secretKeyPattern = /(key|token|secret|password)/i
const seedStateFileName = '.seed-state.json'
const ignoredRootEntries = new Set([
  seedStateFileName
])

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

  delete sanitized.analytics

  if (sanitized.claudeCode && typeof sanitized.claudeCode === 'object') {
    if (sanitized.claudeCode.plugins && typeof sanitized.claudeCode.plugins === 'object') {
      delete sanitized.claudeCode.plugins.globalPaths
    }
    if (sanitized.claudeCode.agents && typeof sanitized.claudeCode.agents === 'object') {
      delete sanitized.claudeCode.agents.paths
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
    if (!Array.isArray(installations)) continue

    const validInstallations = installations
      .filter((installation) => installation && typeof installation === 'object')
      .map((installation) => {
        const installPath = typeof installation.installPath === 'string'
          ? resolve(installation.installPath)
          : null
        if (!installPath || !isPathInside(sourcePluginsDir, installPath)) return null
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
    const settings = sanitizeSecrets(readJson(sourcePath))
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

  if (relativePath.endsWith('.json')) {
    const handled = sanitizeGenericJsonFile(sourcePath, targetPath)
    if (handled) return
  }

  copyFileSync(sourcePath, targetPath)
}

function copyAllSeedEntries() {
  const copied = []
  // 全量遍历 .kite，除了根目录里明确忽略的元数据文件
  const walk = (currentSourceDir, currentTargetDir, currentRelativeDir = '') => {
    mkdirSync(currentTargetDir, { recursive: true })
    for (const entry of readdirSync(currentSourceDir, { withFileTypes: true })) {
      if (currentRelativeDir === '' && ignoredRootEntries.has(entry.name)) continue

      const sourcePath = join(currentSourceDir, entry.name)
      const targetPath = join(currentTargetDir, entry.name)
      const relativePath = currentRelativeDir ? `${currentRelativeDir}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        walk(sourcePath, targetPath, relativePath)
        continue
      }

      if (!entry.isFile()) continue
      copySeedFile(sourcePath, targetPath, relativePath)
    }
  }

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (ignoredRootEntries.has(entry.name)) continue
    copied.push(entry.name)
  }

  walk(sourceDir, outputDir)
  return copied
}

function finalizeSeedSettingsEnabledPlugins(targetRootDir) {
  const registryPath = join(targetRootDir, 'plugins', 'installed_plugins.json')
  const settingsPath = join(targetRootDir, 'settings.json')
  const registry = readJson(registryPath)
  const settings = readJson(settingsPath)

  if (!isPlainObject(registry) || !isPlainObject(settings)) return

  const plugins = isPlainObject(registry.plugins) ? registry.plugins : {}
  const pluginNames = Object.keys(plugins)
  if (pluginNames.length === 0) return

  const enabledPlugins = isPlainObject(settings.enabledPlugins)
    ? { ...settings.enabledPlugins }
    : {}

  let changed = !isPlainObject(settings.enabledPlugins)
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
