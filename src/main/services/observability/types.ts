import type { ChatMode, ToolCall } from '../agent/types'

export const OBSERVABILITY_PHASES = [
  'send_entry',
  'resolve_provider',
  'acquire_session',
  'expand_directives',
  'session_send',
  'first_token',
  'stream_loop',
  'finalize'
] as const

export type ObservabilityPhase = (typeof OBSERVABILITY_PHASES)[number]

export interface ObservabilityTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd: number
  contextWindow: number
}

export interface ObservabilityToolSummary {
  total: number
  success: number
  error: number
  running: number
  waitingApproval: number
  cancelled: number
}

export interface ObservabilityRunSummary {
  sessionKey: string
  spaceId: string
  conversationId: string
  runId: string
  mode: ChatMode
  provider: string
  model: string
  providerId?: string
  authMethod?: string
  accountId?: string
  tokenSource?: string
  refreshState?: string
  killSwitch?: boolean
  sampled: boolean
  enabled: boolean
  status: 'running' | 'completed' | 'stopped' | 'error' | 'no_text' | 'dropped'
  startedAt: string
  endedAt?: string
  durationMs?: number
  ttftMs?: number
  traceId?: string
  rootObservationId?: string
  traceHost?: string
  phaseDurationsMs: Partial<Record<ObservabilityPhase, number>>
  tokenUsage?: ObservabilityTokenUsage
  toolSummary?: ObservabilityToolSummary
  terminalReason?: 'completed' | 'stopped' | 'error' | 'no_text'
  errorMessage?: string
}

export interface AgentRunObservationHandle {
  sessionKey: string
  spaceId: string
  conversationId: string
  runId: string
}

export interface AgentRunObservationStartInput {
  sessionKey: string
  spaceId: string
  conversationId: string
  runId: string
  mode: ChatMode
  message: string
  responseLanguage: string
  imageCount: number
  fileContextCount: number
  thinkingEnabled: boolean
}

export interface AgentRunObservationFinalizeInput {
  status: 'completed' | 'stopped' | 'error' | 'no_text'
  provider: string
  model: string
  terminalReason: 'completed' | 'stopped' | 'error' | 'no_text'
  tokenUsage?: ObservabilityTokenUsage | null
  toolsById?: Map<string, ToolCall>
  finalContent?: string
  errorMessage?: string
}
