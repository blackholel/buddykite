import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { shallow } from 'zustand/shallow'
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
import { getWindowChromeInsets } from '../utils/window-chrome'
import { useTranslation } from '../i18n'
import type { ConversationMeta, CreateSpaceInput } from '../types'
import type { ResourceType } from '../components/resources/types'

function pickPreferredSpace<T extends { id: string }>(
  currentSpace: T | null,
  kiteSpace: T | null,
  spaces: T[]
): T | null {
  return currentSpace || kiteSpace || spaces[0] || null
}

function pickNextSpaceAfterDelete<T extends { id: string; updatedAt: string }>(
  deletingSpaceId: string,
  spaces: T[],
  kiteSpace: T | null
): T | null {
  const sorted = [...spaces]
    .filter((space) => space.id !== deletingSpaceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  if (sorted.length > 0) {
    return sorted[0]
  }
  return kiteSpace && kiteSpace.id !== deletingSpaceId ? kiteSpace : null
}

const SIDEBAR_WIDTH_STORAGE_KEY = 'hello-halo:unified-sidebar-width'
const SIDEBAR_WIDTH_DEFAULT = 240
const SIDEBAR_WIDTH_MIN = 220
const SIDEBAR_WIDTH_MAX = 400

function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, width))
}

type ActiveConversationSyncTab = {
  type: string
  spaceId?: string
  conversationId?: string
} | null | undefined

