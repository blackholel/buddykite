/**
 * Message List - Displays chat messages with streaming and thinking support
 * Layout: User message -> [Thinking Process above] -> [Assistant Reply]
 * Thinking process is always displayed ABOVE the assistant message (like ChatGPT/Cursor)
 *
 * Key Feature: StreamingBubble with scroll animation
 * When AI outputs text -> calls tool -> outputs more text:
 * - Old content smoothly scrolls up and out of view
 * - New content appears in place
 * - Creates a clean, focused reading experience
 *
 * @see docs/streaming-scroll-animation.md for detailed implementation notes
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { MessageItem } from './MessageItem'
import { ThoughtProcess } from './ThoughtProcess'
import { CompactNotice } from './CompactNotice'
import { MarkdownRenderer } from './MarkdownRenderer'
import { WidgetRenderer } from './WidgetRenderer'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'
import { BrowserTaskCard, isBrowserTool } from '../tool/BrowserTaskCard'
import { TodoCard, parseTodoInput } from '../tool/TodoCard'
import { SubAgentCard } from './SubAgentCard'
import { SkillCard } from './SkillCard'
import { useSkillsStore } from '../../stores/skills.store'
import { useCommandsStore } from '../../stores/commands.store'
import { useAgentsStore } from '../../stores/agents.store'
import type { ComposerResourceDisplayLookups } from '../../utils/composer-resource-chip'
import { normalizeChipDisplayName } from '../../utils/composer-resource-chip'
import { toResourceKey } from '../../utils/resource-key'
import type {
  Message,
  Thought,
  CompactInfo,
  ParallelGroup,
  ProcessTraceNode,
  ToolStatus
} from '../../types'
import { useTranslation } from '../../i18n'
import { buildTimelineSegments, type TimelineSegment } from '../../utils/thought-utils'
import {
  formatMcpActionDisplay,
  getMcpServerDisplayName,
  isMcpToolName,
  parseMcpToolName
} from '../../utils/mcp-tool-display'
import {
  parseAllShowWidgets,
  parseShowWidgetsForStreaming
} from '../../lib/widget-sanitizer'

interface AvailableToolsSnapshot {
  runId: string | null
  snapshotVersion: number
  emittedAt: string | null
  phase: 'initializing' | 'ready'
  tools: string[]
  toolCount: number
}

interface McpActivityItem {
  id: string
  serverName: string
  serverLabel: string
  actionLabel: string
  status: ToolStatus
  timestampMs: number
}

interface MessageListProps {
  messages: Message[]
  streamingContent: string
  isGenerating: boolean
  activeRunId?: string | null
  isStreaming?: boolean  // True during token-level text streaming
  thoughts?: Thought[]
  processTrace?: ProcessTraceNode[]
  parallelGroups?: Map<string, ParallelGroup>  // Parallel operation groups
  isThinking?: boolean
  compactInfo?: CompactInfo | null
  error?: string | null  // Error message to display when generation fails
  isCompact?: boolean  // Compact mode when Canvas is open
  textBlockVersion?: number  // Increments on each new text block (for StreamingBubble reset)
  workDir?: string  // For skill suggestion card creation
  onOpenPlanInCanvas?: (planContent: string) => void
  onExecutePlan?: (planContent: string) => void  // Callback when "Execute Plan" button is clicked
  toolStatusById?: Record<string, ToolStatus>
  availableToolsSnapshot?: AvailableToolsSnapshot
}

function extractThoughtsFromProcessTrace(processTrace?: ProcessTraceNode[]): Thought[] {
  if (!processTrace || processTrace.length === 0) {
    return []
  }

  const thoughts: Thought[] = []
  const seen = new Set<string>()

  for (const node of processTrace) {
    const payload =
      node.payload && typeof node.payload === 'object'
        ? (node.payload as Record<string, unknown>)
        : null
    const payloadThought = payload?.thought
    if (
      payloadThought &&
      typeof payloadThought === 'object' &&
      typeof (payloadThought as Thought).id === 'string' &&
      typeof (payloadThought as Thought).type === 'string' &&
      typeof (payloadThought as Thought).content === 'string' &&
      typeof (payloadThought as Thought).timestamp === 'string'
    ) {
      const thought = payloadThought as Thought
      const key = `${thought.type}:${thought.id}`
      if (!seen.has(key)) {
        seen.add(key)
        thoughts.push(thought)
      }
      continue
    }

    if ((node.kind === 'tool_call' || node.kind === 'tool_result') && payload) {
      const toolCallId =
        (typeof payload.toolCallId === 'string' && payload.toolCallId) ||
        (typeof payload.toolId === 'string' && payload.toolId) ||
        (typeof payload.id === 'string' && payload.id) ||
        null
      if (!toolCallId) continue

      if (node.kind === 'tool_call') {
        const toolName = typeof payload.name === 'string' ? payload.name : 'tool'
        const thought: Thought = {
          id: toolCallId,
          type: 'tool_use',
          content: `Tool call: ${toolName}`,
          timestamp: node.ts || node.timestamp || new Date().toISOString(),
          toolName,
          toolInput:
            payload.input && typeof payload.input === 'object'
              ? (payload.input as Record<string, unknown>)
              : undefined
        }
        const key = `${thought.type}:${thought.id}`
        if (!seen.has(key)) {
          seen.add(key)
          thoughts.push(thought)
        }
      } else {
        const isError = payload.isError === true
        const result =
          typeof payload.result === 'string'
            ? payload.result
            : payload.result == null
              ? ''
              : JSON.stringify(payload.result)
        const thought: Thought = {
          id: toolCallId,
          type: 'tool_result',
          content: isError ? 'Tool execution failed' : 'Tool execution succeeded',
          timestamp: node.ts || node.timestamp || new Date().toISOString(),
          toolOutput: result,
          isError
        }
        const key = `${thought.type}:${thought.id}`
        if (!seen.has(key)) {
          seen.add(key)
          thoughts.push(thought)
        }
      }
    }
  }

  return thoughts
}

export function getMessageThoughtsForDisplay(message: Message): Thought[] {
  if (Array.isArray(message.thoughts) && message.thoughts.length > 0) {
    return message.thoughts
  }

  if (Array.isArray(message.processTrace) && message.processTrace.length > 0) {
    return extractThoughtsFromProcessTrace(message.processTrace)
  }

  return []
}

export function splitGuidedMessagesForActiveRun(
  messages: Message[],
  isGenerating: boolean,
  activeRunId?: string | null
): { mainMessages: Message[]; guidedMessages: Message[] } {
  const displayMessages = isGenerating
    ? messages.filter((msg, idx) => {
        const isLastMessage = idx === messages.length - 1
        const isEmptyAssistant = msg.role === 'assistant' && !msg.content
        return !(isLastMessage && isEmptyAssistant)
      })
    : messages

  if (!isGenerating || !activeRunId) {
    return { mainMessages: displayMessages, guidedMessages: [] }
  }

  const mainMessages: Message[] = []
  const guidedMessages: Message[] = []

  for (const message of displayMessages) {
    const guidedRunId = message.guidedMeta?.runId
    const isGuidedForActiveRun =
      message.role === 'user' &&
      typeof guidedRunId === 'string' &&
      guidedRunId === activeRunId

    if (isGuidedForActiveRun) {
      guidedMessages.push(message)
      continue
    }
    mainMessages.push(message)
  }

  return { mainMessages, guidedMessages }
}

/**
 * StreamingBubble - Displays streaming content with scroll-up animation
 *
 * Problem: `content` (streamingContent) is cumulative - it appends all text from
 * the start of generation. When tool_use happens mid-stream, we need to:
 * 1. "Snapshot" the current content
 * 2. Scroll the snapshot up (out of view)
 * 3. Display only the NEW content after the tool call
 *
 * Solution: Snapshot-based content segmentation
 * - segments[]: Array of snapshots (independent, not cumulative)
 * - displayContent: content.slice(lastSnapshot.length) - extracts only new part
 * - CSS translateY: Scrolls history out of the viewport
 *
 * Timing is critical: We wait for new content to arrive BEFORE scrolling,
 * otherwise user sees empty space during the tool call.
 */
