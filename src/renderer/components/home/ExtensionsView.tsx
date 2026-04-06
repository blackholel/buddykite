import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, FolderOpen, Plus, Puzzle, Search, Zap } from 'lucide-react'
import type { ResourceType } from '../resources/types'
import { api } from '../../api'
import { getCurrentLanguage, useTranslation } from '../../i18n'
import { type AgentDefinition, useAgentsStore } from '../../stores/agents.store'
import { useChatStore } from '../../stores/chat.store'
import { type SkillDefinition, useSkillsStore } from '../../stores/skills.store'
import { useSpaceStore } from '../../stores/space.store'
import { ResourceCard } from '../resources/ResourceCard'
import { ResourceCreateModal } from '../resources/ResourceCreateModal'
import { normalizeExtensionItems } from '../resources/extension-filtering'

interface EmptyStateProps {
  icon: typeof Puzzle
  title: string
  description: string
}

interface ExtensionsViewProps {
  resourceType: ResourceType
  onSkillConversationOpened?: () => void
}

function EmptyState({ icon: Icon, title, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-secondary/60 flex items-center justify-center">
        <Icon className="w-6 h-6 text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/60 mt-1">{description}</p>
    </div>
  )
}

type SessionReadyState = 'ready' | 'stale' | 'unknown' | 'na'

function isEnabled(resource: SkillDefinition | AgentDefinition): boolean {
  return resource.enabled !== false
}

