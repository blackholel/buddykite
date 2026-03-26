import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Sparkles,
  Settings2,
  Trash2
} from 'lucide-react'
import type { ConversationMeta, CreateSpaceInput, Space } from '../../types'
import { SpaceIcon } from '../icons/ToolIcons'
import { getCurrentLanguage, useTranslation } from '../../i18n'
import { api } from '../../api'

interface UnifiedSidebarProps {
  spaces: Space[]
  currentSpaceId: string | null
  currentConversationId: string | null
  conversationsBySpaceId: Map<string, ConversationMeta[]>
  onSelectSpace: (spaceId: string) => Promise<void>
  onExpandSpace: (spaceId: string) => Promise<void>
  onSelectConversation: (spaceId: string, conversationId: string) => Promise<void>
  onCreateSpace: (input: CreateSpaceInput) => Promise<Space | null>
  onCreateConversation: (spaceId: string) => Promise<unknown>
  onRenameSpace: (spaceId: string, name: string) => Promise<void>
  onDeleteSpace: (spaceId: string) => Promise<boolean>
  onRenameConversation: (spaceId: string, conversationId: string, title: string) => Promise<void>
  onDeleteConversation: (spaceId: string, conversationId: string) => Promise<void>
  onOpenAbilities: () => void
  abilitiesOpen: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  onGoSettings: () => void
  initialCreateDialogOpen?: boolean
  showCollapseControl?: boolean
  expandedWidth?: number
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

function getFolderDisplayName(folderPath: string): string {
  const segments = folderPath.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] || folderPath
}