function StreamingBubble({
  content,
  isStreaming,
  thoughts,
  textBlockVersion = 0,
  workDir
}: {
  content: string
  isStreaming: boolean
  thoughts: Thought[]
  textBlockVersion?: number
  workDir?: string
}) {
  // DOM refs for measuring heights
  const historyRef = useRef<HTMLDivElement>(null)  // Contains all past segments
  const currentRef = useRef<HTMLDivElement>(null)  // Contains current (new) content
  const { t } = useTranslation()

  // State for scroll animation
  const [segments, setSegments] = useState<string[]>([])     // Saved content snapshots
  const [scrollOffset, setScrollOffset] = useState(0)        // translateY offset in px
  const [currentHeight, setCurrentHeight] = useState(0)      // Viewport height = current content height
  const [activeSnapshotLen, setActiveSnapshotLen] = useState(0)  // Length to slice from (state for sync rendering)

  // Refs for tracking (don't trigger re-renders)
  const prevThoughtsLenRef = useRef(0)           // Previous thoughts array length
  const pendingSnapshotRef = useRef<string | null>(null)  // Content waiting to be saved
  const prevTextBlockVersionRef = useRef(textBlockVersion)  // Track version changes

  /**
   * Step 0: Reset on new text block (100% reliable signal from SDK)
   * When textBlockVersion changes, it means a new content_block_start (type='text') arrived.
   * This is the precise signal to reset activeSnapshotLen.
   */
  useEffect(() => {
    if (textBlockVersion !== prevTextBlockVersionRef.current) {
      // Reset all state for new text block
      setActiveSnapshotLen(0)
      setSegments([])
      setScrollOffset(0)
      pendingSnapshotRef.current = null
      prevTextBlockVersionRef.current = textBlockVersion
    }
  }, [textBlockVersion])

  /**
   * Step 1: Detect tool_use and mark content as pending
   * When a new tool_use thought appears, we mark the current content
   * as "pending" - it will be saved when new content arrives.
   */
  useEffect(() => {
    const prevLen = prevThoughtsLenRef.current
    const currLen = thoughts.length

    if (currLen > prevLen) {
      const newThought = thoughts[currLen - 1]
      // On tool_use, mark current content as pending (will be saved when new content arrives)
      if (newThought?.type === 'tool_use' && content && content.length > activeSnapshotLen) {
        pendingSnapshotRef.current = content
      }
    }
    prevThoughtsLenRef.current = currLen
  }, [thoughts, content, activeSnapshotLen])

  /**
   * Step 2: Save snapshot when new content arrives
   * We wait until new content appears (content grows beyond pending)
   * before saving the snapshot. This ensures smooth transition.
   *
   * Key: Update segments first, then update activeSnapshotLen in next effect.
   * This ensures the history DOM renders BEFORE we slice the display content.
   */
  useEffect(() => {
    const pending = pendingSnapshotRef.current
    if (pending && content && content.length > pending.length) {
      // New content has arrived, now save the snapshot
      setSegments(prev => [...prev, pending])
      pendingSnapshotRef.current = null
    }
  }, [content])

  /**
   * Step 2b: Update slice position AFTER segments are in DOM
   * This runs after segments update, ensuring history is visible before we slice
   */
  useEffect(() => {
    if (segments.length > 0) {
      // Calculate total length of all segments
      const totalLen = segments.reduce((sum, seg) => sum + seg.length, 0)
      if (totalLen !== activeSnapshotLen) {
        setActiveSnapshotLen(totalLen)
      }
    }
  }, [segments, activeSnapshotLen])

  /**
   * Step 3: Reset state on new conversation
   * Note: New text block reset is now handled by Step 0 (textBlockVersion change)
   */
  useEffect(() => {
    if (!content && thoughts.length === 0) {
      // Full reset for new conversation
      setSegments([])
      setScrollOffset(0)
      setCurrentHeight(0)
      setActiveSnapshotLen(0)
      prevThoughtsLenRef.current = 0
      prevTextBlockVersionRef.current = 0
    }
  }, [content, thoughts.length])

  /**
   * Step 4: Measure current content height (throttled)
   * Only update height every 100ms to avoid excessive measurements during streaming.
   * Viewport height = current content height only (not history)
   */
  const heightMeasureRef = useRef<number>(0)
  useEffect(() => {
    if (currentRef.current) {
      // Throttle: only measure every 100ms
      const now = Date.now()
      if (now - heightMeasureRef.current < 100) return
      heightMeasureRef.current = now

      requestAnimationFrame(() => {
        if (currentRef.current) {
          setCurrentHeight(currentRef.current.scrollHeight)
        }
      })
    }
  }, [content, segments.length])

  /**
   * Step 5: Calculate scroll offset when segments change
   * scrollOffset = total height of history segments
   * This value is used for translateY(-scrollOffset)
   */
  useEffect(() => {
    if (segments.length > 0 && historyRef.current) {
      // Wait for DOM to update
      requestAnimationFrame(() => {
        if (historyRef.current) {
          setScrollOffset(historyRef.current.scrollHeight)
        }
      })
    }
  }, [segments])

  // Calculate what to show in current content area
  // activeSnapshotLen is updated AFTER segments render, ensuring no content loss
  const displayContent = activeSnapshotLen > 0 && content.length >= activeSnapshotLen
    ? content.slice(activeSnapshotLen)
    : content
  const [throttledMarkdownContent, setThrottledMarkdownContent] = useState(displayContent)
  const historyWidgetSegments = useMemo(
    () => segments.map((snapshot) => {
      const parsed = parseShowWidgetsForStreaming(snapshot)
      if (parsed.length > 0) return parsed
      return [{ type: 'text', key: `history-plain-${snapshot.length}`, content: snapshot } as const]
    }),
    [segments]
  )
  const currentWidgetSegments = useMemo(() => {
    const source = isStreaming ? displayContent : throttledMarkdownContent
    const parsed = isStreaming
      ? parseShowWidgetsForStreaming(source)
      : parseAllShowWidgets(source)
    if (parsed.length > 0) return parsed
    return source ? [{ type: 'text', key: 'current-plain', content: source } as const] : []
  }, [displayContent, isStreaming, throttledMarkdownContent])

  useEffect(() => {
    if (!isStreaming) {
      setThrottledMarkdownContent(displayContent)
      return
    }
    const timer = window.setTimeout(() => {
      setThrottledMarkdownContent(displayContent)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [displayContent, isStreaming])

  if (!content) return null

  const containerHeight = currentHeight > 0 ? currentHeight : 'auto'

  return (
    <div className="rounded-xl px-3 py-2 message-assistant message-working w-full overflow-hidden">
      {/* Working indicator */}
      <div className="flex items-center gap-1 mb-1.5 pb-1.5 border-b border-border/20 working-indicator-fade">
        <span className="text-[11px] text-muted-foreground/60">{t('Kite is working')}</span>
      </div>

      {/* Viewport - height matches current content only */}
      <div
        className="overflow-hidden transition-[height] duration-300"
        style={{ height: containerHeight }}
      >
        {/* Scrollable container */}
        <div
          className="transition-transform duration-300"
          style={{ transform: `translateY(-${scrollOffset}px)` }}
        >
          {/* History segments - will be scrolled out of view */}
          <div ref={historyRef}>
            {historyWidgetSegments.map((snapshotSegments, i) => (
              <div key={`history:${i}`} className="pb-4 break-words leading-relaxed space-y-3">
                {snapshotSegments.map((segment) => {
                  if (segment.type === 'text') {
                    if (!segment.content) return null
                    return (
                      <MarkdownRenderer
                        key={`history:${i}:${segment.key}`}
                        content={segment.content}
                        workDir={workDir}
                        className="space-studio-assistant-markdown"
                      />
                    )
                  }

                  return (
                    <WidgetErrorBoundary
                      key={`history:${i}:${segment.key}`}
                      fallbackTitle={t('Widget failed to render')}
                      fallbackDetail={t('Widget render error')}
                    >
                      <WidgetRenderer
                        widgetKey={`history:${i}:${segment.key}`}
                        title={segment.title}
                        widgetCode={segment.widgetCode}
                        isPartial={segment.isPartial}
                      />
                    </WidgetErrorBoundary>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Current content - always visible, shows only NEW part after snapshots */}
          <div ref={currentRef} className="break-words leading-relaxed space-y-3">
            {currentWidgetSegments.map((segment) => {
              if (segment.type === 'text') {
                if (!segment.content) return null
                if (isStreaming) {
                  return (
                    <span
                      key={`current:${segment.key}`}
                      className="whitespace-pre-wrap"
                    >
                      {segment.content}
                    </span>
                  )
                }
                return (
                  <MarkdownRenderer
                    key={`current:${segment.key}`}
                    content={segment.content}
                    workDir={workDir}
                    className="space-studio-assistant-markdown"
                  />
                )
              }

              return (
                <WidgetErrorBoundary
                  key={`current:${segment.key}`}
                  fallbackTitle={t('Widget failed to render')}
                  fallbackDetail={t('Widget render error')}
                >
                  <WidgetRenderer
                    widgetKey={`current:${segment.key}`}
                    title={segment.title}
                    widgetCode={segment.widgetCode}
                    isPartial={segment.isPartial}
                  />
                </WidgetErrorBoundary>
              )
            })}
            {isStreaming && (
              <span className="inline-block w-0.5 h-5 ml-0.5 bg-foreground/70 streaming-cursor align-middle" />
            )}
            {!isStreaming && (
              <span className="waiting-dots ml-1 text-muted-foreground/60" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MessageList({
  messages,
  streamingContent,
  isGenerating,
  activeRunId = null,
  isStreaming = false,
  thoughts = [],
  processTrace = [],
  parallelGroups,
  isThinking = false,
  compactInfo = null,
  error = null,
  isCompact = false,
  textBlockVersion = 0,
  workDir,
  onOpenPlanInCanvas,
  onExecutePlan,
  toolStatusById = {},
  availableToolsSnapshot
}: MessageListProps) {
  const { t } = useTranslation()
  const skills = useSkillsStore(state => state.skills)
  const commands = useCommandsStore(state => state.commands)
  const agents = useAgentsStore(state => state.agents)

  const resourceDisplayLookups = useMemo<ComposerResourceDisplayLookups>(() => {
    const skillMap = new Map<string, string>()
    const commandMap = new Map<string, string>()
    const agentMap = new Map<string, string>()

    for (const skill of skills) {
      skillMap.set(
        toResourceKey({ name: skill.name, namespace: skill.namespace }),
        normalizeChipDisplayName(skill.displayName || skill.name)
      )
    }
    for (const command of commands) {
      commandMap.set(
        toResourceKey({ name: command.name, namespace: command.namespace }),
        normalizeChipDisplayName(command.displayName || command.name)
      )
    }
    for (const agent of agents) {
      agentMap.set(
        toResourceKey({ name: agent.name, namespace: agent.namespace }),
        normalizeChipDisplayName(agent.displayName || agent.name)
      )
    }

    return {
      skills: skillMap,
      commands: commandMap,
      agents: agentMap
    }
  }, [skills, commands, agents])

  const runtimeThoughts = useMemo(() => {
    if (thoughts.length > 0) {
      return thoughts
    }
    return extractThoughtsFromProcessTrace(processTrace)
  }, [thoughts, processTrace])

  const isRunningLikeStatus = (status?: ToolStatus): boolean => {
    return status === 'pending' || status === 'running' || status === 'waiting_approval'
  }

  const { mainMessages, guidedMessages } = useMemo(
    () => splitGuidedMessagesForActiveRun(messages, isGenerating, activeRunId),
    [messages, isGenerating, activeRunId]
  )

  const previousCostByMessageId = useMemo(() => {
    const map = new Map<string, number>()
    let previousCost = 0
    for (const message of mainMessages) {
      map.set(message.id, previousCost)
      if (message.role === 'assistant' && message.tokenUsage?.totalCostUsd) {
        previousCost = message.tokenUsage.totalCostUsd
      }
    }
    return map
  }, [mainMessages])

  // Build timeline segments from thoughts - preserves original order of Skill and SubAgent calls
  const timelineSegments = useMemo(() => {
    return buildTimelineSegments(runtimeThoughts)
  }, [runtimeThoughts])

  // Check if any sub-agent is currently running (for isThinking state)
  const hasRunningSubAgent = useMemo(() => {
    return timelineSegments.some((seg) => {
      if (seg.type !== 'subagent') return false
      const status = toolStatusById[seg.agentId]
      if (status) return isRunningLikeStatus(status)
      return seg.isRunning
    })
  }, [timelineSegments, toolStatusById])

  // Extract real-time browser tool calls from streaming thoughts
  // This enables BrowserTaskCard to show operations as they happen
  // Optimized: Single pass with O(1) result lookups instead of multiple filter/map/some
  const streamingBrowserToolCalls = useMemo(() => {
    // Pre-build result ID Set for O(1) lookup
    const resultIds = new Set<string>()
    for (const t of runtimeThoughts) {
      if (t.type === 'tool_result') {
        resultIds.add(t.id.replace('_result', '_use'))
      }
    }

    const calls: Array<{id: string; name: string; status: ToolStatus; input: Record<string, unknown>}> = []
    for (const t of runtimeThoughts) {
      // Skip sub-agent thoughts
      if (t.parentToolUseId != null) continue
      // Skip sub-agent/skill tools
      if (t.toolName === 'Task' || t.toolName === 'Agent' || t.toolName === 'Skill') continue
      // Only process browser tool_use
      if (t.type !== 'tool_use' || !t.toolName || !isBrowserTool(t.toolName)) continue

      calls.push({
        id: t.id,
        name: t.toolName,
        status: toolStatusById[t.id] || (resultIds.has(t.id) ? 'success' : 'running'),
        input: t.toolInput || {},
      })
    }
    return calls
  }, [runtimeThoughts, toolStatusById])

  const hasStreamingOutput = useMemo(() => streamingContent.trim().length > 0, [streamingContent])

  const latestRuntimeTodos = useMemo(() => {
    for (let i = runtimeThoughts.length - 1; i >= 0; i--) {
      const thought = runtimeThoughts[i]
      if (thought.type !== 'tool_use' || thought.toolName !== 'TodoWrite' || !thought.toolInput) {
        continue
      }
      return parseTodoInput(thought.toolInput)
    }
    return []
  }, [runtimeThoughts])

  const shouldShowOuterTodoCard = isGenerating && !hasStreamingOutput && latestRuntimeTodos.length > 0

  const mcpActivityItems = useMemo(() => {
    const resultStatusById = new Map<string, ToolStatus>()
    for (const thought of runtimeThoughts) {
      if (thought.type !== 'tool_result') continue
      resultStatusById.set(thought.id, thought.isError ? 'error' : 'success')
    }

    const seen = new Set<string>()
    const items: McpActivityItem[] = []
    for (const thought of runtimeThoughts) {
      if (thought.type !== 'tool_use' || !thought.id || !thought.toolName) continue
      if (!isMcpToolName(thought.toolName)) continue
      if (seen.has(thought.id)) continue
      seen.add(thought.id)

      const fallback = resultStatusById.get(thought.id) ?? 'running'
      const resolvedStatus = toolStatusById[thought.id] || fallback
      const parsed = parseMcpToolName(thought.toolName)
      if (!parsed) continue
      const parsedTimestamp = Date.parse(thought.timestamp)
      const timestampMs = Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0

      items.push({
        id: thought.id,
        serverName: parsed.serverName,
        serverLabel: getMcpServerDisplayName(parsed.serverName),
        actionLabel: formatMcpActionDisplay(thought.toolName),
        status: resolvedStatus,
        timestampMs
      })
    }
    return items
  }, [runtimeThoughts, toolStatusById])

  const mcpRunSummary = useMemo(() => {
    if (mcpActivityItems.length === 0) return null

    let running = 0
    let success = 0
    let error = 0
    let cancelled = 0
    let unknown = 0

    for (const item of mcpActivityItems) {
      switch (item.status) {
        case 'pending':
        case 'running':
        case 'waiting_approval':
          running += 1
          break
        case 'success':
          success += 1
          break
        case 'error':
          error += 1
          break
        case 'cancelled':
          cancelled += 1
          break
        default:
          unknown += 1
          break
      }
    }

    const latest = mcpActivityItems[mcpActivityItems.length - 1]
    const activeItems = mcpActivityItems
      .filter((item) => isRunningLikeStatus(item.status) || item.status === 'unknown')
      .slice(-3)

    const serverLabels = Array.from(new Set(mcpActivityItems.map((item) => item.serverLabel)))

    return {
      totalCalls: mcpActivityItems.length,
      running,
      success,
      error,
      cancelled,
      unknown,
      latest,
      activeItems,
      serverLabels
    }
  }, [mcpActivityItems])

  const getStatusLabel = (status: ToolStatus): string => {
    switch (status) {
      case 'pending':
      case 'running':
      case 'waiting_approval':
        return t('Running')
      case 'success':
        return t('Success')
      case 'error':
        return t('Error')
      case 'cancelled':
        return t('Cancelled')
      default:
        return t('Unknown')
    }
  }

  const getStatusClassName = (status: ToolStatus): string => {
    switch (status) {
      case 'pending':
      case 'running':
      case 'waiting_approval':
        return 'text-primary'
      case 'success':
        return 'text-kite-success'
      case 'error':
        return 'text-destructive'
      case 'cancelled':
        return 'text-muted-foreground'
      default:
        return 'text-muted-foreground'
    }
  }

  const renderMcpSummaryPanel = () => {
    if (!mcpRunSummary) return null

    const latestStatusLabel = getStatusLabel(mcpRunSummary.latest.status)
    const latestStatusClass = getStatusClassName(mcpRunSummary.latest.status)
    const latestTimeLabel = mcpRunSummary.latest.timestampMs > 0
      ? new Date(mcpRunSummary.latest.timestampMs).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      : null

    return (
      <div className="space-studio-thought-summary mb-2 rounded-xl border border-border/30 bg-secondary/10 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-md border border-border bg-background/70 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-foreground/80">
            MCP
          </span>
          <span className={`text-[11px] font-medium ${latestStatusClass}`}>
            {latestStatusLabel}
          </span>
        </div>

        <div className="mt-1.5">
          <div className="text-sm text-foreground/90 truncate">
            {mcpRunSummary.latest.actionLabel}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{t('Calls')}: {mcpRunSummary.totalCalls}</span>
            <span>{t('Running')}: {mcpRunSummary.running}</span>
            <span>{t('Success')}: {mcpRunSummary.success}</span>
            <span>{t('Error')}: {mcpRunSummary.error}</span>
            {mcpRunSummary.serverLabels.length > 0 && (
              <span>{mcpRunSummary.serverLabels.join(', ')}</span>
            )}
            {latestTimeLabel && (
              <span>{latestTimeLabel}</span>
            )}
          </div>
        </div>

        {mcpRunSummary.activeItems.length > 0 && (
          <div className="mt-2 space-y-1">
            {mcpRunSummary.activeItems.map((item) => (
              <div
                key={item.id}
                className="inline-flex max-w-full items-center gap-2 rounded-md border border-border/35 bg-background/30 px-2 py-1 text-[11px]"
              >
                <span className="truncate text-foreground/75">{item.actionLabel}</span>
                <span className={`shrink-0 font-medium ${getStatusClassName(item.status)}`}>
                  {getStatusLabel(item.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`
      space-studio-message-stream space-y-3.5 transition-[max-width] duration-300 ease-out
      ${isCompact ? 'space-studio-message-stream-compact' : 'space-studio-message-stream-regular'}
    `}>
      {/* Render completed messages - thoughts shown above assistant messages */}
      {mainMessages.map((message) => {
        const previousCost = previousCostByMessageId.get(message.id) ?? 0
        const messageProcessThoughts = getMessageThoughtsForDisplay(message)
        // Show collapsed thoughts ABOVE assistant messages, in same container for consistent width
        if (message.role === 'assistant' && messageProcessThoughts.length > 0) {
          const messageTimelineSegments = buildTimelineSegments(messageProcessThoughts)
          const messageSkillSegments = messageTimelineSegments.filter(
            (segment): segment is Extract<TimelineSegment, { type: 'skill' }> => segment.type === 'skill'
          )
          const messageSkillIds = new Set(messageSkillSegments.map((segment) => segment.skillId))
          const messageSkillSourceThoughtIds = new Set(
            messageSkillSegments
              .map((segment) => segment.sourceThoughtId)
              .filter((value): value is string => typeof value === 'string' && value.length > 0)
          )
          const messageThoughtsForDisplay = messageProcessThoughts.filter((thought) => {
            if (messageSkillSourceThoughtIds.has(thought.id)) {
              return false
            }
            if (thought.type === 'tool_use' && thought.toolName === 'Skill') {
              return false
            }
            if (thought.type === 'tool_result' && messageSkillIds.has(thought.id)) {
              return false
            }
            return true
          })
          const messageToolStatusById = Object.fromEntries(
            (message.toolCalls || []).map((toolCall) => [toolCall.id, toolCall.status])
          ) as Record<string, ToolStatus>
          return (
            <div key={message.id} className="flex space-studio-message-lane">
              {/* Fixed width container - prevents width jumping when content changes */}
              <div className="space-studio-message-stack">
                {messageSkillSegments.map((segment) => (
                  <SkillCard
                    key={`completed-${segment.id}`}
                    skillId={segment.skillId}
                    skillName={segment.skillName}
                    skillArgs={segment.skillArgs}
                    isRunning={segment.isRunning}
                    hasError={segment.hasError}
                    result={segment.result}
                  />
                ))}
                {/* Thought process above the message (completed mode = collapsed by default) */}
                {messageThoughtsForDisplay.length > 0 && (
                  <ThoughtProcess
                    thoughts={messageThoughtsForDisplay}
                    toolStatusById={messageToolStatusById}
                    isThinking={false}
                    showTodoCard={true}
                    mode="completed"
                    defaultExpanded={false}
                  />
                )}
                {/* Then the message itself (without embedded thoughts) */}
                <MessageItem
                  message={message}
                  previousCost={previousCost}
                  hideThoughts
                  isInContainer
                  workDir={workDir}
                  resourceDisplayLookups={resourceDisplayLookups}
                  onOpenPlanInCanvas={onOpenPlanInCanvas}
                  onExecutePlan={onExecutePlan}
                />
              </div>
            </div>
          )
        }
        return (
          <MessageItem
            key={message.id}
            message={message}
            previousCost={previousCost}
            workDir={workDir}
            resourceDisplayLookups={resourceDisplayLookups}
            onOpenPlanInCanvas={onOpenPlanInCanvas}
            onExecutePlan={onExecutePlan}
          />
        )
      })}

      {/* Current generation block: Timeline segments + Streaming content below */}
      {/* Use fixed width container to prevent jumping when content changes */}
      {isGenerating && (
        <div className="flex animate-fade-in space-studio-message-lane">
          {/* Fixed width - same as completed messages */}
          <div className="relative space-studio-message-stack">
            {renderMcpSummaryPanel()}

            {/* Render timeline segments in order (thoughts, skills, sub-agents interleaved) */}
            {timelineSegments.map((segment, index) => {
              const isLastSegment = index === timelineSegments.length - 1

              switch (segment.type) {
                case 'thoughts':
                  // Only show isThinking indicator on the last thoughts segment
                  const showThinking = isLastSegment && isThinking && !hasRunningSubAgent
                  if (segment.thoughts.length === 0 && !showThinking) {
                    return null
                  }
                  return (
                    <ThoughtProcess
                      key={segment.id}
                      thoughts={segment.thoughts}
                      parallelGroups={parallelGroups}
                      toolStatusById={toolStatusById}
                      isThinking={showThinking}
                      showTodoCard={hasStreamingOutput}
                      mode="realtime"
                    />
                  )

                case 'skill':
                  return (
                    <SkillCard
                      key={segment.id}
                      skillId={segment.skillId}
                      skillName={segment.skillName}
                      skillArgs={segment.skillArgs}
                      isRunning={segment.isRunning}
                      hasError={segment.hasError}
                      result={segment.result}
                    />
                  )

                case 'subagent':
                  return (
                    <SubAgentCard
                      key={segment.id}
                      agentId={segment.agentId}
                      description={segment.description}
                      subagentType={segment.subagentType}
                      thoughts={segment.thoughts}
                      toolStatusById={toolStatusById}
                      isRunning={
                        toolStatusById[segment.agentId]
                          ? (toolStatusById[segment.agentId] === 'pending'
                            || toolStatusById[segment.agentId] === 'running'
                            || toolStatusById[segment.agentId] === 'waiting_approval')
                          : segment.isRunning
                      }
                      hasError={
                        toolStatusById[segment.agentId]
                          ? toolStatusById[segment.agentId] === 'error'
                          : segment.hasError
                      }
                    />
                  )

                default:
                  return null
              }
            })}

            {/* Show initial thinking indicator when no segments yet */}
            {timelineSegments.length === 0 && isThinking && (
              <ThoughtProcess
                thoughts={[]}
                parallelGroups={parallelGroups}
                toolStatusById={toolStatusById}
                isThinking={true}
                showTodoCard={hasStreamingOutput}
                mode="realtime"
              />
            )}

            {/* Real-time browser task card - shows AI browser operations as they happen */}
            {streamingBrowserToolCalls.length > 0 && (
              <div className="mb-2">
                <BrowserTaskCard
                  browserToolCalls={streamingBrowserToolCalls}
                  isActive={isThinking}
                />
              </div>
            )}

            {/* TodoCard in outer layer while assistant text is still empty */}
            {shouldShowOuterTodoCard && (
              <div className="mb-2">
                <TodoCard todos={latestRuntimeTodos} />
              </div>
            )}

            {/* Guided user updates for active run (rendered inside execution block, not right-side user lane) */}
            {guidedMessages.length > 0 && (
              <div className="mb-2 space-y-2">
                {guidedMessages.map((guidedMessage) => (
                  <div
                    key={guidedMessage.id}
                    className="rounded-xl border border-border bg-secondary/70 px-3 py-2.5"
                  >
                    <div className="mb-1">
                      <span className="inline-flex items-center rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
                        {t('Guide')}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {guidedMessage.content}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Streaming bubble with accumulated content and auto-scroll */}
            {/* Only show when there's content or actively streaming */}
            {(streamingContent || isStreaming) && (
              <StreamingBubble
                content={streamingContent}
                isStreaming={isStreaming}
                thoughts={runtimeThoughts}
                textBlockVersion={textBlockVersion}
                workDir={workDir}
              />
            )}

          </div>
        </div>
      )}

      {!isGenerating && mcpRunSummary && (
        <div className="flex animate-fade-in space-studio-message-lane">
          <div className="space-studio-message-stack">
            {renderMcpSummaryPanel()}
          </div>
        </div>
      )}

      {/* Error message - shown when generation fails (not during generation) */}
      {!isGenerating && error && (
        <div className="flex animate-fade-in space-studio-message-lane">
          <div className="space-studio-message-stack">
            <div className="rounded-2xl px-4 py-3 bg-destructive/10 border border-destructive/30">
              <div className="flex items-center gap-2 text-destructive">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="text-sm font-medium">{t('Something went wrong')}</span>
              </div>
              <p className="mt-2 text-sm text-destructive/80">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Compact notice - shown when context was compressed (runtime notification) */}
      {compactInfo && (
        <CompactNotice trigger={compactInfo.trigger} preTokens={compactInfo.preTokens} />
      )}
    </div>
  )
}