export function ExtensionsView({ resourceType, onSkillConversationOpened }: ExtensionsViewProps): JSX.Element {
  const { t } = useTranslation()
  const locale = getCurrentLanguage()
  const [query, setQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasRequestedWorkDirRef = useRef(false)
  const lastRequestedWorkDirRef = useRef<string | null>(null)
  const lastRequestedLocaleRef = useRef(locale)
  const currentSpace = useSpaceStore((state) => state.currentSpace)
  const spaces = useSpaceStore((state) => state.spaces)
  const kiteSpace = useSpaceStore((state) => state.kiteSpace)
  const chatCurrentSpaceId = useChatStore((state) => state.currentSpaceId)
  const resolvedSpace = useMemo(() => {
    const fallbackSpace = currentSpace || kiteSpace || spaces[0] || null
    if (!chatCurrentSpaceId) return fallbackSpace
    if (currentSpace?.id === chatCurrentSpaceId) return currentSpace
    if (kiteSpace?.id === chatCurrentSpaceId) return kiteSpace
    return spaces.find((space) => space.id === chatCurrentSpaceId) || fallbackSpace
  }, [chatCurrentSpaceId, currentSpace, kiteSpace, spaces])
  const currentSpaceId = resolvedSpace?.id
  const currentConversationId = useChatStore((state) => {
    if (!state.currentSpaceId) return null
    return state.spaceStates.get(state.currentSpaceId)?.currentConversationId ?? null
  })
  const openSkillCreatorConversation = useChatStore((state) => state.openSkillCreatorConversation)
  const [resourceIndexHash, setResourceIndexHash] = useState<string | null>(null)
  const [sessionResourceHash, setSessionResourceHash] = useState<string | null>(null)
  const [resourceHashError, setResourceHashError] = useState<string | null>(null)
  const [isCheckingResourceHash, setIsCheckingResourceHash] = useState(false)
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [autoOpenResourcePath, setAutoOpenResourcePath] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const {
    skills,
    isLoading: skillsLoading,
    loadSkills,
    openSkillsLibraryFolder,
    loadedWorkDir,
    lastRefreshReason,
    lastRefreshTs
  } = useSkillsStore()

  const {
    agents,
    isLoading: agentsLoading,
    loadAgents,
    openAgentsLibraryFolder
  } = useAgentsStore()
  const preferredWorkDir = resolvedSpace?.path

  useEffect(() => {
    const requestKey = preferredWorkDir ?? null
    if (hasRequestedWorkDirRef.current && lastRequestedWorkDirRef.current === requestKey) return
    hasRequestedWorkDirRef.current = true
    lastRequestedWorkDirRef.current = requestKey
    void Promise.all([
      loadSkills(preferredWorkDir),
      loadAgents(preferredWorkDir)
    ])
  }, [loadAgents, loadSkills, preferredWorkDir])

  useEffect(() => {
    if (lastRequestedLocaleRef.current === locale) {
      return
    }
    lastRequestedLocaleRef.current = locale
    void Promise.all([
      loadSkills(preferredWorkDir),
      loadAgents(preferredWorkDir)
    ])
  }, [locale, loadAgents, loadSkills, preferredWorkDir])

  const normalizedItems = useMemo(() => normalizeExtensionItems({
    skills: skills as SkillDefinition[],
    agents: agents as AgentDefinition[]
  }), [agents, skills])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const hasScopedSpaceSkills = resourceType === 'skill' && normalizedItems.some((item) => (
      item.type === 'skill' && item.resource.source === 'space'
    ))

    return normalizedItems
      .filter((item) => item.type === resourceType)
      .filter((item) => {
        if (!hasScopedSpaceSkills) return true
        return item.resource.source === 'space'
      })
      .filter((item) => !normalizedQuery || item.searchable.includes(normalizedQuery))
      .sort((a, b) => {
        const enabledDiff = Number(isEnabled(b.resource)) - Number(isEnabled(a.resource))
        if (enabledDiff !== 0) return enabledDiff
        return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })
      })
  }, [normalizedItems, query, resourceType])

  const isLoading = skillsLoading || agentsLoading

  const refreshResourceHash = useCallback(async (): Promise<void> => {
    try {
      setIsCheckingResourceHash(true)
      setResourceHashError(null)
      const response = await api.getAgentResourceHash({
        spaceId: currentSpaceId || undefined,
        workDir: currentSpaceId ? undefined : (loadedWorkDir ?? undefined),
        conversationId: currentConversationId ?? undefined
      })

      if (!response.success || !response.data) {
        setResourceHashError(response.error || t('Failed to get resource hash'))
        setResourceIndexHash(null)
        setSessionResourceHash(null)
        return
      }

      const data = response.data as { hash?: unknown; sessionResourceHash?: unknown }
      setResourceIndexHash(typeof data.hash === 'string' ? data.hash : null)
      setSessionResourceHash(typeof data.sessionResourceHash === 'string' ? data.sessionResourceHash : null)
    } catch (error) {
      console.error('[ExtensionsView] Failed to get resource hash:', error)
      setResourceHashError(t('Failed to get resource hash'))
      setResourceIndexHash(null)
      setSessionResourceHash(null)
    } finally {
      setIsCheckingResourceHash(false)
    }
  }, [currentConversationId, currentSpaceId, loadedWorkDir, t])

  useEffect(() => {
    void refreshResourceHash()
  }, [refreshResourceHash, lastRefreshTs])

  const sessionReadyState = useMemo<SessionReadyState>(() => {
    if (!currentConversationId) return 'na'
    if (resourceHashError || !resourceIndexHash) return 'unknown'
    if (!sessionResourceHash) return 'unknown'
    return sessionResourceHash === resourceIndexHash ? 'ready' : 'stale'
  }, [currentConversationId, resourceHashError, resourceIndexHash, sessionResourceHash])

  const sessionReadyText = useMemo(() => {
    if (sessionReadyState === 'ready') return t('Ready')
    if (sessionReadyState === 'stale') return t('Outdated')
    if (sessionReadyState === 'na') return t('N/A')
    return t('Unknown')
  }, [sessionReadyState, t])

  const indexedBadgeClass = useMemo(() => {
    if (resourceIndexHash) {
      return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300'
    }
    return 'border-border/60 bg-foreground/5 text-muted-foreground'
  }, [resourceIndexHash])

  const indexedDisplayText = useMemo(() => {
    if (isCheckingResourceHash) return t('Checking...')
    if (!resourceIndexHash) return t('Unknown')
    return resourceIndexHash.slice(0, 8)
  }, [isCheckingResourceHash, resourceIndexHash, t])

  const sessionBadgeClass = useMemo(() => {
    if (sessionReadyState === 'ready') {
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    }
    if (sessionReadyState === 'stale') {
      return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    }
    return 'border-border/60 bg-foreground/5 text-muted-foreground'
  }, [sessionReadyState])

  const handleRefreshResources = useCallback(async (): Promise<void> => {
    if (isRefreshing) return
    try {
      setIsRefreshing(true)
      const refreshResult = await api.refreshSkillsIndex(undefined)
      if (!refreshResult.success) {
        setResourceHashError(refreshResult.error || t('Failed to refresh resources'))
        return
      }
      await Promise.all([
        loadSkills(preferredWorkDir),
        loadAgents(preferredWorkDir)
      ])
      useSkillsStore.setState({
        lastRefreshReason: 'manual-refresh',
        lastRefreshTs: new Date().toISOString()
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, loadAgents, loadSkills, preferredWorkDir, t])

  const handleAfterLibraryAction = useCallback(async () => {
    await Promise.all([loadSkills(preferredWorkDir), loadAgents(preferredWorkDir)])
    await refreshResourceHash()
  }, [loadAgents, loadSkills, preferredWorkDir, refreshResourceHash])

  const handleCreateClick = useCallback(async (): Promise<void> => {
    if (resourceType !== 'skill') {
      setIsCreateModalOpen(true)
      return
    }

    if (!currentSpaceId || !preferredWorkDir) {
      setLibraryActionError(t('Failed to create resource'))
      return
    }

    setLibraryActionError(null)
    const ok = await openSkillCreatorConversation(
      currentSpaceId,
      preferredWorkDir,
      resolvedSpace?.name
    )
    if (!ok) {
      setLibraryActionError(t('Failed to create resource'))
      setIsCreateModalOpen(true)
      return
    }

    onSkillConversationOpened?.()
  }, [currentSpaceId, onSkillConversationOpened, openSkillCreatorConversation, preferredWorkDir, resolvedSpace?.name, resourceType, t])

  const handleOpenLibraryFolder = useCallback(async (): Promise<void> => {
    setLibraryActionError(null)
    const ok = resourceType === 'skill'
      ? await openSkillsLibraryFolder()
      : await openAgentsLibraryFolder()
    if (!ok) {
      setLibraryActionError(t('Failed to open folder'))
    }
  }, [openAgentsLibraryFolder, openSkillsLibraryFolder, resourceType, t])

  const importPathToLibrary = useCallback(async (sourcePath: string): Promise<string | null> => {
    const primaryResponse = resourceType === 'skill'
      ? await api.importSkillToLibrary(sourcePath, undefined, locale)
      : await api.importAgentToLibrary(sourcePath, undefined, locale)

    if (!primaryResponse.success) {
      setLibraryActionError(primaryResponse.error || t('Import failed'))
      return null
    }

    const data = primaryResponse.data as { status?: string; existingPath?: string; path?: string } | undefined
    if (data?.status === 'conflict') {
      const shouldOverwrite = window.confirm(t('Resource already exists. Replace it?'))
      if (!shouldOverwrite) return null
      const overwriteResponse = resourceType === 'skill'
        ? await api.importSkillToLibrary(sourcePath, { overwrite: true }, locale)
        : await api.importAgentToLibrary(sourcePath, { overwrite: true }, locale)
      if (!overwriteResponse.success) {
        setLibraryActionError(overwriteResponse.error || t('Import failed'))
        return null
      }
      const overwriteData = overwriteResponse.data as { status?: string; path?: string } | undefined
      if (overwriteData?.status !== 'imported') {
        setLibraryActionError(t('Import failed'))
        return null
      }
      return overwriteData.path || null
    }

    if (data?.status !== 'imported') {
      setLibraryActionError(t('Import failed'))
      return null
    }

    return data.path || null
  }, [locale, resourceType, t])

  const extractDroppedPaths = useCallback((event: React.DragEvent<HTMLDivElement>): string[] => {
    const paths = new Set<string>()
    const files = Array.from(event.dataTransfer.files || [])
    for (const file of files) {
      const candidate = (file as File & { path?: string }).path
      if (candidate) paths.add(candidate)
    }

    const items = Array.from(event.dataTransfer.items || [])
    for (const item of items) {
      const candidateFile = item.getAsFile() as (File & { path?: string }) | null
      if (candidateFile?.path) {
        paths.add(candidateFile.path)
      }
    }

    const plainText = event.dataTransfer.getData('text/plain')
    if (plainText) {
      plainText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((pathValue) => paths.add(pathValue))
    }

    return Array.from(paths)
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!isDragActive) setIsDragActive(true)
  }, [isDragActive])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return
    }
    setIsDragActive(false)
  }, [])

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)
    setLibraryActionError(null)

    const paths = extractDroppedPaths(event)
    if (paths.length === 0 || isImporting) return

    setIsImporting(true)
    try {
      let imported = false
      let importedPath: string | null = null
      for (const pathValue of paths) {
        const path = await importPathToLibrary(pathValue)
        if (path) {
          imported = true
          importedPath = importedPath || path
        }
      }
      if (imported) {
        if (importedPath) {
          setAutoOpenResourcePath(importedPath)
        }
        await handleAfterLibraryAction()
      }
    } finally {
      setIsImporting(false)
    }
  }, [extractDroppedPaths, handleAfterLibraryAction, importPathToLibrary, isImporting])

  const title = resourceType === 'skill' ? t('技能资源库') : t('智能体资源库')
  const subtitle = resourceType === 'skill'
    ? t('浏览并管理所有技能资源')
    : t('浏览并管理所有智能体资源')
  const emptyTitle = query
    ? (resourceType === 'skill' ? t('没有匹配的技能') : t('没有匹配的智能体'))
    : (resourceType === 'skill' ? t('暂无技能') : t('暂无智能体'))
  const emptyDescription = query
    ? t('Try another search keyword')
    : t('Resources will appear here after loading')
  const searchPlaceholder = resourceType === 'skill' ? t('搜索技能...') : t('搜索智能体...')
  const SectionIcon = resourceType === 'skill' ? Zap : Bot
  const sectionIconClass = resourceType === 'skill' ? 'text-yellow-500' : 'text-cyan-500'

  return (
    <div
      data-testid="resource-library-dropzone"
      className={`h-full overflow-auto transition-colors ${isDragActive ? 'bg-primary/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6 stagger-item" style={{ animationDelay: '0ms' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCreateClick()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('Create')}
              </button>
              <button
                type="button"
                onClick={() => void handleOpenLibraryFolder()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-secondary/70 hover:bg-secondary transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {t('Open folder')}
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshResources()}
                disabled={isRefreshing || isImporting}
                className="px-3 py-1.5 text-xs rounded-lg bg-secondary/70 hover:bg-secondary transition-colors disabled:opacity-50"
              >
                {isRefreshing ? t('Refreshing...') : t('Refresh')}
              </button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {t('Installed')}: {filteredItems.length}
            </span>
            <span className={`text-[11px] px-2 py-0.5 rounded-md border ${indexedBadgeClass}`}>
              {t('Indexed')}: {indexedDisplayText}
            </span>
            <span className={`text-[11px] px-2 py-0.5 rounded-md border ${sessionBadgeClass}`}>
              {t('Session Ready')}: {sessionReadyText}
            </span>
          </div>
          {sessionReadyState === 'stale' && (
            <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 mt-1">
              {t('Current session is using an older resource snapshot; next message will rebuild the session.')}
            </p>
          )}
          {lastRefreshTs && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t('Last refresh')}: {new Date(lastRefreshTs).toLocaleString()} ({lastRefreshReason || t('unknown')})
            </p>
          )}
          {resourceHashError && (
            <p className="text-xs text-destructive/80 mt-1">{resourceHashError}</p>
          )}
          {libraryActionError && (
            <p className="text-xs text-destructive/80 mt-1">{libraryActionError}</p>
          )}
          {isDragActive && (
            <p className="text-xs text-primary mt-1">
              {resourceType === 'skill'
                ? t('Drop skill folders here to import')
                : t('Drop markdown files here to import')}
            </p>
          )}
        </div>

        <div className="glass-card p-3 mb-6 stagger-item" style={{ animationDelay: '40ms' }}>
          <div className="relative mb-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 input-apple text-sm"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 stagger-item" style={{ animationDelay: '80ms' }}>
            <div className="w-8 h-8 mx-auto mb-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">{t('Loading extensions...')}</p>
          </div>
        ) : (
          <>
            {filteredItems.length === 0 ? (
              <div className="stagger-item" style={{ animationDelay: '120ms' }}>
                <EmptyState
                  icon={Puzzle}
                  title={emptyTitle}
                  description={emptyDescription}
                />
              </div>
            ) : (
              <div className="space-y-3 stagger-item" style={{ animationDelay: '120ms' }}>
                <div className="flex items-center gap-2">
                  <SectionIcon className={`w-4 h-4 ${sectionIconClass}`} />
                  <h3 className="text-sm font-medium">
                    {resourceType === 'skill' ? t('Skills') : t('Agents')} ({filteredItems.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredItems.map((item, index) => (
                    <ResourceCard
                      key={item.id}
                      resource={item.resource}
                      type={item.type}
                      index={index}
                      actionMode="none"
                      detailMode="library"
                      workDir={currentSpace?.path}
                      autoOpen={autoOpenResourcePath === item.resource.path}
                      onAutoOpened={() => setAutoOpenResourcePath(null)}
                      onAfterAction={() => void handleAfterLibraryAction()}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {isCreateModalOpen && (
        <ResourceCreateModal
          resourceType={resourceType}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={(resource) => {
            setAutoOpenResourcePath(resource.path)
            void handleAfterLibraryAction()
          }}
        />
      )}
    </div>
  )
}