export function resolveConversationSyncTarget(
  activeTab: ActiveConversationSyncTab,
  currentSpaceId: string | null,
  currentConversationId: string | null
): string | null {
  if (!currentSpaceId) return null
  if (!activeTab || activeTab.type !== 'chat') return null
  if (!activeTab.spaceId || activeTab.spaceId !== currentSpaceId) return null
  if (!activeTab.conversationId || activeTab.conversationId === currentConversationId) return null
  return activeTab.conversationId
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
    createSpace,
    updateSpace,
    deleteSpace
  } = useSpaceStore((state) => ({
    currentSpace: state.currentSpace,
    kiteSpace: state.kiteSpace,
    spaces: state.spaces,
    loadSpaces: state.loadSpaces,
    setCurrentSpace: state.setCurrentSpace,
    createSpace: state.createSpace,
    updateSpace: state.updateSpace,
    deleteSpace: state.deleteSpace
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
    switchSpaceSession,
    closeSpaceSession,
    closeConversationTabs
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
  const tabConversationSyncInFlightRef = useRef<string | null>(null)
  const [artifactRailExpanded, setArtifactRailExpanded] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<'artifacts' | 'skills' | 'agents'>('artifacts')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT)
  const sidebarIsResizingRef = useRef(false)
  const sidebarResizeLastXRef = useRef(0)
  const chromeInsets = getWindowChromeInsets()
  const topBarContentStyle: CSSProperties = {
    paddingLeft: '8px',
    paddingRight: `${8 + chromeInsets.right}px`
  }

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

  useEffect(() => {
    const rawWidth = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!rawWidth) return
    const parsed = Number.parseInt(rawWidth, 10)
    if (!Number.isFinite(parsed)) return
    setSidebarWidth(clampSidebarWidth(parsed))
  }, [])

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
    const targetConversationId = resolveConversationSyncTarget(activeTab, currentSpaceId, currentConversationId)
    if (!targetConversationId) return
    if (tabConversationSyncInFlightRef.current === targetConversationId) return
    tabConversationSyncInFlightRef.current = targetConversationId

    void selectConversation(targetConversationId).finally(() => {
      if (tabConversationSyncInFlightRef.current === targetConversationId) {
        tabConversationSyncInFlightRef.current = null
      }
    })
  }, [activeTab, currentConversationId, currentSpaceId, selectConversation])

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

  const handleCreateConversation = useCallback(async (spaceId: string) => {
    setRightPanelMode('artifacts')
    const targetSpace = spaceById.get(spaceId)
    const workDir = targetSpace?.path

    const navigationResult = await navigateToSpaceContext({
      targetSpaceId: spaceId,
      currentSpaceId,
      spaces,
      kiteSpace,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })
    if (!navigationResult.success) return null

    const createdConversation = await createConversation(spaceId)
    if (!createdConversation) return null

    await selectConversation(createdConversation.id)
    await openChat(
      spaceId,
      createdConversation.id,
      createdConversation.title?.trim() || t('New conversation'),
      workDir,
      resolveSpaceTabLabel(spaceId),
      false
    )
    return createdConversation
  }, [
    createConversation,
    currentSpaceId,
    kiteSpace,
    loadConversations,
    openChat,
    resolveSpaceTabLabel,
    selectConversation,
    setChatCurrentSpace,
    setSpaceStoreCurrentSpace,
    spaceById,
    spaces,
    t
  ])

  const handleRenameSpace = useCallback(async (spaceId: string, name: string) => {
    await updateSpace(spaceId, { name: name.trim() })
  }, [updateSpace])

  const handleDeleteSpace = useCallback(async (spaceId: string) => {
    const isDeletingCurrentSpace = currentSpaceId === spaceId
    const nextSpace = pickNextSpaceAfterDelete(spaceId, spaces, kiteSpace)

    const deleted = await deleteSpace(spaceId)
    if (!deleted) return false

    closeSpaceSession(spaceId)

    if (!isDeletingCurrentSpace || !nextSpace) {
      return true
    }

    const navigationResult = await navigateToSpaceContext({
      targetSpaceId: nextSpace.id,
      currentSpaceId: spaceId,
      spaces: spaces.filter((space) => space.id !== spaceId),
      kiteSpace: nextSpace.id === kiteSpace?.id ? kiteSpace : null,
      setSpaceStoreCurrentSpace,
      setChatCurrentSpace,
      loadConversations
    })

    if (navigationResult.success) {
      setRightPanelMode('artifacts')
    }

    return true
  }, [
    closeSpaceSession,
    currentSpaceId,
    deleteSpace,
    kiteSpace,
    loadConversations,
    setChatCurrentSpace,
    setSpaceStoreCurrentSpace,
    spaces
  ])

  const handleRenameConversation = useCallback(async (spaceId: string, conversationId: string, title: string) => {
    await renameConversation(spaceId, conversationId, title)
  }, [renameConversation])

  const handleDeleteConversation = useCallback(async (spaceId: string, conversationId: string) => {
    const closeResult = closeConversationTabs(spaceId, conversationId)
    const deleted = await deleteConversation(spaceId, conversationId)
    if (!deleted.accepted) return
    if (spaceId !== currentSpaceId || !deleted.wasCurrent) {
      return
    }

    startTransition(() => {
      setRightPanelMode('artifacts')
    })

    const targetConversationId = closeResult.nextActiveChatConversationId || deleted.nextConversationId
    if (!targetConversationId) {
      return
    }
    const targetSpace = spaceById.get(spaceId)
    const workDir = targetSpace?.path
    const latestSpaceState = useChatStore.getState().getSpaceState(spaceId)
    const targetMeta = latestSpaceState.conversations.find((conversation) => conversation.id === targetConversationId)
    const conversationTitle = targetMeta?.title?.trim() || t('New conversation')

    await selectConversation(targetConversationId)
    await openChat(spaceId, targetConversationId, conversationTitle, workDir, resolveSpaceTabLabel(spaceId), false)
  }, [
    closeConversationTabs,
    currentSpaceId,
    deleteConversation,
    openChat,
    resolveSpaceTabLabel,
    selectConversation,
    spaceById,
    t
  ])

  const handleOpenResourceLibrary = useCallback((type: ResourceType) => {
    const targetMode = type === 'skill' ? 'skills' : 'agents'
    setRightPanelMode((prev) => (prev === targetMode ? 'artifacts' : targetMode))
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

  const handleSidebarResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    sidebarIsResizingRef.current = true
    sidebarResizeLastXRef.current = event.clientX
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleSidebarResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebarIsResizingRef.current) return
    const delta = event.clientX - sidebarResizeLastXRef.current
    sidebarResizeLastXRef.current = event.clientX
    setSidebarWidth((current) => clampSidebarWidth(current + delta))
  }, [])

  const handleSidebarResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebarIsResizingRef.current) return
    sidebarIsResizingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setSidebarWidth((current) => {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(current))
      return current
    })
  }, [])

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
          onCreateConversation={handleCreateConversation}
          onRenameSpace={handleRenameSpace}
          onDeleteSpace={handleDeleteSpace}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
          onOpenSkills={() => handleOpenResourceLibrary('skill')}
          onOpenAgents={() => handleOpenResourceLibrary('agent')}
          skillsOpen={rightPanelMode === 'skills'}
          agentsOpen={rightPanelMode === 'agents'}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          onGoSettings={() => setView('settings')}
          showCollapseControl={true}
          expandedWidth={sidebarWidth}
        />

        {!sidebarCollapsed && (
          <div
            data-testid="unified-sidebar-resize-handle"
            onPointerDown={handleSidebarResizePointerDown}
            onPointerMove={handleSidebarResizePointerMove}
            onPointerUp={handleSidebarResizePointerUp}
            className="group relative z-10 -ml-0.5 flex w-1 shrink-0 cursor-col-resize items-center justify-center touch-none"
            title={t('Drag to resize width')}
            aria-label={t('Drag to resize width')}
            role="separator"
            aria-orientation="vertical"
          >
            <div className="h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-border" />
          </div>
        )}

        {rightPanelMode === 'skills' || rightPanelMode === 'agents' ? (
          <div className="space-studio-pane space-studio-chat-pane flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-background relative">
            <div className="drag-region flex-shrink-0 h-10 bg-background/95">
              <div className="h-full" style={topBarContentStyle} />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ExtensionsView
                resourceType={rightPanelMode === 'skills' ? 'skill' : 'agent'}
                onSkillConversationOpened={() => setRightPanelMode('artifacts')}
              />
            </div>
          </div>
        ) : (
          <div className="space-studio-pane space-studio-chat-pane flex-1 min-w-0 min-h-0 flex overflow-hidden bg-background relative">
            <div
              className={`min-w-0 min-h-0 flex flex-col overflow-hidden ${
                'flex-1'
              }`}
            >
              <div className="drag-region flex-shrink-0 h-10 bg-background/95">
                <div className="h-full flex items-start gap-2" style={topBarContentStyle}>
                  {hasCanvasTabs ? (
                    <div className="no-drag min-w-0 flex-1 h-full flex items-start">
                      <div className="min-w-0 flex-1"><CanvasTabBar /></div>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 h-full" />
                  )}
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
                  artifactRailExpanded ? 'w-[320px]' : 'w-[56px]'
                }`}
              >
                <ArtifactRail
                  spaceId={artifactSpaceId}
                  isTemp={isWorkbenchSpace}
                  externalExpanded={artifactRailExpanded}
                  onExpandedChange={setArtifactRailExpanded}
                  collapseMode="rail"
                  showHeaderToggle={true}
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