export function UnifiedSidebar({
  spaces,
  currentSpaceId,
  currentConversationId,
  conversationsBySpaceId,
  onSelectSpace,
  onExpandSpace,
  onSelectConversation,
  onCreateSpace,
  onCreateConversation,
  onRenameSpace,
  onDeleteSpace,
  onRenameConversation,
  onDeleteConversation,
  onOpenAbilities,
  abilitiesOpen,
  isCollapsed,
  onToggleCollapse,
  onGoSettings,
  initialCreateDialogOpen = false,
  showCollapseControl = true,
  expandedWidth = 320
}: UnifiedSidebarProps) {
  const { t } = useTranslation()
  const [loadingSpaceIds, setLoadingSpaceIds] = useState<Set<string>>(new Set())
  const loadingSpaceIdsRef = useRef<Set<string>>(new Set())
  const [expandedSpaceId, setExpandedSpaceId] = useState<string | null>(currentSpaceId)
  const [creatingSpace, setCreatingSpace] = useState(initialCreateDialogOpen)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [createPathMode, setCreatePathMode] = useState<'default' | 'custom'>('default')
  const [defaultSpacePath, setDefaultSpacePath] = useState('')
  const [selectedCustomPath, setSelectedCustomPath] = useState<string | null>(null)
  const [loadingDefaultPath, setLoadingDefaultPath] = useState(false)
  const [spaceActionMenuSpaceId, setSpaceActionMenuSpaceId] = useState<string | null>(null)
  const [creatingConversationSpaceId, setCreatingConversationSpaceId] = useState<string | null>(null)
  const [renamingSpace, setRenamingSpace] = useState<{ spaceId: string; name: string } | null>(null)
  const [deleteSpaceTarget, setDeleteSpaceTarget] = useState<{
    spaceId: string
    name: string
    conversationCount: number
  } | null>(null)
  const [deleteSpaceConfirmName, setDeleteSpaceConfirmName] = useState('')
  const [deletingSpaceId, setDeletingSpaceId] = useState<string | null>(null)
  const [editingConversation, setEditingConversation] = useState<{
    spaceId: string
    conversationId: string
    title: string
  } | null>(null)
  const [deleteConversationTarget, setDeleteConversationTarget] = useState<{
    spaceId: string
    conversationId: string
  } | null>(null)

  const sortedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }, [spaces])

  const markSpaceLoading = useCallback((spaceId: string, loading: boolean) => {
    setLoadingSpaceIds((prev) => {
      const next = new Set(prev)
      if (loading) {
        next.add(spaceId)
      } else {
        next.delete(spaceId)
      }
      return next
    })
  }, [])

  const ensureExpandedSpaceLoaded = useCallback(async (spaceId: string) => {
    if (conversationsBySpaceId.has(spaceId) || loadingSpaceIdsRef.current.has(spaceId)) return
    loadingSpaceIdsRef.current.add(spaceId)
    markSpaceLoading(spaceId, true)
    try {
      await onExpandSpace(spaceId)
    } finally {
      loadingSpaceIdsRef.current.delete(spaceId)
      markSpaceLoading(spaceId, false)
    }
  }, [conversationsBySpaceId, markSpaceLoading, onExpandSpace])

  useEffect(() => {
    if (!currentSpaceId) return
    setExpandedSpaceId(currentSpaceId)
    void ensureExpandedSpaceLoaded(currentSpaceId)
  }, [currentSpaceId, ensureExpandedSpaceLoaded])

  useEffect(() => {
    if (!creatingSpace) return
    let isCancelled = false
    setLoadingDefaultPath(true)
    void api.getDefaultSpacePath()
      .then((response) => {
        if (isCancelled) return
        if (response.success && typeof response.data === 'string') {
          setDefaultSpacePath(response.data)
          return
        }
        setDefaultSpacePath('')
      })
      .finally(() => {
        if (isCancelled) return
        setLoadingDefaultPath(false)
      })
    return () => {
      isCancelled = true
    }
  }, [creatingSpace])

  useEffect(() => {
    if (!spaceActionMenuSpaceId) return

    const handleOutsidePointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('[data-space-action-root="true"]')) {
        setSpaceActionMenuSpaceId(null)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSpaceActionMenuSpaceId(null)
      }
    }

    document.addEventListener('mousedown', handleOutsidePointer)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [spaceActionMenuSpaceId])

  const closeCreateSpaceDialog = useCallback(() => {
    setCreatingSpace(false)
    setNewSpaceName('')
    setCreatePathMode('default')
    setSelectedCustomPath(null)
  }, [])

  const handleToggleSpaceExpanded = useCallback((spaceId: string) => {
    const isCurrentSpace = currentSpaceId === spaceId
    if (!isCurrentSpace) {
      setExpandedSpaceId(spaceId)
      void onSelectSpace(spaceId)
      void ensureExpandedSpaceLoaded(spaceId)
      return
    }

    setExpandedSpaceId(spaceId)
    void ensureExpandedSpaceLoaded(spaceId)
  }, [currentSpaceId, ensureExpandedSpaceLoaded, onSelectSpace])

  const handleSelectSpace = useCallback((spaceId: string) => {
    setExpandedSpaceId(spaceId)
    void ensureExpandedSpaceLoaded(spaceId)
    void onSelectSpace(spaceId)
  }, [ensureExpandedSpaceLoaded, onSelectSpace])

  const handleSelectCustomPath = useCallback(async () => {
    const result = await api.selectFolder()
    if (!result.success || typeof result.data !== 'string' || !result.data) return
    setSelectedCustomPath(result.data)
    setCreatePathMode('custom')
    setNewSpaceName((prev) => prev.trim() ? prev : getFolderDisplayName(result.data))
  }, [])

  const handleCreateSpace = async () => {
    const trimmed = newSpaceName.trim()
    if (!trimmed) return
    const customPath = createPathMode === 'custom' ? (selectedCustomPath || undefined) : undefined
    if (createPathMode === 'custom' && !customPath) return

    const created = await onCreateSpace({
      name: trimmed,
      icon: 'folder',
      customPath
    })
    if (!created) return

    closeCreateSpaceDialog()
  }

  const handleCreateConversation = useCallback(async (spaceId: string) => {
    if (creatingConversationSpaceId) return
    setSpaceActionMenuSpaceId(null)
    setCreatingConversationSpaceId(spaceId)
    try {
      await onCreateConversation(spaceId)
    } finally {
      setCreatingConversationSpaceId((prev) => (prev === spaceId ? null : prev))
    }
  }, [creatingConversationSpaceId, onCreateConversation])

  const handleRenameSpaceSubmit = useCallback(async () => {
    if (!renamingSpace) return
    const trimmed = renamingSpace.name.trim()
    if (!trimmed) return
    await onRenameSpace(renamingSpace.spaceId, trimmed)
    setRenamingSpace(null)
  }, [onRenameSpace, renamingSpace])

  const handleDeleteSpaceConfirm = useCallback(async () => {
    if (!deleteSpaceTarget) return
    if (deleteSpaceConfirmName !== deleteSpaceTarget.name) return
    setDeletingSpaceId(deleteSpaceTarget.spaceId)
    try {
      const success = await onDeleteSpace(deleteSpaceTarget.spaceId)
      if (success) {
        setDeleteSpaceTarget(null)
        setDeleteSpaceConfirmName('')
      }
    } finally {
      setDeletingSpaceId(null)
    }
  }, [deleteSpaceConfirmName, deleteSpaceTarget, onDeleteSpace])

  const handleRenameSubmit = async () => {
    if (!editingConversation) return
    const title = editingConversation.title.trim()
    if (!title) return
    await onRenameConversation(
      editingConversation.spaceId,
      editingConversation.conversationId,
      title
    )
    setEditingConversation(null)
  }

  const handleOpenCreateSpace = useCallback(() => {
    setCreatingSpace(true)
  }, [])

  const handleConfirmDeleteConversation = useCallback(async () => {
    if (!deleteConversationTarget) return
    const { spaceId, conversationId } = deleteConversationTarget
    setDeleteConversationTarget(null)
    await onDeleteConversation(spaceId, conversationId)
  }, [deleteConversationTarget, onDeleteConversation])

  return (
    <aside
      className={`space-studio-sidebar space-studio-conversation-panel space-studio-reveal h-full shrink-0 border-r border-border/60 bg-card backdrop-blur-sm overflow-hidden ${
        isCollapsed ? 'space-studio-collapsed-rail w-[62px]' : ''
      }`}
      style={isCollapsed ? undefined : { width: expandedWidth }}
    >
      {isCollapsed ? (
        <div className="h-full flex flex-col">
          {showCollapseControl && (
            <div className="drag-region h-10">
              <div className="h-full px-2 flex items-start justify-center">
                <button
                  onClick={onToggleCollapse}
                  className="space-studio-collapsed-rail-btn no-drag"
                  title={t('展开侧边栏')}
                  aria-label={t('展开侧边栏')}
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 flex flex-col items-center py-3 gap-2">
            <button
              onClick={handleOpenCreateSpace}
              className="space-studio-collapsed-rail-btn"
              title={t('新建工作区')}
              aria-label={t('新建工作区')}
            >
              <FolderPlus className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenAbilities}
              className="space-studio-collapsed-rail-btn"
              title={t('技能')}
              aria-label={t('技能')}
              aria-pressed={abilitiesOpen}
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <span className="space-studio-collapsed-rail-count">{sortedSpaces.length}</span>
            <div className="mt-auto mb-2">
              <button
                onClick={onGoSettings}
                className="space-studio-collapsed-rail-btn"
                title={t('设置')}
                aria-label={t('设置')}
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-full flex flex-col">
          {showCollapseControl && (
            <div className="drag-region h-10">
              <div className="h-full px-2 flex items-start justify-end">
                <button
                  onClick={onToggleCollapse}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground no-drag"
                  title={t('折叠侧边栏')}
                  aria-label={t('折叠侧边栏')}
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <div className="space-studio-conversation-head px-4 py-3 border-b border-border/60">
            <div className="space-y-1">
              <button
                onClick={handleOpenCreateSpace}
                className="inline-flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-left text-foreground hover:bg-secondary/70"
                title={t('新建工作区')}
                aria-label={t('新建工作区')}
              >
                <FolderPlus className="w-4 h-4 text-muted-foreground" />
                <span>{t('新建工作区')}</span>
              </button>
            </div>

            <button
              onClick={onOpenAbilities}
              className="mt-1 inline-flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-left text-foreground transition-colors hover:bg-secondary/70"
              title={t('技能')}
              aria-label={t('技能')}
              aria-pressed={abilitiesOpen}
            >
              <Sparkles className="w-4 h-4 text-muted-foreground" />
              <span>{t('技能')}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3">
            <div className="px-2 pb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground/75">
                {t('工作区')}
              </span>
              <button
                onClick={() => setCreatingSpace(true)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                title={t('新建工作区')}
                aria-label={t('新建工作区')}
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>

            {sortedSpaces.map((space) => {
              const hasLoadedConversations = conversationsBySpaceId.has(space.id)
              const isSpaceLoading = loadingSpaceIds.has(space.id)
              const isExpanded = expandedSpaceId === space.id
              const conversations = (conversationsBySpaceId.get(space.id) || [])
                .slice()
                .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
              const isActiveSpace = currentSpaceId === space.id
              const isCreatingConversation = creatingConversationSpaceId === space.id
              const isDeletingSpace = deletingSpaceId === space.id
              const statusLabel = !isActiveSpace
                ? (hasLoadedConversations
                  ? t('{{count}} conversations', { count: conversations.length })
                  : formatRelativeTime(space.updatedAt, t))
                : null
              const isActionMenuOpen = spaceActionMenuSpaceId === space.id

              return (
                <div key={space.id} className="unified-space-row mb-1 rounded-xl">
                  <div className={`unified-space-row-header flex items-center gap-1 px-2 py-1.5 rounded-xl ${isActiveSpace ? 'is-active bg-secondary/80' : 'hover:bg-secondary/50'}`}>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        handleToggleSpaceExpanded(space.id)
                      }}
                      className="p-1 rounded-md hover:bg-background/60 transition-colors"
                      title={isExpanded ? t('Collapse') : t('Expand')}
                      aria-label={isExpanded ? t('Collapse') : t('Expand')}
                      aria-expanded={isExpanded}
                      aria-controls={`space-panel-${space.id}`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={() => handleSelectSpace(space.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                    >
                      <SpaceIcon iconId={space.icon} size={16} />
                      <span className="text-sm truncate">{space.isTemp ? 'Kite' : space.name}</span>
                    </button>
                    {statusLabel ? (
                      <span className="unified-space-row-status text-[11px] text-muted-foreground bg-background/60 rounded-md px-1.5 py-0.5">
                        {statusLabel}
                      </span>
                    ) : null}
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleCreateConversation(space.id)
                      }}
                      disabled={isCreatingConversation || isDeletingSpace}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('新建会话')}
                      aria-label={t('新建会话')}
                    >
                      {isCreatingConversation ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <div data-space-action-root="true" className="relative unified-space-row-actions">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          setSpaceActionMenuSpaceId((prev) => (prev === space.id ? null : space.id))
                        }}
                        disabled={isCreatingConversation || isDeletingSpace}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t('更多操作')}
                        aria-label={t('更多操作')}
                        aria-expanded={isActionMenuOpen}
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {isActionMenuOpen && (
                        <div className="absolute right-0 top-7 z-30 min-w-[160px] rounded-lg border border-border bg-popover p-1.5 shadow-lg">
                          <button
                            onClick={() => void handleCreateConversation(space.id)}
                            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left hover:bg-secondary/80"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{t('新建会话')}</span>
                          </button>
                          <button
                            onClick={() => {
                              setSpaceActionMenuSpaceId(null)
                              setRenamingSpace({ spaceId: space.id, name: space.name })
                            }}
                            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left hover:bg-secondary/80"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>{t('重命名工作区')}</span>
                          </button>
                          {!space.isTemp && (
                            <button
                              onClick={() => {
                                setSpaceActionMenuSpaceId(null)
                                setDeleteSpaceTarget({
                                  spaceId: space.id,
                                  name: space.name,
                                  conversationCount: conversations.length
                                })
                                setDeleteSpaceConfirmName('')
                              }}
                              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{t('删除工作区')}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div id={`space-panel-${space.id}`} className="unified-space-conversation-list pl-7 pr-2 pb-1">
                      {!hasLoadedConversations || isSpaceLoading ? (
                        <div className="text-xs text-muted-foreground px-2 py-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {t('Loading...')}
                          </span>
                        </div>
                      ) : conversations.length === 0 ? (
                        <div className="text-xs text-muted-foreground px-2 py-1.5">
                          {t('暂无对话')}
                        </div>
                      ) : (
                        conversations.map((conversation) => {
                          const isActiveConversation = isActiveSpace && currentConversationId === conversation.id
                          const isEditing = editingConversation?.conversationId === conversation.id
                          const titleText = conversation.title.trim() || t('New conversation')
                          const relativeTimeText = formatRelativeTime(conversation.updatedAt, t)

                          return (
                            <div
                              key={`${space.id}:${conversation.id}`}
                              data-conversation-id={conversation.id}
                              className={`group space-studio-history-simple-item unified-sidebar-history-item ${
                                isActiveSpace ? 'unified-sidebar-history-item-current-space' : ''
                              } ${isActiveConversation ? 'is-active' : ''}`}
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  value={editingConversation.title}
                                  onChange={(event) => setEditingConversation({
                                    ...editingConversation,
                                    title: event.target.value
                                  })}
                                  onBlur={() => void handleRenameSubmit()}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      void handleRenameSubmit()
                                    }
                                    if (event.key === 'Escape') {
                                      setEditingConversation(null)
                                    }
                                  }}
                                  className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-0.5 text-xs"
                                />
                              ) : (
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                  <div className="flex-1 min-w-0">
                                    <button
                                      onClick={() => void onSelectConversation(space.id, conversation.id)}
                                      className="space-studio-history-simple-title block w-full min-w-0 text-left truncate"
                                      title={conversation.title}
                                    >
                                      {titleText}
                                    </button>
                                  </div>
                                  <div className="unified-sidebar-history-tail">
                                    <span
                                      data-slot="time"
                                      aria-hidden={isActiveConversation}
                                      className={`unified-sidebar-history-time ${isActiveConversation ? 'is-collapsed' : 'is-visible'}`}
                                      title={new Date(conversation.updatedAt).toLocaleString(getCurrentLanguage())}
                                    >
                                      {relativeTimeText}
                                    </span>
                                    <div
                                      data-slot="actions"
                                      className={`unified-sidebar-history-actions ${isActiveConversation ? 'is-active' : ''}`}
                                    >
                                      <button
                                        onClick={() => setEditingConversation({
                                          spaceId: space.id,
                                          conversationId: conversation.id,
                                          title: conversation.title
                                        })}
                                        className={`space-studio-history-action-btn unified-sidebar-history-action ${isActiveConversation ? 'is-visible' : ''}`}
                                        title={t('Rename')}
                                        aria-label={t('Rename')}
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setDeleteConversationTarget({
                                            spaceId: space.id,
                                            conversationId: conversation.id
                                          })
                                        }}
                                        className={`space-studio-history-action-btn unified-sidebar-history-action text-destructive ${isActiveConversation ? 'is-visible' : ''}`}
                                        title={t('Delete')}
                                        aria-label={t('Delete')}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="space-studio-sidebar-tools px-4 py-3 border-t border-border/60">
            <button
              onClick={onGoSettings}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/70"
              title={t('Settings')}
              aria-label={t('Settings')}
            >
              <span>{t('设置')}</span>
            </button>
          </div>
        </div>
      )}

      {creatingSpace && (
        <div
          className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4"
          onClick={closeCreateSpaceDialog}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">{t('新建工作区')}</h3>
            <input
              autoFocus
              value={newSpaceName}
              onChange={(event) => setNewSpaceName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreateSpace()
                }
              }}
              placeholder={t('工作区名称')}
              className="mt-3 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
            <div className="mt-3 rounded-lg border border-border/60 p-2.5 space-y-2">
              <div className="text-xs text-muted-foreground">{t('创建位置')}</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCreatePathMode('default')}
                  className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                    createPathMode === 'default'
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border hover:bg-secondary/70'
                  }`}
                >
                  {t('默认目录')}
                </button>
                <button
                  onClick={() => setCreatePathMode('custom')}
                  className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                    createPathMode === 'custom'
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border hover:bg-secondary/70'
                  }`}
                >
                  {t('本地文件夹')}
                </button>
              </div>
              {createPathMode === 'custom' ? (
                <div className="space-y-2">
                  <button
                    onClick={() => void handleSelectCustomPath()}
                    className="w-full px-2 py-1.5 text-xs rounded-md border border-border hover:bg-secondary/70"
                  >
                    {t('选择文件夹')}
                  </button>
                  <div className="text-xs text-muted-foreground break-all">
                    {selectedCustomPath || t('未选择文件夹')}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground break-all">
                  {loadingDefaultPath ? t('Loading...') : defaultSpacePath || t('Loading...')}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeCreateSpaceDialog}
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary/70"
              >
                {t('取消')}
              </button>
              <button
                onClick={() => void handleCreateSpace()}
                disabled={!newSpaceName.trim() || (createPathMode === 'custom' && !selectedCustomPath)}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('创建工作区')}
              </button>
            </div>
          </div>
        </div>
      )}

      {renamingSpace && (
        <div
          className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4"
          onClick={() => setRenamingSpace(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">{t('重命名工作区')}</h3>
            <input
              autoFocus
              value={renamingSpace.name}
              onChange={(event) => setRenamingSpace({
                ...renamingSpace,
                name: event.target.value
              })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleRenameSpaceSubmit()
                }
              }}
              placeholder={t('工作区名称')}
              className="mt-3 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRenamingSpace(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary/70"
              >
                {t('取消')}
              </button>
              <button
                onClick={() => void handleRenameSpaceSubmit()}
                disabled={!renamingSpace.name.trim()}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('保存')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteSpaceTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4"
          onClick={() => setDeleteSpaceTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">{t('删除工作区')}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {`将删除工作区「${deleteSpaceTarget.name}」及其 ${deleteSpaceTarget.conversationCount} 个会话。`}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('默认目录会删除整个工作区文件夹；自定义目录仅删除 .kite 数据。')}
            </p>
            <input
              autoFocus
              value={deleteSpaceConfirmName}
              onChange={(event) => setDeleteSpaceConfirmName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleDeleteSpaceConfirm()
                }
              }}
              placeholder={t('请输入工作区名称以确认')}
              className="mt-3 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteSpaceTarget(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary/70"
              >
                {t('取消')}
              </button>
              <button
                onClick={() => void handleDeleteSpaceConfirm()}
                disabled={deleteSpaceConfirmName !== deleteSpaceTarget.name || deletingSpaceId === deleteSpaceTarget.spaceId}
                className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingSpaceId === deleteSpaceTarget.spaceId ? t('Deleting...') : t('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConversationTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4"
          onClick={() => setDeleteConversationTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">{t('Delete this conversation?')}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('This action cannot be undone.')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConversationTarget(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary/70"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={() => void handleConfirmDeleteConversation()}
                className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:opacity-90"
              >
                {t('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
