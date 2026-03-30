/**
 * Agents Store - Agents state management
 *
 * Manages the state of agents loaded from various sources:
 * - App-level agents (~/.kite/agents/)
 * - Global custom paths
 * - Space-level agents ({workDir}/.claude/agents/)
 * - Enabled plugin agents
 */

import { create } from 'zustand'
import { api } from '../api'
import i18n from '../i18n'
import { getCacheKey, getAllCacheKeys, GLOBAL_CACHE_KEY } from './cache-keys'
import type { ResourceChangedPayload, ResourceExposure } from '../../shared/resource-access'

// ============================================
// Types
// ============================================

export interface AgentDefinition {
  name: string
  displayName?: string
  path: string
  source: 'app' | 'global' | 'space' | 'plugin'
  enabled?: boolean
  description?: string
  namespace?: string
  exposure: ResourceExposure
}

export interface AgentContent {
  name: string
  content: string
}

interface AgentsState {
  // Data
  agents: AgentDefinition[]
  loadedWorkDir: string | null
  selectedAgent: AgentDefinition | null
  agentContent: AgentContent | null
  agentsByWorkDir: Record<string | symbol, AgentDefinition[]>
  dirtyWorkDirs: Set<string | symbol>

  // UI State
  isLoading: boolean
  isLoadingContent: boolean
  searchQuery: string
  error: string | null

