import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockGetLockedUserConfigRootDir } = vi.hoisted(() => ({
  mockGetLockedUserConfigRootDir: vi.fn()
}))

vi.mock('../config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: mockGetLockedUserConfigRootDir
}))

vi.mock('../config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      agents: { paths: [] }
    }
  }))
}))

vi.mock('../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../space.service', () => ({
  getAllSpacePaths: vi.fn(() => [])
}))

vi.mock('../resource-exposure.service', () => ({
  filterByResourceExposure: vi.fn((items: unknown[]) => items),
  resolveResourceExposure: vi.fn(() => 'public')
}))

import { getKiteAgentsDir } from '../kite-library.service'
import { clearAgentsCache, listAgents } from '../agents.service'

describe('agents library source', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    cleanupDirs.length = 0
    clearAgentsCache()
    mockGetLockedUserConfigRootDir.mockReset()
  })

  function setupUserRoot(): string {
    const root = join(tmpdir(), `kite-agents-source-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const configRoot = join(root, '.kite')
    mkdirSync(configRoot, { recursive: true })
    cleanupDirs.push(root)
    mockGetLockedUserConfigRootDir.mockReturnValue(configRoot)
    return configRoot
  }

  it('defaults user library agents to enabled when no state exists', () => {
    const configRoot = setupUserRoot()
    const agentsDir = getKiteAgentsDir(configRoot)
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(agentsDir, 'reviewer.md'), '# reviewer\n', 'utf-8')

    const resources = listAgents(undefined, 'extensions')
    expect(resources.find((item) => item.name === 'reviewer')?.enabled).toBe(true)
  })

  it('applies disabled state from resource-library-state.json', () => {
    const configRoot = setupUserRoot()
    const agentsDir = getKiteAgentsDir(configRoot)
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(agentsDir, 'reviewer.md'), '# reviewer\n', 'utf-8')
    writeFileSync(join(configRoot, 'resource-library-state.json'), JSON.stringify({
      schemaVersion: 1,
      resources: {
        'agent:app:reviewer': { enabled: false, updatedAt: '2026-03-30T00:00:00.000Z' }
      }
    }, null, 2), 'utf-8')

    const resources = listAgents(undefined, 'extensions')
    expect(resources.find((item) => item.name === 'reviewer')?.enabled).toBe(false)
  })
})
