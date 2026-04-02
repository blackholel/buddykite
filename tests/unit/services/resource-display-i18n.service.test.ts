import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileContents = new Map<string, string>()
const fileStats = new Map<string, { mtimeMs: number; size: number }>()

vi.mock('fs', () => ({
  existsSync: vi.fn((filePath: string) => fileContents.has(filePath)),
  readFileSync: vi.fn((filePath: string) => {
    const content = fileContents.get(filePath)
    if (content == null) throw new Error(`ENOENT: ${filePath}`)
    return content
  }),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn((filePath: string, content: string) => {
    fileContents.set(filePath, content)
    fileStats.set(filePath, { mtimeMs: Date.now(), size: content.length })
  }),
  statSync: vi.fn((filePath: string) => {
    const stat = fileStats.get(filePath)
    if (!stat) throw new Error(`ENOENT: ${filePath}`)
    return stat
  })
}))

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => '/home/test/.kite')
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      plugins: {
        globalPaths: ['/opt/shared-tools']
      },
      agents: {
        paths: ['/opt/agent-packs']
      }
    }
  }))
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [
    { installPath: '/home/test/.kite/plugins/superpowers' },
    { installPath: '/home/test/.kite/plugins/everything-claude-code' }
  ])
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => ['/workspace/project-a'])
}))

import {
  clearResourceDisplayI18nCache,
  getResourceDisplayI18nIndexEntries,
  getResourceDisplayI18nRoots,
  getResourceDisplayI18nSidecarPaths,
  getResourceDisplayTranslationCacheInfo,
  resolveResourceDisplayOverride,
  upsertResourceDisplayTranslation
} from '../../../src/main/services/resource-display-i18n.service'

function putSidecar(path: string, data: unknown, mtimeMs = 1_700_000_000_000): void {
  const content = JSON.stringify(data)
  fileContents.set(path, content)
  fileStats.set(path, { mtimeMs, size: content.length })
}

