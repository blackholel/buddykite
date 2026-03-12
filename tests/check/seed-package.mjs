#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const SEED_DIR = path.join(PROJECT_ROOT, 'build', 'default-kite-config')
const MAX_MB = Number.parseFloat(process.env.KITE_SEED_MAX_MB || '120')

const ALLOWED_ROOT_ENTRIES = new Set([
  'config.json',
  'settings.json',
  'plugins',
  'skills',
  'agents',
  'commands',
  'i18n',
  'taxonomy',
  'rules',
  'spaces-index.json',
  'seed-manifest.json'
])

const FORBIDDEN_SEGMENTS = new Set([
  'instances',
  'temp',
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
const EXCLUDED_PLUGIN_FULL_NAME = 'everything-claude-code@everything-claude-code'
const EXCLUDED_PLUGIN_NAME = 'everything-claude-code'

function normalizePath(p) {
  return p.split(path.sep).join('/')
}

function getDirectorySizeBytes(dirPath) {
  let total = 0
  const queue = [dirPath]

  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) continue
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
        continue
      }
      if (entry.isFile()) {
        total += fs.statSync(fullPath).size
      }
    }
  }

  return total
}

function collectViolations(seedDir) {
  const violations = []

  const rootEntries = fs.readdirSync(seedDir, { withFileTypes: true })
  for (const entry of rootEntries) {
    if (!ALLOWED_ROOT_ENTRIES.has(entry.name)) {
      violations.push(`Unexpected root entry: ${entry.name}`)
    }
  }

  const queue = [{ dir: seedDir, rel: '' }]
  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) continue

    const entries = fs.readdirSync(current.dir, { withFileTypes: true })
    for (const entry of entries) {
      const relPath = current.rel ? `${current.rel}/${entry.name}` : entry.name
      const normalized = normalizePath(relPath)
      const segments = normalized.split('/').filter(Boolean)

      if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
        violations.push(`Forbidden path segment in seed: ${normalized}`)
      }
      if (entry.name === '.DS_Store') {
        violations.push(`Forbidden file in seed: ${normalized}`)
      }
      if (entry.isFile() && entry.name.endsWith('.log')) {
        violations.push(`Forbidden log file in seed: ${normalized}`)
      }

      if (entry.isDirectory()) {
        queue.push({ dir: path.join(current.dir, entry.name), rel: relPath })
      }
    }
  }

  return violations
}

function collectExcludedPluginViolations(seedDir) {
  const violations = []
  const excludedPluginDir = path.join(seedDir, 'plugins', EXCLUDED_PLUGIN_NAME)
  if (fs.existsSync(excludedPluginDir)) {
    violations.push(`Excluded plugin directory should not exist in seed: plugins/${EXCLUDED_PLUGIN_NAME}`)
  }

  const settingsPath = path.join(seedDir, 'settings.json')
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const enabledPlugins = settings?.enabledPlugins
    if (enabledPlugins && typeof enabledPlugins === 'object' && enabledPlugins[EXCLUDED_PLUGIN_FULL_NAME] !== undefined) {
      violations.push(`Excluded plugin should not appear in settings enabledPlugins: ${EXCLUDED_PLUGIN_FULL_NAME}`)
    }
  }

  const registryPath = path.join(seedDir, 'plugins', 'installed_plugins.json')
  if (fs.existsSync(registryPath)) {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
    const plugins = registry?.plugins
    if (plugins && typeof plugins === 'object' && plugins[EXCLUDED_PLUGIN_FULL_NAME] !== undefined) {
      violations.push(`Excluded plugin should not appear in installed_plugins.json: ${EXCLUDED_PLUGIN_FULL_NAME}`)
    }
  }

  const configPath = path.join(seedDir, 'config.json')
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const plugins = Array.isArray(config?.plugins) ? config.plugins : []
    const matched = plugins.some((plugin) => plugin?.name === EXCLUDED_PLUGIN_NAME)
    if (matched) {
      violations.push(`Excluded plugin should not appear in config.json plugins: ${EXCLUDED_PLUGIN_NAME}`)
    }
  }

  const taxonomyPath = path.join(seedDir, 'taxonomy', 'resource-exposure.json')
  if (fs.existsSync(taxonomyPath)) {
    const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8'))
    const sections = [taxonomy?.resources, taxonomy?.commands, taxonomy?.skills, taxonomy?.agents]
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue
      for (const key of Object.keys(section)) {
        if (typeof key === 'string' && key.includes(EXCLUDED_PLUGIN_NAME)) {
          violations.push(`Excluded plugin should not appear in taxonomy resource exposure: ${key}`)
        }
      }
    }
  }

  return violations
}

if (!fs.existsSync(SEED_DIR)) {
  console.log(`[seed-check] skip: seed dir not found (${SEED_DIR})`)
  process.exit(0)
}

const violations = collectViolations(SEED_DIR)
violations.push(...collectExcludedPluginViolations(SEED_DIR))
const sizeBytes = getDirectorySizeBytes(SEED_DIR)
const sizeMb = sizeBytes / 1024 / 1024

if (sizeMb > MAX_MB) {
  violations.push(`Seed too large: ${sizeMb.toFixed(1)}MB > ${MAX_MB}MB`)
}

if (violations.length > 0) {
  console.error('[seed-check] FAILED')
  for (const violation of violations) {
    console.error(`[seed-check] ${violation}`)
  }
  process.exit(1)
}

console.log(`[seed-check] OK size=${sizeMb.toFixed(1)}MB limit=${MAX_MB}MB`)
process.exit(0)
