import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listSkills: vi.fn(),
    getSkillContent: vi.fn(),
    createSkill: vi.fn(),
    createSkillInLibrary: vi.fn(),
    setSkillEnabled: vi.fn(),
    deleteSkillFromLibrary: vi.fn(),
    clearSkillsCache: vi.fn()
  }
}))

vi.mock('../../api', () => ({
  api: mockApi
}))

vi.mock('../../i18n', () => ({
  default: {
    language: 'zh-CN'
  }
}))

import { useSkillsStore, type SkillDefinition } from '../skills.store'
import { GLOBAL_CACHE_KEY, getCacheKey } from '../cache-keys'

const LOCALE_GLOBAL_CACHE_KEY = getCacheKey(undefined, 'zh-CN')

function resetStore(): void {
  useSkillsStore.setState({
    skills: [],
    loadedWorkDir: null,
    loadedLocale: null,
    selectedSkill: null,
    skillContent: null,
    skillsByWorkDir: {},
    dirtyWorkDirs: new Set<string | symbol>(),
    isLoading: false,
    isLoadingContent: false,
    searchQuery: '',
    error: null,
    lastRefreshReason: null,
    lastRefreshTs: null
  })
}

describe('skills.store library contracts', () => {
  beforeEach(() => {
    resetStore()
    Object.values(mockApi).forEach((fn) => fn.mockReset())
    mockApi.listSkills.mockResolvedValue({ success: true, data: [] })
    mockApi.createSkill.mockResolvedValue({ success: true, data: null })
    mockApi.createSkillInLibrary.mockResolvedValue({ success: true, data: null })
    mockApi.setSkillEnabled.mockResolvedValue({ success: true, data: true })
    mockApi.deleteSkillFromLibrary.mockResolvedValue({ success: true, data: true })
    mockApi.clearSkillsCache.mockResolvedValue({ success: true })
  })

  it('loadSkills 读取全集资源并保留 enabled 字段', async () => {
    const payload: SkillDefinition[] = [
      {
        name: 'review',
        path: '/tmp/review',
        source: 'app',
        enabled: false,
      },
      {
        name: 'lint',
        path: '/tmp/lint',
        source: 'app',
        enabled: true,
      }
    ]
    mockApi.listSkills.mockResolvedValueOnce({ success: true, data: payload })

    await useSkillsStore.getState().loadSkills()

    const state = useSkillsStore.getState()
    expect(state.skills).toHaveLength(2)
    expect(state.skills.find((item) => item.name === 'review')?.enabled).toBe(false)
    expect(state.skills.find((item) => item.name === 'lint')?.enabled).toBe(true)
    expect(state.loadedWorkDir).toBeNull()
  })

  it('toggleSkillEnabled 会局部更新当前缓存', async () => {
    const seeded: SkillDefinition = {
      name: 'review',
      path: '/tmp/review',
      source: 'app',
      enabled: true,
    }
    useSkillsStore.setState({
      skills: [seeded],
      skillsByWorkDir: {
        [GLOBAL_CACHE_KEY]: [seeded]
      }
    })

    const ok = await useSkillsStore.getState().toggleSkillEnabled(seeded)

    expect(ok).toBe(true)
    expect(mockApi.setSkillEnabled).toHaveBeenCalledWith({
      source: 'app',
      name: 'review',
      namespace: undefined,
      enabled: false
    })
    expect(useSkillsStore.getState().skills[0].enabled).toBe(false)
  })

  it('createSkillInLibrary 不依赖 workDir', async () => {
    const created: SkillDefinition = {
      name: 'planner',
      path: '/tmp/kite/Skills/planner',
      source: 'app',
      enabled: true,
    }
    mockApi.createSkillInLibrary.mockResolvedValueOnce({ success: true, data: created })

    const result = await useSkillsStore.getState().createSkillInLibrary('planner', '# planner')

    expect(result?.name).toBe('planner')
    expect(mockApi.createSkillInLibrary).toHaveBeenCalledWith('planner', '# planner')
    expect(mockApi.listSkills).toHaveBeenCalledWith(undefined, 'zh-CN', 'extensions')
    expect(useSkillsStore.getState().loadedWorkDir).toBeNull()
    expect(useSkillsStore.getState().skills.some((item) => item.name === 'planner')).toBe(true)
  })

  it('createSkill 成功后会触发后台扫描以启动翻译队列', async () => {
    const created: SkillDefinition = {
      name: 'space-review',
      path: '/tmp/space/.claude/skills/space-review',
      source: 'space',
      enabled: true,
    }
    mockApi.createSkill.mockResolvedValueOnce({ success: true, data: created })

    const result = await useSkillsStore.getState().createSkill('/tmp/space', 'space-review', '# space-review')

    expect(result?.name).toBe('space-review')
    expect(mockApi.createSkill).toHaveBeenCalledWith('/tmp/space', 'space-review', '# space-review')
    expect(mockApi.listSkills).toHaveBeenCalledWith('/tmp/space', 'zh-CN', 'extensions')
  })

  it('createSkillInLibrary 在缺少全局缓存时不复用 space 列表', async () => {
    const spaceSkill: SkillDefinition = {
      name: 'space-only',
      path: '/tmp/space/.claude/skills/space-only',
      source: 'space',
      enabled: true,
    }
    const created: SkillDefinition = {
      name: 'library-only',
      path: '/tmp/kite/Skills/library-only',
      source: 'app',
      enabled: true,
    }
    useSkillsStore.setState({
      loadedWorkDir: '/tmp/space',
      skills: [spaceSkill],
      skillsByWorkDir: {}
    })
    mockApi.createSkillInLibrary.mockResolvedValueOnce({ success: true, data: created })

    await useSkillsStore.getState().createSkillInLibrary('library-only', '# library-only')

    const state = useSkillsStore.getState()
    expect(state.loadedWorkDir).toBeNull()
    expect(state.skills).toEqual([created])
    expect(state.skillsByWorkDir[LOCALE_GLOBAL_CACHE_KEY]).toEqual([created])
  })

  it('deleteSkillFromLibrary 会更新当前列表缓存', async () => {
    const seeded: SkillDefinition = {
      name: 'obsolete',
      path: '/tmp/kite/Skills/obsolete',
      source: 'app',
      enabled: true,
    }
    useSkillsStore.setState({
      skills: [seeded],
      skillsByWorkDir: {
        [GLOBAL_CACHE_KEY]: [seeded]
      },
      selectedSkill: seeded
    })

    const ok = await useSkillsStore.getState().deleteSkillFromLibrary(seeded.path)

    expect(ok).toBe(true)
    expect(mockApi.deleteSkillFromLibrary).toHaveBeenCalledWith(seeded.path)
    expect(useSkillsStore.getState().skills).toHaveLength(0)
    expect(useSkillsStore.getState().selectedSkill).toBeNull()
  })
})
