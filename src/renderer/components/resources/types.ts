import type { AgentDefinition } from '../../stores/agents.store'
import type { SkillDefinition } from '../../stores/skills.store'

export type ResourceType = 'skill' | 'agent'

export type AnyResource = SkillDefinition | AgentDefinition

export type ResourceActionMode = 'copy-to-space' | 'none'
