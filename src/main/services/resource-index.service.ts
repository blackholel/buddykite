import { createHash } from 'crypto'
import { statSync } from 'fs'
import { join } from 'path'
import { getAllSpacePaths } from './space.service'
import { listSkills } from './skills.service'
import { listAgents } from './agents.service'
import { getResourceDisplayI18nIndexEntries } from './resource-display-i18n.service'
import type { ResourceIndexSnapshot, ResourceRefreshReason } from '../../shared/resource-access'

const GLOBAL_INDEX_KEY = '__global__'
const DEFAULT_REASON: ResourceRefreshReason = 'manual-refresh'
const snapshots = new Map<string, ResourceIndexSnapshot>()

function toIndexKey(workDir?: string): string {
  return workDir || GLOBAL_INDEX_KEY
}

function safeFingerprint(path: string): string {
  try {
    const stats = statSync(path)
    return `${Math.trunc(stats.mtimeMs)}:${stats.size}`
  } catch {
    return '0:0'
  }
}

function safeSkillFingerprint(skillPath: string): string {
  const fileFingerprint = safeFingerprint(join(skillPath, 'SKILL.md'))
  if (fileFingerprint !== '0:0') {
    return fileFingerprint
  }
  return safeFingerprint(skillPath)
}

function buildHash(entries: string[]): string {
  const hash = createHash('sha256')
  for (const entry of [...entries].sort((a, b) => a.localeCompare(b))) {
    hash.update(entry)
    hash.update('\n')
  }
  return hash.digest('hex')
}

export function rebuildResourceIndex(
  workDir?: string,
  reason: ResourceRefreshReason = DEFAULT_REASON
): ResourceIndexSnapshot {
  const skills = listSkills(workDir, 'taxonomy-admin')
  const agents = listAgents(workDir, 'taxonomy-admin')

  const entries: string[] = [
    ...skills.map((item) => `skill:${item.source}:${item.namespace || ''}:${item.name}:${item.path}:${item.enabled !== false ? '1' : '0'}:${safeSkillFingerprint(item.path)}`),
    ...agents.map((item) => `agent:${item.source}:${item.namespace || ''}:${item.name}:${item.path}:${item.enabled !== false ? '1' : '0'}:${safeFingerprint(item.path)}`),
    ...getResourceDisplayI18nIndexEntries(workDir)
  ]

  const snapshot: ResourceIndexSnapshot = {
    hash: buildHash(entries),
    generatedAt: new Date().toISOString(),
    reason,
    counts: {
      skills: skills.length,
      agents: agents.length
    }
  }

  snapshots.set(toIndexKey(workDir), snapshot)
  return snapshot
}

export function rebuildAllResourceIndexes(reason: ResourceRefreshReason = DEFAULT_REASON): void {
  rebuildResourceIndex(undefined, reason)
  for (const workDir of getAllSpacePaths()) {
    rebuildResourceIndex(workDir, reason)
  }
}

export function getResourceIndexSnapshot(workDir?: string): ResourceIndexSnapshot {
  const key = toIndexKey(workDir)
  const cached = snapshots.get(key)
  if (cached) return cached
  return rebuildResourceIndex(workDir, DEFAULT_REASON)
}

export function getResourceIndexHash(workDir?: string): string {
  return getResourceIndexSnapshot(workDir).hash
}

export function clearResourceIndexSnapshot(workDir?: string | null): void {
  if (workDir === null || workDir === undefined) {
    snapshots.clear()
    return
  }
  snapshots.delete(toIndexKey(workDir))
}
