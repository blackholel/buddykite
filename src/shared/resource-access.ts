export type ResourceType = 'skill' | 'agent' | 'command'
export type ResourceKind = 'skills' | 'agents'

export type ResourceListView =
  | 'extensions'
  | 'composer'
  | 'template-library'
  | 'taxonomy-admin'
  | 'runtime-direct'
  | 'runtime-command-dependency'

export const RESOURCE_LIST_VIEWS: ResourceListView[] = [
  'extensions',
  'composer',
  'template-library',
  'taxonomy-admin',
  'runtime-direct',
  'runtime-command-dependency'
]

export function isResourceListView(value: unknown): value is ResourceListView {
  return typeof value === 'string' && (RESOURCE_LIST_VIEWS as string[]).includes(value)
}

export type InvocationContext = 'interactive' | 'command-dependency'

export function isInvocationContext(value: unknown): value is InvocationContext {
  return value === 'interactive' || value === 'command-dependency'
}

export type ResourceRefreshReason =
  | 'file-change'
  | 'plugin-registry-change'
  | 'settings-change'
  | 'resource-library-state-change'
  | 'manual-refresh'
  | 'install-complete'

export interface ResourceChangedPayload {
  workDir?: string | null
  reason?: ResourceRefreshReason
  ts?: string
  resources?: ResourceKind[]
}

export interface ResourceIndexSnapshot {
  hash: string
  generatedAt: string
  reason: ResourceRefreshReason
  counts: {
    skills: number
    agents: number
  }
}
