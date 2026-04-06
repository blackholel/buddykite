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
      plugins: { globalPaths: [] }
    }
  }))
}))

vi.mock('../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../space.service', () => ({
  getAllSpacePaths: vi.fn(() => [])
}))

import { getKiteSkillsDir } from '../kite-library.service'
import { clearSkillsCache, listSkills } from '../skills.service'

describe('skills library source', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    cleanupDirs.length = 0
    clearSkillsCache()
    mockGetLockedUserConfigRootDir.mockReset()
  })

  function setupUserRoot(): string {
    const root = join(tmpdir(), `kite-skills-source-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const configRoot = join(root, '.kite')
    mkdirSync(configRoot, { recursive: true })
    cleanupDirs.push(root)
    mockGetLockedUserConfigRootDir.mockReturnValue(configRoot)
    return configRoot
  }

  it('defaults user library skills to enabled when no state exists', () => {
    const configRoot = setupUserRoot()
    const skillDir = join(getKiteSkillsDir(configRoot), 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# review\n', 'utf-8')

    const resources = listSkills(undefined, 'extensions')
    expect(resources.find((item) => item.name === 'review')?.enabled).toBe(true)
  })

  it('applies disabled state from resource-library-state.json', () => {
    const configRoot = setupUserRoot()
    const skillDir = join(getKiteSkillsDir(configRoot), 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# review\n', 'utf-8')
    writeFileSync(join(configRoot, 'resource-library-state.json'), JSON.stringify({
      schemaVersion: 1,
      resources: {
        'skill:app:review': { enabled: false, updatedAt: '2026-03-30T00:00:00.000Z' }
      }
    }, null, 2), 'utf-8')

    const resources = listSkills(undefined, 'extensions')
    expect(resources.find((item) => item.name === 'review')?.enabled).toBe(false)
  })

  it('loads skills under non-English locale without dropping entries', () => {
    const configRoot = setupUserRoot()
    const skillDir = join(getKiteSkillsDir(configRoot), 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# review\n', 'utf-8')

    const resources = listSkills(undefined, 'extensions', 'zh-CN')
    expect(resources.find((item) => item.name === 'review')).toBeTruthy()
  })
})