  // Actions
  loadAgents: (workDir?: string) => Promise<void>
  selectAgent: (agent: AgentDefinition | null) => void
  loadAgentContent: (name: string, workDir?: string) => Promise<AgentContent | null>
  setSearchQuery: (query: string) => void
  createAgent: (workDir: string, name: string, content: string) => Promise<AgentDefinition | null>
  createAgentInLibrary: (name: string, content: string) => Promise<AgentDefinition | null>
  updateAgent: (agentPath: string, content: string) => Promise<boolean>
  updateAgentInLibrary: (agentPath: string, content: string) => Promise<boolean>
  deleteAgent: (agentPath: string) => Promise<boolean>
  deleteAgentFromLibrary: (agentPath: string) => Promise<boolean>
  toggleAgentEnabled: (agent: AgentDefinition, enabled?: boolean) => Promise<boolean>
  openAgentsLibraryFolder: () => Promise<boolean>
  showAgentInFolder: (agentPath: string) => Promise<boolean>
  copyToSpace: (
    agent: AgentDefinition,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<{ status: 'copied' | 'conflict' | 'not_found'; data?: AgentDefinition }>
  clearCache: () => Promise<void>
  markDirty: (workDir?: string | null) => void
  markAllDirty: () => void

  // Selectors
  getFilteredAgents: () => AgentDefinition[]
  getAgentsBySource: (source: AgentDefinition['source']) => AgentDefinition[]
  getAgentByName: (name: string) => AgentDefinition | undefined
}

// ============================================
// Store
// ============================================

export const useAgentsStore = create<AgentsState>((set, get) => ({
  // Initial state
  agents: [],
  loadedWorkDir: null,
  selectedAgent: null,
  agentContent: null,
  agentsByWorkDir: {},
  dirtyWorkDirs: new Set<string | symbol>(),
  isLoading: false,
  isLoadingContent: false,
  searchQuery: '',
  error: null,

  // Load agents from all sources
  loadAgents: async (workDir?: string) => {
    const cacheKey = getCacheKey(workDir)
    const { agentsByWorkDir, dirtyWorkDirs } = get()
    const cached = agentsByWorkDir[cacheKey]
    if (cached && !dirtyWorkDirs.has(cacheKey)) {
      set({
        agents: cached,
        loadedWorkDir: workDir ?? null,
        error: null,
        isLoading: false
      })
      return
    }

    try {
      set({ isLoading: true, error: null })

      const response = await api.listAgents(workDir, i18n.language, 'extensions')

      if (response.success && response.data) {
        const nextByWorkDir = {
          ...get().agentsByWorkDir,
          [cacheKey]: response.data as AgentDefinition[]
        }
        const nextDirty = new Set(get().dirtyWorkDirs)
        nextDirty.delete(cacheKey)
        set({
          agents: response.data as AgentDefinition[],
          loadedWorkDir: workDir ?? null,
          agentsByWorkDir: nextByWorkDir,
          dirtyWorkDirs: nextDirty
        })
      } else {
        set({ error: response.error || 'Failed to load agents' })
      }
    } catch (error) {
      console.error('[AgentsStore] Failed to load agents:', error)
      set({ error: 'Failed to load agents' })
    } finally {
      set({ isLoading: false })
    }
  },

  // Select an agent for viewing
  selectAgent: (agent) => {
    set({ selectedAgent: agent, agentContent: null })
  },

  // Load agent content (markdown)
  loadAgentContent: async (name, workDir) => {
    try {
      set({ isLoadingContent: true })

      const response = await api.getAgentContent(name, workDir)

      if (response.success && response.data) {
        const content = response.data as string
        const agentContent: AgentContent = { name, content }
        set({ agentContent })
        return agentContent
      }

      set({ error: response.error || 'Failed to load agent content' })
      return null
    } catch (error) {
      console.error('[AgentsStore] Failed to load agent content:', error)
      set({ error: 'Failed to load agent content' })
      return null
    } finally {
      set({ isLoadingContent: false })
    }
  },

  // Set search query for filtering
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  // Create a new agent in space directory
  createAgent: async (workDir, name, content) => {
    try {
      const response = await api.createAgent(workDir, name, content)

      if (response.success && response.data) {
        const newAgent = response.data as AgentDefinition
        const cacheKey = getCacheKey(workDir)
        set((state) => ({
          agents: [...state.agents, newAgent],
          agentsByWorkDir: {
            ...state.agentsByWorkDir,
            [cacheKey]: [...(state.agentsByWorkDir[cacheKey] || []), newAgent]
          }
        }))

        return newAgent
      }

      set({ error: response.error || 'Failed to create agent' })
      return null
    } catch (error) {
      console.error('[AgentsStore] Failed to create agent:', error)
      set({ error: 'Failed to create agent' })
      return null
    }
  },

  createAgentInLibrary: async (name, content) => {
    try {
      const response = await api.createAgentInLibrary(name, content)

      if (response.success && response.data) {
        const newAgent = response.data as AgentDefinition
        set((state) => {
          const cacheKey = getCacheKey(undefined)
          const current = state.agentsByWorkDir[cacheKey]
            ?? (state.loadedWorkDir === null ? state.agents : [])
          return {
            agents: [...current, newAgent],
            loadedWorkDir: null,
            agentsByWorkDir: {
              ...state.agentsByWorkDir,
              [cacheKey]: [...current, newAgent]
            }
          }
        })
        return newAgent
      }

      set({ error: response.error || 'Failed to create agent' })
      return null
    } catch (error) {
      console.error('[AgentsStore] Failed to create agent in library:', error)
      set({ error: 'Failed to create agent' })
      return null
    }
  },

  // Update an existing agent
  updateAgent: async (agentPath, content) => {
    try {
      const response = await api.updateAgent(agentPath, content)
      if (response.success) {
        const { agents, selectedAgent, loadedWorkDir, loadAgentContent } = get()
        const agent = agents.find(a => a.path === agentPath)
        if (agent && selectedAgent?.path === agentPath) {
          await loadAgentContent(agent.name, loadedWorkDir ?? undefined)
        }
        return true
      }
      set({ error: response.error || 'Failed to update agent' })
      return false
    } catch (error) {
      console.error('[AgentsStore] Failed to update agent:', error)
      set({ error: 'Failed to update agent' })
      return false
    }
  },

  // Delete an agent
  deleteAgent: async (agentPath) => {
    try {
      const response = await api.deleteAgent(agentPath)
      if (response.success) {
        set((state) => {
          const cacheKey = getCacheKey(state.loadedWorkDir)
          return {
            agents: state.agents.filter(a => a.path !== agentPath),
            agentsByWorkDir: {
              ...state.agentsByWorkDir,
              [cacheKey]: (state.agentsByWorkDir[cacheKey] || [])
                .filter(a => a.path !== agentPath)
            },
            selectedAgent: state.selectedAgent?.path === agentPath ? null : state.selectedAgent,
            agentContent: state.selectedAgent?.path === agentPath ? null : state.agentContent
          }
        })
        return true
      }
      set({ error: response.error || 'Failed to delete agent' })
      return false
    } catch (error) {
      console.error('[AgentsStore] Failed to delete agent:', error)
      set({ error: 'Failed to delete agent' })
      return false
    }
  },

  updateAgentInLibrary: async (agentPath, content) => {
    try {
      const response = await api.updateAgentInLibrary(agentPath, content)
      if (!response.success) {
        set({ error: response.error || 'Failed to update agent' })
        return false
      }
      const { agents, selectedAgent, loadAgentContent } = get()
      const target = agents.find((agent) => agent.path === agentPath)
      if (target && selectedAgent?.path === agentPath) {
        await loadAgentContent(target.name)
      }
      return true
    } catch (error) {
      console.error('[AgentsStore] Failed to update library agent:', error)
      set({ error: 'Failed to update agent' })
      return false
    }
  },

  deleteAgentFromLibrary: async (agentPath) => {
    try {
      const response = await api.deleteAgentFromLibrary(agentPath)
      if (!response.success) {
        set({ error: response.error || 'Failed to delete agent' })
        return false
      }
      set((state) => {
        const nextByWorkDir: Record<string | symbol, AgentDefinition[]> = {}
        for (const [key, value] of Object.entries(state.agentsByWorkDir)) {
          nextByWorkDir[key] = value.filter((item) => item.path !== agentPath)
        }
        return {
          agents: state.agents.filter((item) => item.path !== agentPath),
          agentsByWorkDir: nextByWorkDir,
          selectedAgent: state.selectedAgent?.path === agentPath ? null : state.selectedAgent,
          agentContent: state.selectedAgent?.path === agentPath ? null : state.agentContent
        }
      })
      return true
    } catch (error) {
      console.error('[AgentsStore] Failed to delete library agent:', error)
      set({ error: 'Failed to delete agent' })
      return false
    }
  },

  toggleAgentEnabled: async (agent, enabled) => {
    const nextEnabled = typeof enabled === 'boolean' ? enabled : agent.enabled === false
    try {
      const response = await api.setAgentEnabled({
        source: agent.source,
        name: agent.name,
        namespace: agent.namespace,
        enabled: nextEnabled
      })
      if (!response.success) {
        set({ error: response.error || 'Failed to update agent enabled state' })
        return false
      }

      const isSameAgent = (item: AgentDefinition) =>
        item.source === agent.source
        && item.name === agent.name
        && (item.namespace || '') === (agent.namespace || '')

      set((state) => {
        const nextByWorkDir: Record<string | symbol, AgentDefinition[]> = {}
        for (const [key, value] of Object.entries(state.agentsByWorkDir)) {
          nextByWorkDir[key] = value.map((item) => (isSameAgent(item) ? { ...item, enabled: nextEnabled } : item))
        }
        return {
          agents: state.agents.map((item) => (isSameAgent(item) ? { ...item, enabled: nextEnabled } : item)),
          agentsByWorkDir: nextByWorkDir,
          selectedAgent: state.selectedAgent && isSameAgent(state.selectedAgent)
            ? { ...state.selectedAgent, enabled: nextEnabled }
            : state.selectedAgent
        }
      })
      return true
    } catch (error) {
      console.error('[AgentsStore] Failed to toggle agent enabled state:', error)
      set({ error: 'Failed to update agent enabled state' })
      return false
    }
  },

  openAgentsLibraryFolder: async () => {
    try {
      const response = await api.openAgentsLibraryFolder()
      if (!response.success) {
        set({ error: response.error || 'Failed to open folder' })
        return false
      }
      return true
    } catch (error) {
      console.error('[AgentsStore] Failed to open agents library folder:', error)
      set({ error: 'Failed to open folder' })
      return false
    }
  },

  showAgentInFolder: async (agentPath) => {
    try {
      const response = await api.showAgentInFolder(agentPath)
      if (!response.success) {
        set({ error: response.error || 'Failed to show item in folder' })
        return false
      }
      return true
    } catch (error) {
      console.error('[AgentsStore] Failed to show agent in folder:', error)
      set({ error: 'Failed to show item in folder' })
      return false
    }
  },

  // Copy agent to space
  copyToSpace: async (agent, workDir, options) => {
    try {
      const response = await api.copyAgentToSpaceByRef({
        type: 'agent',
        name: agent.name,
        namespace: agent.namespace,
        source: agent.source,
        path: agent.path
      }, workDir, options)
      if (response.success && response.data) {
        const copyResult = response.data as { status: 'copied' | 'conflict' | 'not_found'; data?: AgentDefinition }
        if (copyResult.status !== 'copied' || !copyResult.data) {
          return copyResult
        }
        const copiedAgent = copyResult.data
        const cacheKey = getCacheKey(workDir)
        set((state) => ({
          agents: state.agents.map(a => a.path === agent.path ? copiedAgent : a),
          agentsByWorkDir: {
            ...state.agentsByWorkDir,
            [cacheKey]: (state.agentsByWorkDir[cacheKey] || []).map(a =>
              a.path === agent.path ? copiedAgent : a
            )
          }
        }))
        return { status: 'copied', data: copiedAgent }
      }
      set({ error: response.error || 'Failed to copy agent to space' })
      return { status: 'not_found' }
    } catch (error) {
      console.error('[AgentsStore] Failed to copy agent to space:', error)
      set({ error: 'Failed to copy agent to space' })
      return { status: 'not_found' }
    }
  },

  // Clear cache and reload
  clearCache: async () => {
    try {
      await api.clearAgentsCache()
      set((state) => {
        const allKeys = getAllCacheKeys(state.agentsByWorkDir)
        const nextDirty = new Set(allKeys)
        nextDirty.add(GLOBAL_CACHE_KEY)
        return { dirtyWorkDirs: nextDirty }
      })
    } catch (error) {
      console.error('[AgentsStore] Failed to clear cache:', error)
    }
  },

  markDirty: (workDir) => {
    const cacheKey = getCacheKey(workDir)
    set((state) => {
      const nextDirty = new Set(state.dirtyWorkDirs)
      nextDirty.add(cacheKey)
      return { dirtyWorkDirs: nextDirty }
    })
  },

  markAllDirty: () => {
    set((state) => {
      const allKeys = getAllCacheKeys(state.agentsByWorkDir)
      const nextDirty = new Set(allKeys)
      nextDirty.add(GLOBAL_CACHE_KEY)
      return { dirtyWorkDirs: nextDirty }
    })
  },

  // Get filtered agents
  getFilteredAgents: () => {
    const { agents, searchQuery } = get()
    if (!searchQuery.trim()) return agents

    const query = searchQuery.toLowerCase()
    return agents.filter(agent =>
      agent.name.toLowerCase().includes(query) ||
      agent.displayName?.toLowerCase().includes(query) ||
      agent.description?.toLowerCase().includes(query)
    )
  },

  // Get agents by source
  getAgentsBySource: (source) => {
    const { agents } = get()
    return agents.filter(a => a.source === source)
  },

  // Get agent by name
  getAgentByName: (name) => {
    const { agents } = get()
    return agents.find(a => a.name === name)
  }
}))

let agentsListenersInitialized = false

export function initAgentsStoreListeners(): void {
  if (agentsListenersInitialized) return
  agentsListenersInitialized = true

  api.onAgentsChanged((data) => {
    const payload = data as ResourceChangedPayload
    const { loadedWorkDir, loadAgents, markDirty, markAllDirty } = useAgentsStore.getState()
    if (payload.workDir == null) {
      markAllDirty()
      loadAgents(loadedWorkDir ?? undefined)
      return
    }
    markDirty(payload.workDir)
    if (payload.workDir === loadedWorkDir) {
      loadAgents(loadedWorkDir ?? undefined)
    }
  })

  i18n.on('languageChanged', () => {
    const { loadedWorkDir, loadAgents, markAllDirty } = useAgentsStore.getState()
    markAllDirty()
    void loadAgents(loadedWorkDir ?? undefined)
  })
}

export const selectAgents = (state: AgentsState) => state.agents
export const selectSelectedAgent = (state: AgentsState) => state.selectedAgent
export const selectAgentContent = (state: AgentsState) => state.agentContent
export const selectIsLoadingAgents = (state: AgentsState) => state.isLoading
export const selectAgentSearchQuery = (state: AgentsState) => state.searchQuery
export const selectAgentError = (state: AgentsState) => state.error