describe('resource-display-i18n.service', () => {
  beforeEach(() => {
    fileContents.clear()
    fileStats.clear()
    clearResourceDisplayI18nCache()
  })

  it('collects roots from app/global/plugin/space', () => {
    const roots = getResourceDisplayI18nRoots().map((item) => item.rootPath)

    expect(roots).toContain('/home/test/.kite')
    expect(roots).toContain('/opt/shared-tools')
    expect(roots).toContain('/opt/agent-packs')
    expect(roots).toContain('/home/test/.kite/plugins/superpowers')
    expect(roots).toContain('/home/test/.kite/plugins/everything-claude-code')
    expect(roots).toContain('/workspace/project-a/.claude')
  })

  it('resolves locale-specific and default values from sidecar', () => {
    const sidecarPath = '/home/test/.kite/i18n/resource-display.i18n.json'
    putSidecar(sidecarPath, {
      version: 1,
      defaultLocale: 'en',
      resources: {
        skills: {
          'demo-skill': {
            title: { en: 'Demo skill', 'zh-CN': '演示技能' },
            description: { en: 'Run checks', 'zh-CN': '执行检查' }
          }
        }
      }
    })

    const localized = resolveResourceDisplayOverride('/home/test/.kite', 'skill', 'demo-skill', 'zh-CN')
    expect(localized.titleLocale).toBe('演示技能')
    expect(localized.descriptionLocale).toBe('执行检查')

    const fallback = resolveResourceDisplayOverride('/home/test/.kite', 'skill', 'demo-skill', 'fr-FR')
    expect(fallback.titleLocale).toBeUndefined()
    expect(fallback.titleDefault).toBe('Demo skill')
    expect(fallback.descriptionDefault).toBe('Run checks')
  })

  it('returns sidecar paths by scope', () => {
    const globalPaths = getResourceDisplayI18nSidecarPaths()
    const scopedPaths = getResourceDisplayI18nSidecarPaths('/workspace/project-a')

    expect(globalPaths).toContain('/home/test/.kite/i18n/resource-display.i18n.json')
    expect(globalPaths).not.toContain('/workspace/project-a/.claude/i18n/resource-display.i18n.json')
    expect(scopedPaths).toContain('/workspace/project-a/.claude/i18n/resource-display.i18n.json')
  })

  it('builds index entries with sidecar signatures', () => {
    putSidecar('/home/test/.kite/i18n/resource-display.i18n.json', {
      version: 1,
      resources: { skills: {} }
    }, 1_700_000_000_123)

    const entries = getResourceDisplayI18nIndexEntries()
    expect(entries.some(entry => entry.includes('display-i18n:/home/test/.kite/i18n/resource-display.i18n.json:1700000000123'))).toBe(true)
  })

  it('upsert: 缺失 locale 时写入翻译并记录 sourceTextHash', () => {
    const wrote = upsertResourceDisplayTranslation({
      rootPath: '/home/test/.kite',
      type: 'skill',
      resourceKey: 'demo-skill',
      locale: 'zh-CN',
      sourceTextHash: 'hash-v1',
      title: '演示技能',
      description: '执行检查'
    })

    expect(wrote).toBe(true)
    const info = getResourceDisplayTranslationCacheInfo({
      rootPath: '/home/test/.kite',
      type: 'skill',
      resourceKey: 'demo-skill',
      locale: 'zh-CN'
    })
    expect(info.titleLocale).toBe('演示技能')
    expect(info.descriptionLocale).toBe('执行检查')
    expect(info.titleSourceTextHash).toBe('hash-v1')
    expect(info.descriptionSourceTextHash).toBe('hash-v1')
  })

  it('upsert: 手工翻译（无 auto hash）不会被覆盖', () => {
    putSidecar('/home/test/.kite/i18n/resource-display.i18n.json', {
      version: 1,
      resources: {
        skills: {
          'demo-skill': {
            title: { 'zh-CN': '手工标题' },
            description: { 'zh-CN': '手工描述' }
          }
        }
      }
    })

    const wrote = upsertResourceDisplayTranslation({
      rootPath: '/home/test/.kite',
      type: 'skill',
      resourceKey: 'demo-skill',
      locale: 'zh-CN',
      sourceTextHash: 'hash-v2',
      title: '自动标题',
      description: '自动描述'
    })

    expect(wrote).toBe(false)
    const info = getResourceDisplayTranslationCacheInfo({
      rootPath: '/home/test/.kite',
      type: 'skill',
      resourceKey: 'demo-skill',
      locale: 'zh-CN'
    })
    expect(info.titleLocale).toBe('手工标题')
    expect(info.descriptionLocale).toBe('手工描述')
  })

  it('upsert: 允许覆盖无 hash 的旧占位文案', () => {
    putSidecar('/home/test/.kite/i18n/resource-display.i18n.json', {
      version: 1,
      resources: {
        skills: {
          'demo-skill': {
            title: { 'zh-CN': 'Code Review' },
            description: { 'zh-CN': 'Checks code quality' }
          }
        }
      }
    })

    const wrote = upsertResourceDisplayTranslation({
      rootPath: '/home/test/.kite',
      type: 'skill',
      resourceKey: 'demo-skill',
      locale: 'zh-CN',
      sourceTextHash: 'hash-v3',
      title: '代码审查',
      description: '用于检查代码质量',
      allowOverwriteTitleWithoutHash: true,
      allowOverwriteDescriptionWithoutHash: true
    })

    expect(wrote).toBe(true)
    const info = getResourceDisplayTranslationCacheInfo({
      rootPath: '/home/test/.kite',
      type: 'skill',
      resourceKey: 'demo-skill',
      locale: 'zh-CN'
    })
    expect(info.titleLocale).toBe('代码审查')
    expect(info.descriptionLocale).toBe('用于检查代码质量')
    expect(info.titleSourceTextHash).toBe('hash-v3')
    expect(info.descriptionSourceTextHash).toBe('hash-v3')
  })
})
