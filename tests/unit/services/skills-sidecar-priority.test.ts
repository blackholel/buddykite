import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn()
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      plugins: {
        globalPaths: []
      }
    }
  }))
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => [])
}))

import { getLockedUserConfigRootDir } from '../../../src/main/services/config-source-mode.service'
import { listEnabledPlugins } from '../../../src/main/services/plugins.service'
import { getKiteSkillsDir } from '../../../src/main/services/kite-library.service'
import { clearSkillsCache, getSkillDefinition, listSkills } from '../../../src/main/services/skills.service'

describe('skills sidecar priority', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-skill-sidecar-'))

  afterEach(() => {
    vi.mocked(listEnabledPlugins).mockReturnValue([])
    clearSkillsCache()
  })

  it('prefers frontmatter locale over sidecar default locale', () => {
    vi.mocked(getLockedUserConfigRootDir).mockReturnValue(tempRoot)

    const skillDir = path.join(getKiteSkillsDir(tempRoot), 'demo-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: Demo Skill',
      'name_zh-CN: 演示技能',
      'description: Demo Description',
      'description_zh-CN: 演示描述',
      '---',
      '# Body'
    ].join('\n'))

    const sidecarPath = path.join(tempRoot, 'i18n', 'resource-display.i18n.json')
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true })
    fs.writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      defaultLocale: 'en',
      resources: {
        skills: {
          'demo-skill': {
            title: { en: 'Sidecar English Title' },
            description: { en: 'Sidecar English Description' }
          }
        }
      }
    }, null, 2))

    const skills = listSkills(undefined, 'extensions', 'zh-CN')
    expect(skills).toHaveLength(1)
    expect(skills[0].displayNameLocalized).toBe('演示技能')
    expect(skills[0].descriptionLocalized).toBe('演示描述')
    expect(skills[0].displayNameBase).toBe('Demo Skill')
    expect(skills[0].descriptionBase).toBe('Demo Description')
  })

  it('loads space sidecar from <workDir>/.claude/i18n', () => {
    const emptyAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-app-root-'))
    vi.mocked(getLockedUserConfigRootDir).mockReturnValue(emptyAppRoot)

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-space-sidecar-'))
    const skillDir = path.join(workDir, '.claude', 'skills', 'space-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: Space Skill',
      'description: Space Description',
      '---',
      '# Body'
    ].join('\n'))

    const sidecarPath = path.join(workDir, '.claude', 'i18n', 'resource-display.i18n.json')
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true })
    fs.writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      defaultLocale: 'en',
      resources: {
        skills: {
          'space-skill': {
            title: { en: 'Space Skill', 'zh-CN': '空间技能' },
            description: { en: 'Space Description', 'zh-CN': '空间描述' }
          }
        }
      }
    }, null, 2))

    const skills = listSkills(workDir, 'extensions', 'zh-CN')
    expect(skills).toHaveLength(1)
    expect(skills[0].displayNameLocalized).toBe('空间技能')
    expect(skills[0].descriptionLocalized).toBe('空间描述')
    expect(skills[0].displayNameBase).toBe('Space Skill')
    expect(skills[0].descriptionBase).toBe('Space Description')
  })

  it('runtime lookup should not consume localized displayName', () => {
    vi.mocked(getLockedUserConfigRootDir).mockReturnValue(tempRoot)

    const skillDir = path.join(getKiteSkillsDir(tempRoot), 'brainstorming')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: Brainstorming',
      'description: Ideation helper',
      '---',
      '# Body'
    ].join('\n'))

    const sidecarPath = path.join(tempRoot, 'i18n', 'resource-display.i18n.json')
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true })
    fs.writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      defaultLocale: 'en',
      resources: {
        skills: {
          brainstorming: {
            title: { 'zh-CN': '头脑风暴' }
          }
        }
      }
    }, null, 2))

    const byAlias = getSkillDefinition('头脑风暴', undefined, { locale: 'zh-CN' })
    expect(byAlias).toBeNull()
  })

  it('resolves plugin skill by localized alias and namespaced alias', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-app-root-empty-'))
    vi.mocked(getLockedUserConfigRootDir).mockReturnValue(appRoot)

    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kite-plugin-superpowers-'))
    vi.mocked(listEnabledPlugins).mockReturnValue([
      {
        name: 'superpowers',
        installPath: pluginRoot
      } as any
    ])

    const skillDir = path.join(pluginRoot, 'skills', 'brainstorming')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: Brainstorming',
      'triggers:',
      '  - 头脑风暴',
      '---',
      '# Body'
    ].join('\n'))

    const byAlias = getSkillDefinition('头脑风暴', undefined, { locale: 'zh-CN' })
    expect(byAlias?.name).toBe('brainstorming')
    expect(byAlias?.namespace).toBe('superpowers')

    const byNamespacedAlias = getSkillDefinition('superpowers:头脑风暴', undefined, { locale: 'zh-CN' })
    expect(byNamespacedAlias?.name).toBe('brainstorming')
    expect(byNamespacedAlias?.namespace).toBe('superpowers')
  })
})
