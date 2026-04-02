import type { AgentDefinition } from '../../stores/agents.store'
import type { SkillDefinition } from '../../stores/skills.store'
import type { ResourceType } from './types'
import type { TemplateLibraryTab } from '../../types/template-library'
import { getResourceDisplayName, getResourceUiDescription } from '../../utils/resource-display-name'

export type FilterTab = 'all' | 'skills' | 'agents'

export interface ExtensionItem {
  id: string
  type: ResourceType
  resource: SkillDefinition | AgentDefinition
  searchable: string
  displayName: string
}

const FILTER_TO_TYPE: Record<FilterTab, ResourceType | null> = {
  all: null,
  skills: 'skill',
  agents: 'agent'
}

const TYPE_PRIORITY: Record<ResourceType, number> = {
  skill: 0,
  agent: 1
}

const SOURCE_PRIORITY: Record<string, number> = {
  app: 0,
  global: 1,
  installed: 2,
  plugin: 2,
  space: 3
}

export function mapTemplateTabToFilter(tab: TemplateLibraryTab): FilterTab {
  if (tab === 'agents') return 'agents'
  return 'skills'
}

export function buildTemplateFilterState(tab: TemplateLibraryTab): {
  activeFilter: FilterTab
  query: string
} {
  return {
    activeFilter: mapTemplateTabToFilter(tab),
    query: ''
  }
}

export function normalizeExtensionItems(params: {
  skills: SkillDefinition[]
  agents: AgentDefinition[]
}): ExtensionItem[] {
  const skillItems: ExtensionItem[] = params.skills.map((skill) => {
    const displayName = getResourceDisplayName(skill)
    const description = getResourceUiDescription(skill)
    return {
      id: `skill:${skill.namespace ?? '-'}:${skill.name}`,
      type: 'skill',
      resource: skill,
      searchable: [
        skill.name,
        skill.displayNameLocalized,
        skill.displayNameBase,
        skill.namespace,
        description,
        skill.category,
        ...(skill.triggers || [])
      ].filter(Boolean).join(' ').toLowerCase(),
      displayName
    }
  })

  const agentItems: ExtensionItem[] = params.agents.map((agent) => {
    const displayName = getResourceDisplayName(agent)
    const description = getResourceUiDescription(agent)
    return {
      id: `agent:${agent.namespace ?? '-'}:${agent.name}`,
      type: 'agent',
      resource: agent,
      searchable: [
        agent.name,
        agent.displayNameLocalized,
        agent.displayNameBase,
        agent.namespace,
        description
      ].filter(Boolean).join(' ').toLowerCase(),
      displayName
    }
  })

  return [...skillItems, ...agentItems]
}

export function applyTypeAndSearchFilter(items: ExtensionItem[], activeFilter: FilterTab, query: string): ExtensionItem[] {
  const filterType = FILTER_TO_TYPE[activeFilter]
  const normalizedQuery = query.trim().toLowerCase()

  return items.filter((item) => {
    if (filterType && item.type !== filterType) return false
    if (!normalizedQuery) return true
    return item.searchable.includes(normalizedQuery)
  })
}

export function sortExtensions(items: ExtensionItem[]): ExtensionItem[] {
  return [...items].sort((a, b) => {
    const typeDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]
    if (typeDiff !== 0) return typeDiff

    const sourceA = (a.resource.source ?? '') as string
    const sourceB = (b.resource.source ?? '') as string
    const sourceDiff = (SOURCE_PRIORITY[sourceA] ?? 999) - (SOURCE_PRIORITY[sourceB] ?? 999)
    if (sourceDiff !== 0) return sourceDiff

    return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })
  })
}

export function groupByType(items: ExtensionItem[]): Record<ResourceType, ExtensionItem[]> {
  const groups: Record<ResourceType, ExtensionItem[]> = {
    skill: [],
    agent: []
  }

  for (const item of items) {
    groups[item.type].push(item)
  }

  return groups
}

export function computeTypeCounts(items: ExtensionItem[]): Record<ResourceType, number> {
  const counts: Record<ResourceType, number> = {
    skill: 0,
    agent: 0
  }

  for (const item of items) {
    counts[item.type] += 1
  }

  return counts
}
