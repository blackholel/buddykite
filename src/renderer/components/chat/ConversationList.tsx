/**
 * Conversation List - Minimal sidebar history
 *
 * Design:
 * - Clean single-line rows
 * - Subtle active state
 * - Compact right-aligned time
 * - Drag-to-resize support
 * - Inline title editing
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ConversationMeta } from '../../types'
import { Plus } from '../icons/ToolIcons'
import { ExternalLink, Pencil, Trash2, MessageCircle, MoreHorizontal, PanelLeftClose } from 'lucide-react'
import { useCanvasLifecycle } from '../../hooks/useCanvasLifecycle'
import { getCurrentLanguage, useTranslation } from '../../i18n'
import { shallow } from 'zustand/shallow'
import { SkillsPanel } from '../skills/SkillsPanel'
import { AgentsPanel } from '../agents/AgentsPanel'
import { CommandsPanel } from '../commands/CommandsPanel'
import { WorkflowsPanel } from '../workflows/WorkflowsPanel'
import type { SkillDefinition } from '../../stores/skills.store'
import type { AgentDefinition } from '../../stores/agents.store'
import { useSkillsStore } from '../../stores/skills.store'
import { useAgentsStore } from '../../stores/agents.store'
import { useCommandsStore } from '../../stores/commands.store'
import { useSpaceStore } from '../../stores/space.store'
import { toResourceKey } from '../../utils/resource-key'
import { commandKey } from '../../../shared/command-utils'

// Width constraints (in pixels)
const MIN_WIDTH = 240
const MAX_WIDTH = 360
const DEFAULT_WIDTH = 286
const CREATE_SKILLS_TRIGGER = '创建技能'
const CREATE_AGENTS_TRIGGER = '创建代理'
const CREATE_COMMANDS_TRIGGER = '创建命令'

function localizedResourceName(item: { name: string; displayName?: string; namespace?: string }): string {
  const base = item.displayName || item.name
  return item.namespace ? `${item.namespace}:${base}` : base
}

function formatRelativeTime(dateString: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return t('Just now')
  if (diffMins < 60) return t('{{count}} minutes ago', { count: diffMins })
  if (diffHours < 24) return t('{{count}} hours ago', { count: diffHours })
  if (diffDays < 7) return t('{{count}} days ago', { count: diffDays })

  return new Intl.DateTimeFormat(getCurrentLanguage(), {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

function formatCompactTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  const language = getCurrentLanguage().toLowerCase()
  const isChinese = language.startsWith('zh')

  if (diffMins < 1) return isChinese ? '刚刚' : 'now'
  if (diffMins < 60) return isChinese ? `${diffMins}分` : `${diffMins}m`
  if (diffHours < 24) return isChinese ? `${diffHours}时` : `${diffHours}h`
  if (diffDays < 7) return isChinese ? `${diffDays}天` : `${diffDays}d`

  return new Intl.DateTimeFormat(getCurrentLanguage(), {
    month: 'numeric',
    day: 'numeric'
  }).format(date)
}

interface ConversationListProps {
  conversations: ConversationMeta[]
  currentConversationId?: string
  spaceId?: string
  spaceName?: string
  layoutMode?: 'split' | 'tabs-only'
  onSelect: (id: string) => void
  onNew: () => void
  onToggleCollapse?: () => void
  onDelete?: (id: string) => void
  onRename?: (id: string, newTitle: string) => void
  workDir?: string
  onSelectSkill?: (skill: SkillDefinition) => void
  onInsertSkill?: (skillName: string) => void
  onCreateSkill?: () => void
  onSelectAgent?: (agent: AgentDefinition) => void
  onInsertAgent?: (agentName: string) => void
  onCreateAgent?: () => void
  onInsertCommand?: (commandName: string) => void
  onCreateCommand?: () => void
}

export function ConversationList({
  conversations,
  currentConversationId,
  spaceId,
  spaceName,
  layoutMode = 'split',
  onSelect,
  onNew,
  onToggleCollapse,
  onDelete,
  onRename,
  workDir,
  onSelectSkill,
  onInsertSkill,
  onCreateSkill,
  onSelectAgent,
  onInsertAgent,
  onCreateAgent,
  onInsertCommand,
  onCreateCommand
}: ConversationListProps) {
  const { t } = useTranslation()
  const { openChat } = useCanvasLifecycle()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [actionTriggerId, setActionTriggerId] = useState<string | null>(null)
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  const dragWidthRafRef = useRef<number | null>(null)
  const pendingDragWidthRef = useRef<number | null>(null)
  const latestWidthRef = useRef(DEFAULT_WIDTH)
  const containerRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const resolvedWorkDir = useMemo(() => {
    if (workDir && workDir.trim()) return workDir
    return currentSpace?.path
  }, [currentSpace?.path, workDir])
  const resolvedSpaceName = useMemo(() => {
    if (spaceName && spaceName.trim()) return spaceName.trim()
    if (currentSpace?.name?.trim()) return currentSpace.name.trim()
    return t('Current space')
  }, [currentSpace?.name, spaceName, t])

  const { skills, loadedWorkDir: loadedSkillsWorkDir, loadSkills } = useSkillsStore((state) => ({
    skills: state.skills,
    loadedWorkDir: state.loadedWorkDir,
    loadSkills: state.loadSkills
  }), shallow)
  const { agents, loadedWorkDir: loadedAgentsWorkDir, loadAgents } = useAgentsStore((state) => ({
    agents: state.agents,
    loadedWorkDir: state.loadedWorkDir,
    loadAgents: state.loadAgents
  }), shallow)
  const { commands, loadedWorkDir: loadedCommandsWorkDir, loadCommands } = useCommandsStore((state) => ({
    commands: state.commands,
    loadedWorkDir: state.loadedWorkDir,
    loadCommands: state.loadCommands
  }), shallow)

  useEffect(() => {
    if (skills.length === 0 || loadedSkillsWorkDir !== (resolvedWorkDir ?? null)) {
      void loadSkills(resolvedWorkDir)
    }
  }, [loadSkills, loadedSkillsWorkDir, resolvedWorkDir, skills.length])

  useEffect(() => {
    if (agents.length === 0 || loadedAgentsWorkDir !== (resolvedWorkDir ?? null)) {
      void loadAgents(resolvedWorkDir)
    }
  }, [agents.length, loadAgents, loadedAgentsWorkDir, resolvedWorkDir])

  useEffect(() => {
    if (commands.length === 0 || loadedCommandsWorkDir !== (resolvedWorkDir ?? null)) {
      void loadCommands(resolvedWorkDir)
    }
  }, [commands.length, loadCommands, loadedCommandsWorkDir, resolvedWorkDir])

  const skillDisplayMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of skills) {
      map.set(toResourceKey(item), localizedResourceName(item))
    }
    return map
  }, [skills])

  const agentDisplayMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of agents) {
      map.set(toResourceKey(item), localizedResourceName(item))
    }
    return map
  }, [agents])

  const commandDisplayMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of commands) {
      map.set(commandKey(item), localizedResourceName(item))
    }
    return map
  }, [commands])

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }, [conversations])

  const localizeTriggerText = useCallback((text: string): string => {
    const match = text.match(/^([/@])([^\s]+)([\s\S]*)$/)
    if (!match) return text

    const prefix = match[1]
    const key = match[2]
    const tail = match[3] || ''

    if (prefix === '@') {
      const localized = agentDisplayMap.get(key)
      return localized ? `${prefix}${localized}${tail}` : text
    }

    const localizedSkill = skillDisplayMap.get(key)
    const localizedCommand = commandDisplayMap.get(key)
    if (localizedSkill && localizedCommand && localizedSkill !== localizedCommand) {
      return text
    }

    const localized = localizedSkill || localizedCommand
    return localized ? `${prefix}${localized}${tail}` : text
  }, [agentDisplayMap, commandDisplayMap, skillDisplayMap])

  useEffect(() => {
    latestWidthRef.current = width
  }, [width])

  const applyDragWidth = useCallback((nextWidth: number) => {
    latestWidthRef.current = nextWidth
    setWidth((prevWidth) => (prevWidth === nextWidth ? prevWidth : nextWidth))
  }, [])

  const scheduleDragWidthUpdate = useCallback((nextWidth: number) => {
    pendingDragWidthRef.current = nextWidth
    if (dragWidthRafRef.current !== null) return

    dragWidthRafRef.current = window.requestAnimationFrame(() => {
      dragWidthRafRef.current = null
      const pendingWidth = pendingDragWidthRef.current
      pendingDragWidthRef.current = null
      if (pendingWidth == null) return
      applyDragWidth(pendingWidth)
    })
  }, [applyDragWidth])

  const flushDragWidthUpdate = useCallback((): number => {
    if (dragWidthRafRef.current !== null) {
      window.cancelAnimationFrame(dragWidthRafRef.current)
      dragWidthRafRef.current = null
    }

    const pendingWidth = pendingDragWidthRef.current
    pendingDragWidthRef.current = null
    if (pendingWidth == null) return latestWidthRef.current

    applyDragWidth(pendingWidth)
    return pendingWidth
  }, [applyDragWidth])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const clampWidthAtPosition = (clientX: number): number | null => {
      if (!containerRef.current) return null
      const containerRect = containerRef.current.getBoundingClientRect()
      const nextWidth = clientX - containerRect.left
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, nextWidth))
    }

    const handleMouseMove = (e: MouseEvent) => {
      const clampedWidth = clampWidthAtPosition(e.clientX)
      if (clampedWidth == null) return
      scheduleDragWidthUpdate(clampedWidth)
    }

    const handleMouseUp = (e: MouseEvent) => {
      const clampedWidth = clampWidthAtPosition(e.clientX)
      if (clampedWidth != null) {
        pendingDragWidthRef.current = clampedWidth
      }
      flushDragWidthUpdate()
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [flushDragWidthUpdate, isDragging, scheduleDragWidthUpdate])

  useEffect(() => {
    return () => {
      if (dragWidthRafRef.current !== null) {
        window.cancelAnimationFrame(dragWidthRafRef.current)
      }
      dragWidthRafRef.current = null
      pendingDragWidthRef.current = null
    }
  }, [])

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  useEffect(() => {
    setActionMenuId(null)
    setActionTriggerId(null)
  }, [currentConversationId])

  useEffect(() => {
    if (!actionMenuId) return

    const handleOutsidePointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('[data-conversation-action-root=\"true\"]')) {
        setActionMenuId(null)
        setActionTriggerId(null)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenuId(null)
        setActionTriggerId(null)
      }
    }

    document.addEventListener('mousedown', handleOutsidePointer)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [actionMenuId])

  const handleStartEdit = (conv: ConversationMeta) => {
    setActionMenuId(null)
    setActionTriggerId(null)
    setEditingId(conv.id)
    setEditingTitle(conv.title || '')
  }

  const handleSaveEdit = () => {
    if (editingId && editingTitle.trim() && onRename) {
      onRename(editingId, editingTitle.trim())
    }
    setActionMenuId(null)
    setActionTriggerId(null)
    setEditingId(null)
    setEditingTitle('')
  }

  const handleCancelEdit = () => {
    setActionMenuId(null)
    setActionTriggerId(null)
    setEditingId(null)
    setEditingTitle('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleConversationActivate = (conversationId: string) => {
    if (editingId === conversationId) return
    const isCurrentConversation = currentConversationId === conversationId

    if (isCurrentConversation) {
      setActionMenuId(null)
      setActionTriggerId(prev => (prev === conversationId ? null : conversationId))
      return
    }

    setActionMenuId(null)
    setActionTriggerId(null)
    onSelect(conversationId)
  }

  const handleConversationKeyDown = (e: React.KeyboardEvent, conversationId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleConversationActivate(conversationId)
    }
  }

  return (
    <div
      ref={containerRef}
      className="space-studio-sidebar space-studio-conversation-panel space-studio-reveal flex flex-col relative overflow-hidden"
      style={{ width, transition: isDragging ? 'none' : 'width 0.2s ease' }}
    >
      <div className="space-studio-conversation-head px-3 pt-8 pb-2.5 border-b border-[hsl(var(--line-soft)/0.36)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 pt-0.5">
            <p className="text-[10px] font-medium text-muted-foreground/72 uppercase tracking-[0.14em]">
              {t('Current space')}
            </p>
            <p className="mt-1 text-[15px] leading-5 font-semibold text-foreground/92 truncate">
              {resolvedSpaceName}
            </p>
            <p className="text-[12px] text-muted-foreground/78 mt-1 truncate">
              {t('{{count}} conversations', { count: conversations.length })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onNew}
              className="h-[32px] w-[32px] inline-flex items-center justify-center rounded-xl border border-[hsl(var(--line-soft)/0.5)] bg-[hsl(var(--space-right-panel)/0.56)] hover:bg-[hsl(var(--space-right-panel)/0.84)] hover:border-[hsl(var(--line-strong)/0.56)] transition-all duration-200 group"
              title={t('New conversation')}
              aria-label={t('New conversation')}
            >
              <Plus className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
            <button
              onClick={() => onToggleCollapse?.()}
              className="h-[32px] w-[32px] inline-flex items-center justify-center rounded-xl border border-[hsl(var(--line-soft)/0.46)] bg-[hsl(var(--space-right-panel)/0.38)] hover:bg-[hsl(var(--space-right-panel)/0.72)] hover:border-[hsl(var(--line-strong)/0.54)] transition-all duration-200"
              title={t('Collapse conversations')}
              aria-label={t('Collapse conversations')}
            >
              <PanelLeftClose className="w-4 h-4 text-muted-foreground/86" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-2 py-2">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-background/60 border border-border/40 flex items-center justify-center mb-4">
              <MessageCircle className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-xs text-muted-foreground/50">{t('No conversations yet')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedConversations.map((conversation) => {
              const displayTitle = localizeTriggerText((conversation.title || '').trim() || t('New conversation'))
              const isActive = conversation.id === currentConversationId
              const relativeTime = formatRelativeTime(conversation.updatedAt, t)
              const compactTime = formatCompactTime(conversation.updatedAt)
              const isActionMenuOpen = actionMenuId === conversation.id
              const showActionTrigger = actionTriggerId === conversation.id || isActionMenuOpen

              return (
                <div key={conversation.id} className="relative">
                  {editingId === conversation.id ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={handleSaveEdit}
                        className="flex-1 text-sm bg-input border border-border/50 rounded-lg px-3 py-2 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 min-w-0 transition-all"
                        placeholder={t('Conversation title...')}
                        aria-label={t('Conversation title')}
                      />
                    </div>
                  ) : (
                    <>
                      <div
                        onClick={() => handleConversationActivate(conversation.id)}
                        onKeyDown={(e) => handleConversationKeyDown(e, conversation.id)}
                        role="button"
                        tabIndex={0}
                        aria-current={isActive ? 'true' : undefined}
                        aria-label={`${displayTitle} · ${relativeTime}`}
                        className={`space-studio-history-simple-item ${isActive ? 'is-active' : ''}`}
                      >
                        <div className="min-w-0 flex items-center gap-2 flex-1">
                          <p className={`space-studio-history-title truncate leading-6 ${
                            isActive ? 'font-medium text-foreground' : 'text-foreground/90'
                          }`}>
                            {displayTitle}
                          </p>
                        </div>
                        <div className="space-studio-history-tail shrink-0 ml-2" data-conversation-action-root="true">
                          <span className={`space-studio-history-tail-time text-[11px] text-muted-foreground/76 ${showActionTrigger ? 'opacity-0' : 'opacity-100'}`}>
                            {compactTime}
                          </span>
                          <div className={`space-studio-history-tail-trigger ${showActionTrigger ? 'is-visible' : ''}`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                setActionTriggerId(conversation.id)
                                setActionMenuId(prev => prev === conversation.id ? null : conversation.id)
                              }}
                              className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-[hsl(var(--line-soft)/0.48)] bg-[hsl(var(--canvas-bg)/0.9)] hover:bg-[hsl(var(--canvas-bg)/1)] transition-colors"
                              title="Conversation actions"
                              aria-label="Conversation actions"
                              aria-expanded={isActionMenuOpen}
                            >
                              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                          </div>

                          {isActionMenuOpen && (
                            <div className="space-studio-conversation-actions-menu">
                              {spaceId && layoutMode !== 'tabs-only' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    setActionMenuId(null)
                                    openChat(spaceId, conversation.id, conversation.title, resolvedWorkDir)
                                  }}
                                  className="space-studio-conversation-actions-item"
                                  title={t('Open in tab')}
                                  aria-label={t('Open in tab')}
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>{t('Open in tab')}</span>
                                </button>
                              )}
                              {onRename && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    handleStartEdit(conversation)
                                  }}
                                  className="space-studio-conversation-actions-item"
                                  title={t('Edit title')}
                                  aria-label={t('Edit title')}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span>{t('Edit title')}</span>
                                </button>
                              )}
                              {onDelete && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    setActionMenuId(null)
                                    onDelete(conversation.id)
                                  }}
                                  className="space-studio-conversation-actions-item is-danger"
                                  title={t('Delete conversation')}
                                  aria-label={t('Delete conversation')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{t('Delete conversation')}</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="space-studio-sidebar-tools p-3.5 space-y-2">
        <SkillsPanel
          workDir={resolvedWorkDir}
          onSelectSkill={onSelectSkill}
          onInsertSkill={onInsertSkill}
          onCreateSkill={onCreateSkill}
          onInsertCreateSkill={() => onInsertSkill?.(CREATE_SKILLS_TRIGGER)}
          preferInsertOnClick
        />
        <AgentsPanel
          workDir={resolvedWorkDir}
          onSelectAgent={onSelectAgent}
          onInsertAgent={onInsertAgent}
          onCreateAgent={onCreateAgent}
          onInsertCreateAgent={() => onInsertAgent?.(CREATE_AGENTS_TRIGGER)}
          preferInsertOnClick
        />
        <CommandsPanel
          workDir={resolvedWorkDir}
          onInsertCommand={onInsertCommand}
          onCreateCommand={onCreateCommand}
          onInsertCreateCommand={() => onInsertCommand?.(CREATE_COMMANDS_TRIGGER)}
          preferInsertOnClick
        />
        {spaceId && (
          <WorkflowsPanel spaceId={spaceId} />
        )}
      </div>

      <div
        className={`
          absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20
          transition-colors duration-200
          hover:bg-[hsl(var(--space-accent)/0.3)]
          ${isDragging ? 'bg-[hsl(var(--space-accent)/0.4)]' : ''}
        `}
        onMouseDown={handleMouseDown}
        title={t('Drag to resize width')}
        role="separator"
        aria-orientation="vertical"
      />
    </div>
  )
}
