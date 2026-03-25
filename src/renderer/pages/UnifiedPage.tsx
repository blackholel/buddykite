import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import { FolderOpen } from 'lucide-react'
import { ChatView } from '../components/chat/ChatView'
import { UnifiedSidebar } from '../components/unified/UnifiedSidebar'
import { GitBashWarningBanner } from '../components/setup/GitBashWarningBanner'
import { ArtifactRail } from '../components/artifact/ArtifactRail'
import { ExtensionsView } from '../components/home/ExtensionsView'
import { CanvasTabBar, CollapsibleCanvas } from '../components/canvas'
import { useSearchShortcuts } from '../hooks/useSearchShortcuts'
import { useCanvasLifecycle } from '../hooks/useCanvasLifecycle'
import { useAppStore } from '../stores/app.store'
import { useChatStore } from '../stores/chat.store'
import { useSearchStore, type SearchScope } from '../stores/search.store'
import { useSpaceStore } from '../stores/space.store'
import { navigateToSpaceContext } from '../utils/space-conversation-navigation'
import { pickEntryConversation } from '../utils/space-entry-conversation'
import { useTranslation } from '../i18n'
import type { ConversationMeta, CreateSpaceInput } from '../types'

function pickPreferredSpace<T extends { id: string }>(
  currentSpace: T | null,
  kiteSpace: T | null,
  spaces: T[]
): T | null {
  return currentSpace || kiteSpace || spaces[0] || null
}

