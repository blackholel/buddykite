import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listAgents: vi.fn(),
    getAgentContent: vi.fn(),
    createAgent: vi.fn(),
    createAgentInLibrary: vi.fn(),
    setAgentEnabled: vi.fn(),
    deleteAgentFromLibrary: vi.fn(),
    clearAgentsCache: vi.fn()
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

import { useAgentsStore, type AgentDefinition } from '../agents.store'
import { GLOBAL_CACHE_KEY, getCacheKey } from '../cache-keys'

const LOCALE_GLOBAL_CACHE_KEY = getCacheKey(undefined, 'zh-CN')

function resetStore(): void {
  useAgentsStore.setState({
    agents: [],
    loadedWorkDir: null,
    loadedLocale: null,
    selectedAgent: null,
    agentContent: null,
    agentsByWorkDir: {},
    dirtyWorkDirs: new Set<string | symbol>(),
    isLoading: false,
    isLoadingContent: false,
    searchQuery: '',
    error: null
  })
}

describe('agents.store library contracts', () => {
  beforeEach(() => {
    resetStore()
    Object.values(mockApi).forEach((fn) => fn.mockReset())
    mockApi.listAgents.mockResolvedValue({ success: true, data: [] })
    mockApi.createAgent.mockResolvedValue({ success: true, data: null })
    mockApi.createAgentInLibrary.mockResolvedValue({ success: true, data: null })
    mockApi.setAgentEnabled.mockResolvedValue({ success: true, data: true })
    mockApi.deleteAgentFromLibrary.mockResolvedValue({ success: true, data: true })
    mockApi.clearAgentsCache.mockResolvedValue({ success: true })
  })

  it('loadAgents 读取全集资源并保留 enabled 字段', async () => {
    const payload: AgentDefinition[] = [
      {
        name: 'planner',
        path: '/tmp/planner.md',
        source: 'app',
        enabled: false,
      },
      {
        name: 'writer',
        path: '/tmp/writer.md',
        source: 'plugin',
        enabled: true,
      }
    ]
    mockApi.listAgents.mockResolvedValueOnce({ success: true, data: payload })

    await useAgentsStore.getState().loadAgents()

    const state = useAgentsStore.getState()
    expect(state.agents).toHaveLength(2)
    expect(state.agents.find((item) => item.name === 'planner')?.enabled).toBe(false)
    expect(state.agents.find((item) => item.name === 'writer')?.enabled).toBe(true)
    expect(state.loadedWorkDir).toBeNull()
  })

  it('toggleAgentEnabled 会局部更新当前缓存', async () => {
    const seeded: AgentDefinition = {
      name: 'planner',
      path: '/tmp/planner.md',
      source: 'app',
      enabled: true,
    }
    useAgentsStore.setState({
      agents: [seeded],
      agentsByWorkDir: {
        [GLOBAL_CACHE_KEY]: [seeded]
      }
    })

    const ok = await useAgentsStore.getState().toggleAgentEnabled(seeded)

    expect(ok).toBe(true)
    expect(mockApi.setAgentEnabled).toHaveBeenCalledWith({
      source: 'app',
      name: 'planner',
      namespace: undefined,
      enabled: false
    })
    expect(useAgentsStore.getState().agents[0].enabled).toBe(false)
  })

  it('createAgentInLibrary 不依赖 workDir', async () => {
    const created: AgentDefinition = {
      name: 'researcher',
      path: '/tmp/kite/Agents/researcher.md',
      source: 'app',
      enabled: true,
    }
    mockApi.createAgentInLibrary.mockResolvedValueOnce({ success: true, data: created })

    const result = await useAgentsStore.getState().createAgentInLibrary('researcher', '# researcher')

    expect(result?.name).toBe('researcher')
    expect(mockApi.createAgentInLibrary).toHaveBeenCalledWith('researcher', '# researcher')
    expect(mockApi.listAgents).toHaveBeenCalledWith(undefined, 'zh-CN', 'extensions')
    expect(useAgentsStore.getState().loadedWorkDir).toBeNull()
    expect(useAgentsStore.getState().agents.some((item) => item.name === 'researcher')).toBe(true)
  })

  it('createAgent 成功后会触发后台扫描以启动翻译队列', async () => {
    const created: AgentDefinition = {
      name: 'space-planner',
      path: '/tmp/space/.claude/agents/space-planner.md',
      source: 'space',
      enabled: true,
    }
    mockApi.createAgent.mockResolvedValueOnce({ success: true, data: created })

    const result = await useAgentsStore.getState().createAgent('/tmp/space', 'space-planner', '# space-planner')

    expect(result?.name).toBe('space-planner')
    expect(mockApi.createAgent).toHaveBeenCalledWith('/tmp/space', 'space-planner', '# space-planner')
    expect(mockApi.listAgents).toHaveBeenCalledWith('/tmp/space', 'zh-CN', 'extensions')
  })

  it('createAgentInLibrary 在缺少全局缓存时不复用 space 列表', async () => {
    const spaceAgent: AgentDefinition = {
      name: 'space-only',
      path: '/tmp/space/.claude/agents/space-only.md',
      source: 'space',
      enabled: true,
    }
    const created: AgentDefinition = {
      name: 'library-only',
      path: '/tmp/kite/Agents/library-only.md',
      source: 'app',
      enabled: true,
    }
    useAgentsStore.setState({
      loadedWorkDir: '/tmp/space',
      agents: [spaceAgent],
      agentsByWorkDir: {}
    })
    mockApi.createAgentInLibrary.mockResolvedValueOnce({ success: true, data: created })

    await useAgentsStore.getState().createAgentInLibrary('library-only', '# library-only')

    const state = useAgentsStore.getState()
    expect(state.loadedWorkDir).toBeNull()
    expect(state.agents).toEqual([created])
    expect(state.agentsByWorkDir[LOCALE_GLOBAL_CACHE_KEY]).toEqual([created])
  })

  it('deleteAgentFromLibrary 会更新当前列表缓存', async () => {
    const seeded: AgentDefinition = {
      name: 'obsolete',
      path: '/tmp/kite/Agents/obsolete.md',
      source: 'app',
      enabled: true,
    }
    useAgentsStore.setState({
      agents: [seeded],
      agentsByWorkDir: {
        [GLOBAL_CACHE_KEY]: [seeded]
      },
      selectedAgent: seeded
    })

    const ok = await useAgentsStore.getState().deleteAgentFromLibrary(seeded.path)

    expect(ok).toBe(true)
    expect(mockApi.deleteAgentFromLibrary).toHaveBeenCalledWith(seeded.path)
    expect(useAgentsStore.getState().agents).toHaveLength(0)
    expect(useAgentsStore.getState().selectedAgent).toBeNull()
  })
})
