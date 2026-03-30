import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getKiteLibraryDir,
  getKiteSkillsDir,
  getKiteAgentsDir,
  getKiteSpacesDir,
  migrateLegacyResourceDirs
} from '../kite-library.service'

describe('kite-library.service', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    cleanupDirs.length = 0
  })

  function setupConfigRoot(): { root: string; configDir: string } {
    const root = join(tmpdir(), `kite-library-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const configDir = join(root, '.kite')
    mkdirSync(configDir, { recursive: true })
    cleanupDirs.push(root)
    return { root, configDir }
  }

  it('resolves user-visible Kite library directories from config root', () => {
    const { root, configDir } = setupConfigRoot()

    expect(getKiteLibraryDir(configDir)).toBe(resolve(join(root, 'kite')))
    expect(getKiteSkillsDir(configDir)).toBe(resolve(join(root, 'kite', 'Skills')))
    expect(getKiteAgentsDir(configDir)).toBe(resolve(join(root, 'kite', 'Agents')))
    expect(getKiteSpacesDir(configDir)).toBe(resolve(join(root, 'kite', 'Spaces')))
  })

  it('migrates legacy ~/.kite skills and agents into the new Kite library once', () => {
    const { configDir } = setupConfigRoot()
    const legacySkillDir = join(configDir, 'skills', 'review')
    const legacyAgentsDir = join(configDir, 'agents')
    mkdirSync(legacySkillDir, { recursive: true })
    mkdirSync(legacyAgentsDir, { recursive: true })
    writeFileSync(join(legacySkillDir, 'SKILL.md'), '# review\n', 'utf-8')
    writeFileSync(join(legacyAgentsDir, 'reviewer.md'), '# reviewer\n', 'utf-8')

    migrateLegacyResourceDirs(configDir)

    expect(existsSync(join(getKiteSkillsDir(configDir), 'review', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(getKiteAgentsDir(configDir), 'reviewer.md'))).toBe(true)
    expect(existsSync(join(configDir, 'skills.legacy-backup'))).toBe(true)
    expect(existsSync(join(configDir, 'agents.legacy-backup'))).toBe(true)

    const markerPath = join(configDir, 'resource-library-migration.v1.json')
    expect(existsSync(markerPath)).toBe(true)
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as { schemaVersion: number }
    expect(marker.schemaVersion).toBe(1)

    migrateLegacyResourceDirs(configDir)
    expect(existsSync(join(getKiteSkillsDir(configDir), 'review', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(getKiteAgentsDir(configDir), 'reviewer.md'))).toBe(true)
  })
})
