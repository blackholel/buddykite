/**
 * Artifact Rail - Side panel showing created files
 *
 * Desktop (>=640px): Inline panel with drag-to-resize
 * Mobile (<640px): Floating button + Overlay panel
 *
 * Supports view mode toggle: Card (default) vs Tree (developer mode)
 * Supports external control for Canvas integration (smart collapse)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { ArtifactCard } from './ArtifactCard'
import { ArtifactTree } from './ArtifactTree'
import { api } from '../../api'
import type { Artifact, ArtifactViewMode } from '../../types'
import { useIsGenerating } from '../../stores/chat.store'
import { useOnboardingStore } from '../../stores/onboarding.store'
import { useCanvasStore } from '../../stores/canvas.store'
import { ChevronRight, FolderOpen, Monitor, LayoutGrid, FolderTree, X, Bell } from 'lucide-react'
import { ONBOARDING_ARTIFACT_NAME } from '../onboarding/onboardingData'
import { useTranslation } from '../../i18n'

// Check if running in web mode
const isWebMode = api.isRemoteMode()

// Storage keys
const VIEW_MODE_STORAGE_KEY = 'kite:artifact-view-mode'

// Width constraints (in pixels) - Desktop only
const PANEL_WIDTH = 320
const COLLAPSED_WIDTH = 48

// Mobile breakpoint (matches Tailwind sm)
const MOBILE_BREAKPOINT = 640

interface ArtifactRailProps {
  spaceId: string
  isTemp: boolean
  displayMode?: 'inline' | 'overlay'
  onClose?: () => void
  // External control props for Canvas integration
  externalExpanded?: boolean        // Controlled expanded state from parent
  onExpandedChange?: (expanded: boolean) => void  // Callback when user toggles
}

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < MOBILE_BREAKPOINT
  })

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return isMobile
}

// Load initial view mode from storage
function getInitialViewMode(): ArtifactViewMode {
  if (typeof window === 'undefined') return 'tree'
  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
  // Default to tree view for better file browsing experience
  return (stored === 'tree' || stored === 'card') ? stored : 'tree'
}

export function ArtifactRail({
  spaceId,
  isTemp,
  displayMode = 'inline',
  onClose,
  externalExpanded,
  onExpandedChange
}: ArtifactRailProps) {
  const { t } = useTranslation()
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const isOverlayMode = displayMode === 'overlay'
  // Use external control if provided, otherwise internal state
  const isControlled = !isOverlayMode && externalExpanded !== undefined
  const [internalExpanded, setInternalExpanded] = useState(true)
  const isExpanded = isOverlayMode ? true : (isControlled ? externalExpanded : internalExpanded)

  const [isLoading, setIsLoading] = useState(false)
  const [railHint, setRailHint] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ArtifactViewMode>(getInitialViewMode)
  const [mobileOverlayOpen, setMobileOverlayOpen] = useState(false)
  const previousArtifactCountRef = useRef<number | null>(null)
  const previousActiveArtifactPathRef = useRef<string | null>(null)
  const latestSpaceIdRef = useRef(spaceId)
  const loadArtifactsRequestIdRef = useRef(0)
  const isGenerating = useIsGenerating()
  const { isActive: isOnboarding, currentStep, completeOnboarding } = useOnboardingStore()
  const isMobile = useIsMobile()

  const activeArtifactPath = useCanvasStore((state) => {
    const activeTab = state.tabs.find(tab => tab.id === state.activeTabId)
    return activeTab?.spaceId === spaceId ? activeTab.path : null
  })

  useEffect(() => {
    latestSpaceIdRef.current = spaceId
  }, [spaceId])

  // Handle expand/collapse toggle
  const handleToggleExpanded = useCallback(() => {
    if (isOverlayMode) return
    const newExpanded = !isExpanded

    // Then update React state (will re-render but width is already correct)
    if (isControlled) {
      onExpandedChange?.(newExpanded)
    } else {
      setInternalExpanded(newExpanded)
    }
  }, [isExpanded, isControlled, isOverlayMode, onExpandedChange])

  // Check if we're in onboarding view-artifact step
  const isOnboardingViewStep = isOnboarding && currentStep === 'view-artifact'

  // Handle artifact click during onboarding
  // Delay completion so user can see the file open first
  const handleOnboardingArtifactClick = useCallback(() => {
    if (isOnboardingViewStep) {
      // Let the ArtifactCard's click handler open the file first
      // Then complete onboarding after a short delay
      setTimeout(() => {
        completeOnboarding()
      }, 500)
    }
  }, [isOnboardingViewStep, completeOnboarding])

  // Toggle view mode and persist
  const toggleViewMode = useCallback(() => {
    setViewMode(prev => {
      const next = prev === 'card' ? 'tree' : 'card'
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, next)
      return next
    })
  }, [])

  // Close mobile overlay when switching to desktop
  useEffect(() => {
    if (!isMobile && mobileOverlayOpen) {
      setMobileOverlayOpen(false)
    }
  }, [isMobile, mobileOverlayOpen])

  useEffect(() => {
    if (!railHint) return
    const timer = window.setTimeout(() => {
      setRailHint(null)
    }, 3500)
    return () => window.clearTimeout(timer)
  }, [railHint])

  useEffect(() => {
    if (!activeArtifactPath) {
      previousActiveArtifactPathRef.current = null
      return
    }
    if (previousActiveArtifactPathRef.current === activeArtifactPath) return
    previousActiveArtifactPathRef.current = activeArtifactPath
    if (!isExpanded) {
      setRailHint(t('Preview opened. Click Current space files to locate this file.'))
    }
  }, [activeArtifactPath, isExpanded, t])

  // Load artifacts from the main process
  const loadArtifacts = useCallback(async () => {
    if (!spaceId) return
    const requestId = ++loadArtifactsRequestIdRef.current
    const requestedSpaceId = spaceId

    try {
      setIsLoading(true)
      const response = await api.listArtifacts(spaceId)
      const isStale = requestId !== loadArtifactsRequestIdRef.current || requestedSpaceId !== latestSpaceIdRef.current
      if (isStale) return
      if (response.success && response.data) {
        const nextArtifacts = response.data as Artifact[]
        const nextCount = nextArtifacts.length
        const previousCount = previousArtifactCountRef.current
        const hasNewArtifacts = previousCount != null && nextCount > previousCount

        if (hasNewArtifacts && isExpanded && !isOverlayMode) {
          if (isControlled) {
            onExpandedChange?.(false)
          } else {
            setInternalExpanded(false)
          }
          setRailHint(t('New files are ready. Click Current space files to review.'))
        }

        previousArtifactCountRef.current = nextCount
        setArtifacts(nextArtifacts)
      }
    } catch (error) {
      const isStale = requestId !== loadArtifactsRequestIdRef.current || requestedSpaceId !== latestSpaceIdRef.current
      if (isStale) return
      console.error('[ArtifactRail] Failed to load artifacts:', error)
    } finally {
      const isStale = requestId !== loadArtifactsRequestIdRef.current || requestedSpaceId !== latestSpaceIdRef.current
      if (isStale) return
      setIsLoading(false)
    }
  }, [isControlled, isExpanded, isOverlayMode, onExpandedChange, spaceId, t])

  useEffect(() => {
    previousArtifactCountRef.current = null
    previousActiveArtifactPathRef.current = null
  }, [spaceId])

  // Load artifacts on mount and when space changes
  useEffect(() => {
    loadArtifacts()
  }, [loadArtifacts])

  // Refresh artifacts when generation completes
  useEffect(() => {
    if (!isGenerating) {
      const timer = setTimeout(loadArtifacts, 500)
      return () => clearTimeout(timer)
    }
  }, [isGenerating, loadArtifacts])

  // Refresh artifacts when entering view-artifact onboarding step
  useEffect(() => {
    if (isOnboardingViewStep) {
      // Delay slightly to ensure file is written
      const timer = setTimeout(loadArtifacts, 300)
      return () => clearTimeout(timer)
    }
  }, [isOnboardingViewStep, loadArtifacts])

  const handleShowCurrentSpaceFiles = useCallback(() => {
    setRailHint(null)
    setViewMode('tree')
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, 'tree')

    if (isOverlayMode) {
      return
    }

    if (isControlled) {
      onExpandedChange?.(true)
    } else {
      setInternalExpanded(true)
    }

    if (isMobile) {
      setMobileOverlayOpen(true)
    }
  }, [isControlled, isMobile, isOverlayMode, onExpandedChange])

  // Shared content renderer
  const fileCount = artifacts.reduce((count, artifact) => {
    return artifact.type === 'file' ? count + 1 : count
  }, 0)
  const displayCount = fileCount > 99 ? '99+' : String(fileCount)

  const renderContent = () => (
    <div className="flex-1 overflow-hidden">
      {viewMode === 'tree' ? (
        <ArtifactTree
          spaceId={spaceId}
          activeFilePath={activeArtifactPath}
        />
      ) : (
        <div className="h-full overflow-auto p-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-2">
              <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin mb-3" />
              <p className="text-xs text-muted-foreground">{t('Loading...')}</p>
            </div>
          ) : artifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-2">
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center mb-3 kite-breathe">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-secondary to-transparent" />
              </div>
              <p className="text-xs text-muted-foreground">
                {isTemp ? t('Ideas will crystallize here') : t('Files will appear here')}
              </p>
              {isGenerating && (
                <p className="text-xs text-foreground/60 mt-2 animate-pulse">
                  {t('AI is working...')}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {artifacts.map((artifact, index) => {
                // Check if this is the onboarding artifact
                const isOnboardingArtifact = artifact.name === ONBOARDING_ARTIFACT_NAME

                return (
                  <div
                    key={artifact.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                    data-onboarding={isOnboardingArtifact && isOnboardingViewStep ? 'artifact-card' : undefined}
                    onClick={isOnboardingArtifact && isOnboardingViewStep ? handleOnboardingArtifactClick : undefined}
                  >
                    <ArtifactCard
                      artifact={artifact}
                      spaceId={spaceId}
                      isActive={activeArtifactPath === artifact.path}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )

  // Shared footer renderer
  // flex-shrink-0 ensures footer doesn't compress, allowing content to take remaining space
  const renderFooter = () => (
    <div className="flex-shrink-0 p-2 border-t border-border">
      {railHint && (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-border bg-secondary/50 px-2 py-1.5 text-[11px] text-muted-foreground">
          <Bell className="w-3.5 h-3.5 mt-0.5 text-foreground/60 flex-shrink-0" />
          <span className="leading-relaxed">{railHint}</span>
        </div>
      )}
      {viewMode === 'card' && artifacts.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mb-2">
          {artifacts.length} {t('artifacts')}
        </p>
      )}
      {isWebMode ? (
        <div className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground/50 rounded-lg cursor-not-allowed">
          <Monitor className="w-4 h-4" />
          <span>{t('Please open folder in client')}</span>
        </div>
      ) : (
        <button
          onClick={handleShowCurrentSpaceFiles}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg transition-colors"
          title={t('Show current space files')}
        >
          <FolderOpen className="w-4 h-4 text-amber-500" />
          <span>{t('Current space files')}</span>
        </button>
      )}
    </div>
  )

  // ==================== Mobile Overlay Mode ====================
  if (isMobile) {
    return (
      <>
        {/* Floating trigger button */}
        <button
          onClick={() => setMobileOverlayOpen(true)}
          className="
            fixed right-0 top-1/3 z-40
            w-10 h-14
            bg-card/90 backdrop-blur-sm
            border-l border-y border-border
            rounded-l-xl
            shadow-lg
            flex flex-col items-center justify-center gap-1
            hover:bg-card
            active:scale-95
            transition-all duration-200
          "
          aria-label={t('Open artifacts panel')}
        >
          <FolderOpen className="w-4 h-4 text-amber-500" />
          <span className="text-[10px] font-medium text-muted-foreground">
            {displayCount}
          </span>
        </button>

        {/* Overlay backdrop + panel */}
        {mobileOverlayOpen && (
          <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-background/60 backdrop-blur-sm animate-fade-in"
              onClick={() => setMobileOverlayOpen(false)}
            />

            {/* Slide-in panel */}
            <div
              className="
                relative w-[min(280px,75vw)] h-full
                bg-card border-l border-border
                flex flex-col
                animate-slide-in-right-full
                shadow-2xl
              "
            >
              {/* Header */}
              <div className="p-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('Resources')} ({displayCount})
                  </span>
                  <button
                    onClick={toggleViewMode}
                    className={`
                      p-1 rounded transition-all duration-200
                      hover:bg-secondary/80
                      ${viewMode === 'tree' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
                    `}
                    title={viewMode === 'card' ? t('Switch to tree view') : t('Switch to card view')}
                    aria-label={viewMode === 'card' ? t('Switch to tree view') : t('Switch to card view')}
                  >
                    {viewMode === 'card' ? (
                      <FolderTree className="w-3.5 h-3.5" />
                    ) : (
                      <LayoutGrid className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <button
                  onClick={() => setMobileOverlayOpen(false)}
                  className="p-1 hover:bg-secondary rounded transition-colors"
                  aria-label={t('Close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              {renderContent()}

              {/* Footer */}
              {renderFooter()}
            </div>
          </div>
        )}
      </>
    )
  }

  if (isOverlayMode) {
    return (
      <div className="space-studio-rail space-studio-rail-overlay h-full w-full flex flex-col relative">
        <div className="flex-shrink-0 px-3 h-10 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              {t('Resources')} ({displayCount})
            </span>
            <button
              onClick={toggleViewMode}
              className={`
                p-1 rounded transition-all duration-200
                hover:bg-secondary/80
                ${viewMode === 'tree' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
              `}
              title={viewMode === 'card' ? t('Switch to tree view (developer)') : t('Switch to card view')}
              aria-label={viewMode === 'card' ? t('Switch to tree view (developer)') : t('Switch to card view')}
            >
              {viewMode === 'card' ? (
                <FolderTree className="w-3.5 h-3.5" />
              ) : (
                <LayoutGrid className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded transition-colors"
            aria-label={t('Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {renderContent()}
        {renderFooter()}
      </div>
    )
  }

  // ==================== Desktop Inline Mode ====================
  const displayWidth = isExpanded ? PANEL_WIDTH : COLLAPSED_WIDTH

  return (
    <div
      className="space-studio-rail h-full bg-card/30 flex flex-col relative"
      style={{
        width: displayWidth,
        transition: 'width 0.2s ease'
      }}
    >
      {/* Header - height matches CanvasTabs (py-1.5 + h-7 content = ~40px) */}
      <div className="flex-shrink-0 px-3 h-10 border-b border-border flex items-center justify-between">
        {isExpanded && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              {t('Resources')} ({displayCount})
            </span>
            <button
              onClick={toggleViewMode}
              className={`
                p-1 rounded transition-all duration-200
                hover:bg-secondary/80
                ${viewMode === 'tree' ? 'bg-secondary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'}
              `}
              title={viewMode === 'card' ? t('Switch to tree view (developer)') : t('Switch to card view')}
              aria-label={viewMode === 'card' ? t('Switch to tree view (developer)') : t('Switch to card view')}
            >
              {viewMode === 'card' ? (
                <FolderTree className="w-3.5 h-3.5" />
              ) : (
                <LayoutGrid className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
        <button
          onClick={handleToggleExpanded}
          className="p-1 hover:bg-secondary rounded transition-colors"
          aria-label={isExpanded ? t('Collapse artifacts panel') : t('Expand artifacts panel')}
        >
          <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? '' : 'rotate-180'}`} />
        </button>
      </div>

      {/* Content */}
      {isExpanded && renderContent()}

      {/* Footer */}
      {isExpanded && renderFooter()}

      {/* Collapsed state - show folder icon */}
      {!isExpanded && (
        <div className="flex-1 flex flex-col items-center py-4 gap-2">
          <div className="px-1.5 py-0.5 text-[10px] rounded-md bg-secondary text-muted-foreground">
            {displayCount}
          </div>
          {isWebMode ? (
            <div
              className="p-2 rounded-lg cursor-not-allowed opacity-50"
              title={t('Please open folder in client')}
            >
              <Monitor className="w-5 h-5 text-muted-foreground" />
            </div>
          ) : (
            <button
              onClick={handleShowCurrentSpaceFiles}
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
              title={t('Show current space files')}
              aria-label={t('Show current space files')}
            >
              <FolderOpen className="w-5 h-5 text-amber-500" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
