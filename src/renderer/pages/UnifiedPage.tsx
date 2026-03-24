import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import { ChatView } from '../components/chat/ChatView'
import { UnifiedSidebar } from '../components/unified/UnifiedSidebar'
import { GitBashWarningBanner } from '../components/setup/GitBashWarningBanner'
import { ArtifactRail } from '../components/artifact/ArtifactRail'
import { CanvasToggleButton, CanvasTabBar, CollapsibleCanvas } from '../components/canvas'
import { useSearchShortcuts } from '../hooks/useSearchShortcuts'
import { useCanvasLifecycle } from '../hooks/useCanvasLifecycle'
import { useAppStore } from '../stores/app.store'
import { useChatStore } from '../stores/chat.store'
import { useSearchStore, type SearchScope } from '../stores/search.store'
import { useSpaceStore } from '../stores/space.store'
import { navigateToConversationContext, navigateToSpaceContext } from '../utils/space-conversation-navigation'
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
    createConversation,
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
    createConversation: state.createConversation,
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
  const loadingSpaceIdsRef = useRef<Set<string>>(new Set())
  const conversationSelectTicketRef = useRef(0)
  const [artifactRailExpanded, setArtifactRailExpanded] = useState(false)

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

  const handleSelectSpace = useCallback(async (spaceId: string) => {
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

  const resolveSpaceTabLabel = useCallback((spaceId: string) => {
    const space = spaceById.get(spaceId)
    if (!space) return t('Unknown space')
    return space.isTemp ? 'Kite' : space.name
  }, [spaceById, t])

  const handleSelectConversation = useCallback(async (spaceId: string, conversationId: string) => {
    const ticket = ++conversationSelectTicketRef.current
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

  const handleCreateConversation = useCallback(async (spaceId: string) => {
    const spaceReady = await navigateToSpaceContext({
      targetSpaceId: spaceId,
      currentSpaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
    if (!spaceReady.success) return

    const created = await createConversation(spaceId)
    if (!created) return

    const conversationReady = await navigateToConversationContext({
      targetSpaceId: spaceId,
      targetConversationId: created.id,
      currentSpaceId: spaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations,
      selectConversation
    })
    if (!conversationReady.success) return

    const targetSpace = spaceById.get(spaceId)
    const workDir = targetSpace?.path
    setCanvasOpen(false)
    await openChat(spaceId, created.id, created.title, workDir, resolveSpaceTabLabel(spaceId), false)
  }, [
    currentSpaceId,
    createConversation,
    kiteSpace,
    loadConversations,
    openChat,
    resolveSpaceTabLabel,
    setCanvasOpen,
    selectConversation,
    setChatCurrentSpace,
    setSpaceStoreCurrentSpace,
    spaceById,
    spaces
  ])

  const handleRenameConversation = useCallback(async (spaceId: string, conversationId: string, title: string) => {
    await renameConversation(spaceId, conversationId, title)
  }, [renameConversation])

  const handleDeleteConversation = useCallback(async (spaceId: string, conversationId: string) => {
    await deleteConversation(spaceId, conversationId)
  }, [deleteConversation])

  const isWorkbenchSpace = Boolean(currentSpace?.isTemp)
  const visibleCanvasTabs = useMemo(() => {
    if (!currentSpaceId) return []
    return canvasTabs.filter((tab) => !tab.spaceId || tab.spaceId === currentSpaceId)
  }, [canvasTabs, currentSpaceId])
  const hasCanvasTabs = visibleCanvasTabs.length > 0
  const shouldRenderCanvasPanel = hasCanvasTabs && isCanvasOpen && (activeTab ? activeTab.type !== 'chat' : true)
  const shouldSplitWithCanvas = shouldRenderCanvasPanel
  const activeTabTitle = useMemo(() => {
    const title = currentConversationMeta?.title?.trim()
    if (title) return title
    return t('当前聊天')
  }, [currentConversationMeta?.title, t])

  return (
    <div className="h-full min-h-0 w-full flex flex-col">
      {mockBashMode && (
        <GitBashWarningBanner
          installProgress={gitBashInstallProgress}
          onInstall={startGitBashInstall}
        />
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <UnifiedSidebar
          spaces={allSpaces}
          currentSpaceId={currentSpaceId}
          currentConversationId={currentConversationId}
          conversationsBySpaceId={conversationsBySpaceId}
          onSelectSpace={handleSelectSpace}
          onExpandSpace={handleExpandSpace}
          onSelectConversation={handleSelectConversation}
          onCreateSpace={handleCreateSpace}
          onCreateConversation={handleCreateConversation}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
          onGoHome={() => setView('unified')}
          onGoSettings={() => setView('settings')}
        />

        <div className="flex-1 min-w-0 min-h-0 flex overflow-hidden bg-background">
          <div
            className={`min-w-0 min-h-0 flex flex-col overflow-hidden ${
              shouldSplitWithCanvas
                ? 'w-[44%] min-w-[360px] max-w-[860px] shrink-0 border-r border-border/50'
                : 'flex-1'
            }`}
          >
            {!isWorkbenchSpace && !hasCanvasTabs && (
              <div className="border-b border-border/60 bg-card/50 px-3 py-2">
                <div role="tablist" aria-label={t('Opened content')} className="flex items-center gap-2">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={true}
                    className="inline-flex max-w-[320px] items-center rounded-lg border border-border/70 bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm"
                    title={activeTabTitle}
                  >
                    <span className="truncate">{activeTabTitle}</span>
                  </button>
                </div>
              </div>
            )}
            {hasCanvasTabs && (
              <div className="border-b border-border/60 bg-card/50 px-2 py-1 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CanvasTabBar />
                </div>
                <CanvasToggleButton />
              </div>
            )}
            <div className="flex-1 min-w-0 min-h-0 bg-background overflow-hidden">
              <ChatView isCompact={shouldSplitWithCanvas} />
            </div>
          </div>

          {shouldRenderCanvasPanel && <CollapsibleCanvas />}

          {currentSpaceId && (
            <aside aria-label={t('Files and artifacts')} className="h-full">
              <ArtifactRail
                spaceId={currentSpaceId}
                isTemp={isWorkbenchSpace}
                externalExpanded={artifactRailExpanded}
                onExpandedChange={setArtifactRailExpanded}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
