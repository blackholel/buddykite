import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  House,
  Loader2,
  MessageSquarePlus,
  Pencil,
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
  onCreateConversation: (spaceId: string) => Promise<void>
  onRenameConversation: (spaceId: string, conversationId: string, title: string) => Promise<void>
  onDeleteConversation: (spaceId: string, conversationId: string) => Promise<void>
  onGoHome: () => void
  onGoSettings: () => void
  initialCreateDialogOpen?: boolean
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
  onRenameConversation,
  onDeleteConversation,
  onGoHome,
  onGoSettings,
  initialCreateDialogOpen = false
}: UnifiedSidebarProps) {
  const { t } = useTranslation()
  const [loadingSpaceIds, setLoadingSpaceIds] = useState<Set<string>>(new Set())
  const loadingSpaceIdsRef = useRef<Set<string>>(new Set())
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null)
  const [expandedSpaceId, setExpandedSpaceId] = useState<string | null>(currentSpaceId)
  const [creatingSpace, setCreatingSpace] = useState(initialCreateDialogOpen)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [createPathMode, setCreatePathMode] = useState<'default' | 'custom'>('default')
  const [defaultSpacePath, setDefaultSpacePath] = useState('')
  const [selectedCustomPath, setSelectedCustomPath] = useState<string | null>(null)
  const [loadingDefaultPath, setLoadingDefaultPath] = useState(false)
  const [editingConversation, setEditingConversation] = useState<{
    spaceId: string
    conversationId: string
    title: string
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

  return (
    <aside className="w-[320px] h-full border-r border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden">
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
          <div className="min-w-0 flex items-center">
            <button
              onClick={onGoHome}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/70"
              title={t('Home')}
              aria-label={t('Home')}
            >
              <House className="w-3.5 h-3.5" />
              <span>{t('主页')}</span>
            </button>
          </div>
          <button
            onClick={() => setCreatingSpace(true)}
            className="p-2 rounded-lg hover:bg-secondary/80 transition-colors"
            title={t('New space')}
            aria-label={t('New space')}
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {sortedSpaces.map((space) => {
            const hasLoadedConversations = conversationsBySpaceId.has(space.id)
            const isSpaceLoading = loadingSpaceIds.has(space.id)
            const isExpanded = expandedSpaceId === space.id
            const conversations = (conversationsBySpaceId.get(space.id) || [])
              .slice()
              .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            const isActiveSpace = currentSpaceId === space.id
            const statusLabel = isActiveSpace
              ? t('Current')
              : hasLoadedConversations
                ? t('{{count}} conversations', { count: conversations.length })
                : formatRelativeTime(space.updatedAt, t)

            return (
              <div
                key={space.id}
                className="mb-1 rounded-xl"
                onMouseEnter={() => setHoveredSpaceId(space.id)}
                onMouseLeave={() => setHoveredSpaceId((prev) => (prev === space.id ? null : prev))}
              >
                <div className={`flex items-center gap-1 px-2 py-1.5 rounded-xl ${isActiveSpace ? 'bg-secondary/80' : 'hover:bg-secondary/50'}`}>
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

                  <span className="text-[11px] text-muted-foreground bg-background/60 rounded-md px-1.5 py-0.5">
                    {statusLabel}
                  </span>

                  {hoveredSpaceId === space.id && isActiveSpace && (
                    <button
                      onClick={() => void onCreateConversation(space.id)}
                      className="p-1 rounded-md hover:bg-background/60 transition-colors"
                      title={t('New conversation')}
                      aria-label={t('New conversation')}
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div id={`space-panel-${space.id}`} className="pl-7 pr-2 pb-1">
                    {!hasLoadedConversations || isSpaceLoading ? (
                      <div className="text-xs text-muted-foreground px-2 py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {t('Loading...')}
                        </span>
                      </div>
                    ) : conversations.length === 0 ? (
                      <div className="text-xs text-muted-foreground px-2 py-1.5">
                        {t('No conversations yet')}
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
                            className={`group flex items-start gap-1 px-2 py-1.5 rounded-lg ${isActiveConversation ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/50'}`}
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
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <button
                                    onClick={() => void onSelectConversation(space.id, conversation.id)}
                                    className="flex-1 min-w-0 text-left text-xs truncate leading-5"
                                    title={conversation.title}
                                  >
                                    {titleText}
                                  </button>
                                  <span
                                    className={`text-[11px] shrink-0 ${
                                      isActiveConversation ? 'text-primary/80' : 'text-muted-foreground'
                                    }`}
                                    title={new Date(conversation.updatedAt).toLocaleString(getCurrentLanguage())}
                                  >
                                    {relativeTimeText}
                                  </span>
                                </div>
                              </div>
                            )}

                            {!isEditing && (
                              <>
                                <button
                                  onClick={() => setEditingConversation({
                                    spaceId: space.id,
                                    conversationId: conversation.id,
                                    title: conversation.title
                                  })}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-background/60 transition-all"
                                  title={t('Rename')}
                                  aria-label={t('Rename')}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (!window.confirm(t('Delete this conversation?'))) return
                                    void onDeleteConversation(space.id, conversation.id)
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-destructive transition-all"
                                  title={t('Delete')}
                                  aria-label={t('Delete')}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
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

        <div className="px-4 py-3 border-t border-border/60">
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

      {creatingSpace && (
        <div
          className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4"
          onClick={closeCreateSpaceDialog}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">{t('Create space')}</h3>
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
              placeholder={t('Space name')}
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
                {t('Cancel')}
              </button>
              <button
                onClick={() => void handleCreateSpace()}
                disabled={!newSpaceName.trim() || (createPathMode === 'custom' && !selectedCustomPath)}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