export function UnifiedPage() {
  const { t } = useTranslation()
  const {
    setView,
    mockBashMode,
    gitBashInstallProgress,
    startGitBashInstall
  } = useAppStore((state) => ({
    setView: state.setView,
    mockBashMode: state.mockBashMode,
    gitBashInstallProgress: state.gitBashInstallProgress,
    startGitBashInstall: state.startGitBashInstall
  }), shallow)
  const {
    currentSpace,
    kiteSpace,
    spaces,
    loadSpaces,
    setCurrentSpace: setSpaceStoreCurrentSpace,
    createSpace
  } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace,
    kiteSpace: state.kiteSpace,
    spaces: state.spaces,
    loadSpaces: state.loadSpaces,
    setCurrentSpace: state.setCurrentSpace,
    createSpace: state.createSpace
  }), shallow)
  const {
    currentSpaceId,
    currentConversationId,
    currentConversationMeta,
    spaceStates,
    setCurrentSpace: setChatCurrentSpace,
    loadConversations,
    selectConversation,
    renameConversation,
    deleteConversation
  } = useChatStore((state) => ({
    currentSpaceId: state.currentSpaceId,
    currentConversationId: state.getCurrentConversationId(),
    currentConversationMeta: state.getCurrentConversationMeta(),
    spaceStates: state.spaceStates,
    setCurrentSpace: state.setCurrentSpace,
    loadConversations: state.loadConversations,
    selectConversation: state.selectConversation,
    renameConversation: state.renameConversation,
    deleteConversation: state.deleteConversation
  }), shallow)
  const { openSearch } = useSearchStore((state) => ({
    openSearch: state.openSearch
  }), shallow)
  const {
    tabs: canvasTabs,
    activeTab,
    isOpen: isCanvasOpen,
    setOpen: setCanvasOpen,
    openChat,
    switchSpaceSession
  } = useCanvasLifecycle()

  const allSpaces = useMemo(() => {
    if (!kiteSpace) return spaces
    return [kiteSpace, ...spaces]
  }, [kiteSpace, spaces])
  const spaceById = useMemo(() => {
    const result = new Map<string, (typeof allSpaces)[number]>()
    for (const space of allSpaces) {
      result.set(space.id, space)
    }
    return result
  }, [allSpaces])

  const conversationsBySpaceId = useMemo(() => {
    const result = new Map<string, ConversationMeta[]>()
    for (const [spaceId, state] of spaceStates.entries()) {
      result.set(spaceId, state.conversations)
    }
    return result
  }, [spaceStates])
  const resolveSpaceTabLabel = useCallback((spaceId: string) => {
    const space = spaceById.get(spaceId)
    if (!space) return t('Unknown space')
    return space.isTemp ? 'Kite' : space.name
  }, [spaceById, t])
  const loadingSpaceIdsRef = useRef<Set<string>>(new Set())
  const conversationSelectTicketRef = useRef(0)
  const [artifactRailExpanded, setArtifactRailExpanded] = useState(true)
  const [rightPanelMode, setRightPanelMode] = useState<'artifacts' | 'abilities'>('artifacts')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const ensureSpaceConversationsLoaded = useCallback(async (spaceId: string) => {
    if (spaceStates.has(spaceId) || loadingSpaceIdsRef.current.has(spaceId)) return
    loadingSpaceIdsRef.current.add(spaceId)
    try {
      await loadConversations(spaceId)
    } finally {
      loadingSpaceIdsRef.current.delete(spaceId)
    }
  }, [loadConversations, spaceStates])

  const handleSearchShortcut = useCallback((scope: SearchScope) => {
    openSearch(scope)
  }, [openSearch])

  useSearchShortcuts({
    enabled: true,
    onSearch: handleSearchShortcut
  })

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  // Keep both stores aligned when entering Unified page.
  useEffect(() => {
    const preferred = pickPreferredSpace(currentSpace, kiteSpace, spaces)
    if (!preferred) return

    if (!currentSpace || currentSpace.id !== preferred.id) {
      setSpaceStoreCurrentSpace(preferred)
    }
    if (currentSpaceId !== preferred.id) {
      setChatCurrentSpace(preferred.id)
    }
  }, [
    currentSpace?.id,
    currentSpace,
    currentSpaceId,
    kiteSpace,
    setChatCurrentSpace,
    setSpaceStoreCurrentSpace,
    spaces
  ])

  useEffect(() => {
    if (!currentSpaceId || spaceStates.has(currentSpaceId)) return
    void ensureSpaceConversationsLoaded(currentSpaceId)
  }, [currentSpaceId, ensureSpaceConversationsLoaded, spaceStates])

  useEffect(() => {
    if (!currentSpaceId) return
    void switchSpaceSession(currentSpaceId)
  }, [currentSpaceId, switchSpaceSession])

  useEffect(() => {
    if (!currentSpaceId) return
    const spaceState = spaceStates.get(currentSpaceId)
    if (!spaceState || spaceState.currentConversationId || spaceState.conversations.length === 0) return
    const entry = pickEntryConversation(spaceState.conversations) || spaceState.conversations[0]
    void selectConversation(entry.id)
  }, [currentSpaceId, selectConversation, spaceStates])

  useEffect(() => {
    if (!currentSpaceId || !currentConversationId) return
    const currentConversationTabExists = canvasTabs.some(
      (tab) => tab.type === 'chat' && tab.spaceId === currentSpaceId && tab.conversationId === currentConversationId
    )
    if (currentConversationTabExists) return

    const targetSpace = spaceById.get(currentSpaceId)
    const conversationTitle = currentConversationMeta?.title?.trim() || t('New conversation')
    const workDir = targetSpace?.path
    void openChat(
      currentSpaceId,
      currentConversationId,
      conversationTitle,
      workDir,
      resolveSpaceTabLabel(currentSpaceId),
      false
    )
  }, [
    canvasTabs,
    currentConversationId,
    currentConversationMeta?.title,
    currentSpaceId,
    openChat,
    resolveSpaceTabLabel,
    spaceById,
    t
  ])

  const handleSelectSpace = useCallback(async (spaceId: string) => {
    setRightPanelMode('artifacts')
    await navigateToSpaceContext({
      targetSpaceId: spaceId,
      currentSpaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
  }, [
    currentSpaceId,
    spaces,
    kiteSpace,
    setSpaceStoreCurrentSpace,
    setChatCurrentSpace,
    loadConversations
  ])

  const handleExpandSpace = useCallback(async (spaceId: string) => {
    await ensureSpaceConversationsLoaded(spaceId)
  }, [ensureSpaceConversationsLoaded])

  const handleSelectConversation = useCallback(async (spaceId: string, conversationId: string) => {
    const ticket = ++conversationSelectTicketRef.current
    setRightPanelMode('artifacts')
    const conversationTitle = conversationsBySpaceId
      .get(spaceId)
      ?.find((conversation) => conversation.id === conversationId)
      ?.title
      ?.trim() || t('New conversation')
    const targetSpace = spaceById.get(spaceId)
    const workDir = targetSpace?.path
    setCanvasOpen(false)
    const navigationResult = await navigateToSpaceContext({
      targetSpaceId: spaceId,
      currentSpaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
    if (!navigationResult.success || ticket !== conversationSelectTicketRef.current) return

    void selectConversation(conversationId)
    if (ticket !== conversationSelectTicketRef.current) return
    await openChat(spaceId, conversationId, conversationTitle, workDir, resolveSpaceTabLabel(spaceId), false)
  }, [
    conversationsBySpaceId,
    currentSpaceId,
    kiteSpace,
    loadConversations,
    openChat,
    resolveSpaceTabLabel,
    selectConversation,
    setCanvasOpen,
    setChatCurrentSpace,
    setSpaceStoreCurrentSpace,
    spaceById,
    spaces,
    t
  ])

  const handleCreateSpace = useCallback(async (input: CreateSpaceInput) => {
    setRightPanelMode('artifacts')
    const created = await createSpace(input)
    if (!created) return null

    await navigateToSpaceContext({
      targetSpaceId: created.id,
      currentSpaceId,
      spaces: [created, ...spaces],
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
    return created
  }, [
    createSpace,
    currentSpaceId,
    spaces,
    kiteSpace,
    setSpaceStoreCurrentSpace,
    setChatCurrentSpace,
    loadConversations
  ])

  const handleRenameConversation = useCallback(async (spaceId: string, conversationId: string, title: string) => {
    await renameConversation(spaceId, conversationId, title)
  }, [renameConversation])

  const handleDeleteConversation = useCallback(async (spaceId: string, conversationId: string) => {
    await deleteConversation(spaceId, conversationId)
  }, [deleteConversation])

  const handleOpenAbilities = useCallback(() => {
    setRightPanelMode((prev) => (prev === 'abilities' ? 'artifacts' : 'abilities'))
  }, [])

  const isWorkbenchSpace = Boolean(currentSpace?.isTemp)
  const visibleCanvasTabs = useMemo(() => {
    if (!currentSpaceId) return []
    return canvasTabs.filter((tab) => !tab.spaceId || tab.spaceId === currentSpaceId)
  }, [canvasTabs, currentSpaceId])
  const hasCanvasTabs = visibleCanvasTabs.length > 0
  const shouldRenderCanvasInMain = hasCanvasTabs && isCanvasOpen && (activeTab ? activeTab.type !== 'chat' : true)
  const artifactSpaceId = currentSpaceId || currentSpace?.id || kiteSpace?.id || spaces[0]?.id || null

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  const handleToggleArtifactRail = useCallback(() => {
    if (!artifactSpaceId) return
    if (rightPanelMode === 'abilities') {
      setRightPanelMode('artifacts')
      setArtifactRailExpanded(true)
      return
    }
    setRightPanelMode('artifacts')
    setArtifactRailExpanded((prev) => !prev)
  }, [artifactSpaceId, rightPanelMode, setRightPanelMode])

  return (
    <div className="unified-classic-theme space-studio-root h-full min-h-0 w-full flex flex-col">
      {mockBashMode && (
        <GitBashWarningBanner
          installProgress={gitBashInstallProgress}
          onInstall={startGitBashInstall}
        />
      )}

      <div className="space-studio-main flex-1 min-h-0 flex overflow-hidden">
        <div className="space-studio-shell flex-1 min-h-0 flex overflow-hidden">
        <UnifiedSidebar
          spaces={allSpaces}
          currentSpaceId={currentSpaceId}
          currentConversationId={currentConversationId}
          conversationsBySpaceId={conversationsBySpaceId}
          onSelectSpace={handleSelectSpace}
          onExpandSpace={handleExpandSpace}
          onSelectConversation={handleSelectConversation}
          onCreateSpace={handleCreateSpace}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
          onOpenAbilities={handleOpenAbilities}
          abilitiesOpen={rightPanelMode === 'abilities'}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onGoSettings={() => setView('settings')}
          showCollapseControl={true}
        />

        {rightPanelMode === 'abilities' ? (
          <div className="space-studio-pane space-studio-chat-pane flex-1 min-w-0 min-h-0 overflow-hidden bg-background relative">
            <div className="no-drag absolute top-1 right-2 z-30">
              <button
                type="button"
                onClick={handleToggleArtifactRail}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  artifactRailExpanded
                    ? 'bg-secondary/80 text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                }`}
                title={artifactRailExpanded ? t('隐藏文件面板') : t('显示文件面板')}
                aria-label={artifactRailExpanded ? t('隐藏文件面板') : t('显示文件面板')}
                aria-pressed={artifactRailExpanded}
                disabled={!artifactSpaceId}
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
            <ExtensionsView />
          </div>
        ) : (
          <div className="space-studio-pane space-studio-chat-pane flex-1 min-w-0 min-h-0 flex overflow-hidden bg-background relative">
            <div className="no-drag absolute top-1 right-2 z-30">
              <button
                type="button"
                onClick={handleToggleArtifactRail}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  artifactRailExpanded
                    ? 'bg-secondary/80 text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                }`}
                title={artifactRailExpanded ? t('隐藏文件面板') : t('显示文件面板')}
                aria-label={artifactRailExpanded ? t('隐藏文件面板') : t('显示文件面板')}
                aria-pressed={artifactRailExpanded}
                disabled={!artifactSpaceId}
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>

            <div
              className={`min-w-0 min-h-0 flex flex-col overflow-hidden ${
                'flex-1'
              }`}
            >
              <div className="drag-region flex-shrink-0 h-10 border-b border-border/60 bg-background/95">
                <div className="h-full px-2 pr-12 flex items-start gap-2">
                  <div className="no-drag min-w-0 flex-1 h-full flex items-start">
                    {hasCanvasTabs ? <div className="min-w-0 flex-1"><CanvasTabBar /></div> : null}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-w-0 min-h-0 bg-background overflow-hidden">
                {shouldRenderCanvasInMain ? (
                  <CollapsibleCanvas />
                ) : (
                  <ChatView isCompact={false} />
                )}
              </div>
            </div>

            {artifactSpaceId && (
              <aside
                aria-label={t('Files and artifacts')}
                className={`h-full overflow-hidden transition-[width] duration-300 ease-out ${
                  artifactRailExpanded ? 'w-[320px]' : 'w-0'
                }`}
              >
                <ArtifactRail
                  spaceId={artifactSpaceId}
                  isTemp={isWorkbenchSpace}
                  externalExpanded={artifactRailExpanded}
                  onExpandedChange={setArtifactRailExpanded}
                  collapseMode="hidden"
                  showHeaderToggle={false}
                />
              </aside>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
