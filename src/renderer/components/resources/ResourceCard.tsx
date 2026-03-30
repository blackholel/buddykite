import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, X } from 'lucide-react'
import { api } from '../../api'
import { useTranslation } from '../../i18n'
import { copyResourceWithConflict, resolveActionButtonState, type CopyResourceResponse } from './resource-actions'
import { shouldLoadResourceContent } from './resource-content-loading'
import { fetchResourceContent, getSourceColor, getSourceLabel, mapResourceMeta } from './resource-meta'
import type { AnyResource, ResourceActionMode, ResourceType } from './types'

export interface ResourceCardProps {
  resource: AnyResource
  type: ResourceType
  index: number
  actionMode: ResourceActionMode
  detailMode?: 'default' | 'library'
  workDir?: string
  onAfterAction?: () => void
  autoOpen?: boolean
  onAutoOpened?: () => void
  isActionDisabled?: boolean
  actionDisabledReason?: string
}

function toResourceRef(resource: AnyResource, type: ResourceType) {
  return {
    type,
    name: resource.name,
    namespace: resource.namespace,
    source: resource.source,
    path: resource.path
  }
}

function getTypeLabel(type: ResourceType, t: (key: string) => string): string {
  if (type === 'skill') return t('Skill')
  return t('Agent')
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Resource content request timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

export function ResourceCard({
  resource,
  type,
  index,
  actionMode,
  detailMode = 'default',
  workDir,
  onAfterAction,
  autoOpen = false,
  onAutoOpened,
  isActionDisabled,
  actionDisabledReason
}: ResourceCardProps): JSX.Element {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState<string>('')
  const [contentError, setContentError] = useState<string | null>(null)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [hasAttemptedLoadInCurrentOpen, setHasAttemptedLoadInCurrentOpen] = useState(false)
  const [isCopyingToSpace, setIsCopyingToSpace] = useState(false)
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false)
  const [isDeletingFromLibrary, setIsDeletingFromLibrary] = useState(false)
  const [isShowingInFolder, setIsShowingInFolder] = useState(false)
  const contentRequestIdRef = useRef(0)

  const meta = useMemo(() => mapResourceMeta(resource, type), [resource, type])

  const mergedActionDisabledReason = actionMode === 'copy-to-space' && !actionDisabledReason && !workDir
    ? t('No space selected')
    : actionDisabledReason

  const mergedActionDisabled = actionMode === 'copy-to-space'
    ? (!workDir || !!isActionDisabled)
    : !!isActionDisabled

  const actionState = resolveActionButtonState({
    actionMode,
    t,
    isActionDisabled: mergedActionDisabled,
    actionDisabledReason: mergedActionDisabledReason,
    isActionInProgress: isCopyingToSpace
  })

  const closeDialog = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    if (!autoOpen || isOpen) return
    setIsOpen(true)
    onAutoOpened?.()
  }, [autoOpen, isOpen, onAutoOpened])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDialog])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) return
    contentRequestIdRef.current += 1
    setHasAttemptedLoadInCurrentOpen(false)
    setIsLoadingContent(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (!shouldLoadResourceContent({
      isOpen,
      hasContent: !!content,
      hasError: !!contentError,
      hasAttemptedInCurrentOpen: hasAttemptedLoadInCurrentOpen
    })) return

    const requestId = contentRequestIdRef.current + 1
    contentRequestIdRef.current = requestId

    const loadContent = async (): Promise<void> => {
      try {
        setIsLoadingContent(true)
        setContentError(null)

        const response = await withTimeout(fetchResourceContent(resource, type, workDir), 8000)
        if (contentRequestIdRef.current !== requestId) return

        if (!response.success || !response.data) {
          setContentError(response.error || t('Failed to load details'))
          setContent('')
          return
        }

        const text = type === 'skill'
          ? (response.data as { content?: string }).content || ''
          : response.data as string
        setContent(text)
      } catch {
        if (contentRequestIdRef.current !== requestId) return
        setContentError(t('Failed to load details'))
        setContent('')
      } finally {
        if (contentRequestIdRef.current === requestId) {
          setIsLoadingContent(false)
          setHasAttemptedLoadInCurrentOpen(true)
        }
      }
    }

    void loadContent()
  }, [content, contentError, hasAttemptedLoadInCurrentOpen, isOpen, resource, t, type, workDir])

  const copyPath = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(meta.path)
    } catch {
      // Clipboard API may fail in some environments; silently ignore
    }
  }

  const handleCopyToSpaceAction = async (): Promise<void> => {
    if (!workDir || actionState.disabled) return

    const ref = toResourceRef(resource, type)

    const copyFn = async (overwrite?: boolean): Promise<CopyResourceResponse> => {
      if (type === 'skill') return api.copySkillToSpaceByRef(ref, workDir, { overwrite }) as Promise<CopyResourceResponse>
      return api.copyAgentToSpaceByRef(ref, workDir, { overwrite }) as Promise<CopyResourceResponse>
    }

    try {
      setIsCopyingToSpace(true)
      const copied = await copyResourceWithConflict({
        copyFn,
        confirmFn: (message) => window.confirm(message),
        conflictMessage: t('Already added. Overwrite existing resource?')
      })
      if (copied) onAfterAction?.()
    } finally {
      setIsCopyingToSpace(false)
    }
  }

  const handleActionClick = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (actionMode === 'copy-to-space') {
      await handleCopyToSpaceAction()
    }
  }

  const shouldShowAction = actionState.show
  const isLibraryMode = detailMode === 'library'
  const enabled = resource.enabled !== false
  const canToggleEnabled = isLibraryMode && resource.source !== 'space'
  const canDeleteFromLibrary = isLibraryMode && resource.source === 'app'
  const canInsertToConversation = isLibraryMode

  const showActionReason = actionMode === 'copy-to-space'
    && !!actionState.reason
    && actionState.reason !== actionState.label
    && actionState.disabled

  const Icon = meta.icon
  const typeLabel = getTypeLabel(type, t)

  const handleToggleEnabled = async (): Promise<void> => {
    if (!canToggleEnabled || isTogglingEnabled) return

    try {
      setIsTogglingEnabled(true)
      const nextEnabled = !enabled
      const response = type === 'skill'
        ? await api.setSkillEnabled({
          source: resource.source as 'app' | 'global' | 'space' | 'installed',
          name: resource.name,
          namespace: resource.namespace,
          enabled: nextEnabled
        })
        : await api.setAgentEnabled({
          source: resource.source as 'app' | 'global' | 'space' | 'plugin',
          name: resource.name,
          namespace: resource.namespace,
          enabled: nextEnabled
        })
      if (response.success) {
        onAfterAction?.()
      }
    } finally {
      setIsTogglingEnabled(false)
    }
  }

  const handleShowInFolder = async (): Promise<void> => {
    if (!isLibraryMode || isShowingInFolder) return

    try {
      setIsShowingInFolder(true)
      const response = type === 'skill'
        ? await api.showSkillInFolder(resource.path)
        : await api.showAgentInFolder(resource.path)
      if (response.success) {
        onAfterAction?.()
      }
    } finally {
      setIsShowingInFolder(false)
    }
  }

  const handleDeleteFromLibrary = async (): Promise<void> => {
    if (!canDeleteFromLibrary || isDeletingFromLibrary) return
    if (!window.confirm(t('Delete this resource from library?'))) return

    try {
      setIsDeletingFromLibrary(true)
      const response = type === 'skill'
        ? await api.deleteSkillFromLibrary(resource.path)
        : await api.deleteAgentFromLibrary(resource.path)
      if (response.success) {
        onAfterAction?.()
        closeDialog()
      }
    } finally {
      setIsDeletingFromLibrary(false)
    }
  }

  const modal = isOpen ? (
    <div
      className="fixed inset-0 glass-overlay flex items-start justify-center p-4 sm:items-center z-50 animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      onClick={closeDialog}
    >
      <div
        className="glass-dialog p-6 w-full max-w-2xl my-6 sm:my-0 animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{meta.title}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-md ${getSourceColor(meta.source)}`}>
                {getSourceLabel(meta.source, t)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{meta.subtitle || t('No description')}</p>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
            title={t('Close')}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="glass-subtle rounded-xl p-3">
            <div className="text-muted-foreground mb-1">{t('Path')}</div>
            <div className="font-mono break-all leading-relaxed">{meta.path}</div>
            <button
              type="button"
              onClick={copyPath}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {t('Copy path')}
            </button>
          </div>

          {meta.namespace && (
            <div className="glass-subtle rounded-xl p-3">
              <div className="text-muted-foreground mb-1">{t('Namespace')}</div>
              <div className="font-medium">{meta.namespace}</div>
            </div>
          )}

          {meta.details && meta.details.length > 0 && (
            <div className="glass-subtle rounded-xl p-3">
              <div className="text-muted-foreground mb-1">{t('Triggers')}</div>
              <div className="flex flex-wrap gap-1.5">
                {meta.details.map((item) => (
                  <span key={item} className="px-2 py-0.5 rounded-md bg-secondary text-foreground/90">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="glass-subtle rounded-xl p-3">
            <div className="text-muted-foreground mb-1">{t('Content')}</div>
            {isLoadingContent ? (
              <div className="text-muted-foreground">{t('Loading...')}</div>
            ) : contentError ? (
              <div className="text-destructive/80">{contentError}</div>
            ) : content ? (
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-64 overflow-auto">
                {content}
              </pre>
            ) : (
              <div className="text-muted-foreground">{t('No content')}</div>
            )}
          </div>

          {isLibraryMode && (
            <div className="glass-subtle rounded-xl p-3">
              <div className="text-muted-foreground mb-2">{t('Actions')}</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyToSpaceAction()}
                  disabled={!workDir || isCopyingToSpace}
                  className="px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {isCopyingToSpace ? t('Loading...') : t('插入到对话')}
                </button>
                {canToggleEnabled && (
                  <button
                    type="button"
                    onClick={() => void handleToggleEnabled()}
                    disabled={isTogglingEnabled}
                    className="px-2.5 py-1 rounded-md bg-secondary text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
                  >
                    {isTogglingEnabled ? t('Loading...') : (enabled ? t('停用') : t('启用'))}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleShowInFolder()}
                  disabled={isShowingInFolder}
                  className="px-2.5 py-1 rounded-md bg-secondary text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
                >
                  {isShowingInFolder ? t('Loading...') : t('打开所在文件夹')}
                </button>
                {canDeleteFromLibrary && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteFromLibrary()}
                    disabled={isDeletingFromLibrary}
                    className="px-2.5 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                  >
                    {isDeletingFromLibrary ? t('Loading...') : t('删除')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="space-card p-4 text-left w-full stagger-item"
        style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.iconClassName}`}>
              <Icon className="w-[18px] h-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm truncate">{meta.title}</div>
              <p
                className="text-xs text-muted-foreground mt-1 leading-relaxed overflow-hidden"
                title={meta.subtitle || t('No description')}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}
              >
                {meta.subtitle || t('No description')}
              </p>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-md flex-shrink-0 bg-foreground/5 text-foreground/70 border border-border/60">
            {typeLabel}
          </span>
        </div>

        <div className="mt-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-md ${getSourceColor(meta.source)} opacity-70`}>
            {getSourceLabel(meta.source, t)}
          </span>
        </div>

        {shouldShowAction && (
          <div className="mt-3 flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={(event) => void handleActionClick(event)}
              disabled={actionState.disabled}
              title={actionState.reason}
              className="px-2.5 py-1 text-[10px] font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {actionState.label}
            </button>
            {showActionReason && (
              <span className="text-[10px] text-muted-foreground">{actionState.reason}</span>
            )}
          </div>
        )}
      </button>

      {typeof document !== 'undefined' && modal ? createPortal(modal, document.body) : null}
    </>
  )
}
