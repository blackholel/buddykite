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

if (!fs.existsSync(SEED_DIR)) {
  console.log(`[seed-check] skip: seed dir not found (${SEED_DIR})`)
  process.exit(0)
}

const violations = collectViolations(SEED_DIR)
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
