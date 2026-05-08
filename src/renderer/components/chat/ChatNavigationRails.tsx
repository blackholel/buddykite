import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'
import { useTranslation } from '../../i18n'
import type { Message } from '../../types'
import { deriveChatTurns, type ChatTurn } from './chat-navigation-model'
import {
  escapeAttrValue,
  OUTLINE_RAIL_EXPANDED_MIN_WIDTH,
  resolveRailVisibility,
  scrollContainerToHeading,
  scrollContainerToMessage
} from './chat-navigation-utils'

interface MarkdownHeading {
  id: string
  level: 1 | 2 | 3
  text: string
}

interface AssistantHeadingEntry {
  id: string
  element: HTMLElement
  headings: MarkdownHeading[]
  headingElements: HTMLElement[]
}

type OutlineRailMode = 'hidden' | 'rail' | 'chip'

interface ChatNavigationRailsProps {
  containerRef: RefObject<HTMLDivElement>
  messages: Message[]
  isGenerating: boolean
  activeRunId?: string | null
  isCompact?: boolean
  onVisibilityChange?: (next: {
    showLeftRail: boolean
    showRightRail: boolean
    leftRailMode: OutlineRailMode
  }) => void
}

function resolveContainerWidth(container: HTMLDivElement): number {
  const widthFromClient = container.clientWidth
  if (widthFromClient > 0) return widthFromClient

  const widthFromRect = container.getBoundingClientRect().width
  if (widthFromRect > 0) return widthFromRect

  return window.innerWidth
}

function pickActiveElementId(
  items: Array<{ id: string; element: HTMLElement }>,
  anchorY: number
): string | null {
  if (items.length === 0) return null

  let best: { id: string; priority: number; distance: number } | null = null

  for (const item of items) {
    const rect = item.element.getBoundingClientRect()
    let priority = 2
    let distance = 0

    if (rect.top <= anchorY && rect.bottom >= anchorY) {
      priority = 0
      distance = Math.abs(anchorY - rect.top)
    } else if (rect.top > anchorY) {
      priority = 1
      distance = rect.top - anchorY
    } else {
      priority = 2
      distance = anchorY - rect.bottom
    }

    if (
      !best ||
      priority < best.priority ||
      (priority === best.priority && distance < best.distance)
    ) {
      best = {
        id: item.id,
        priority,
        distance
      }
    }
  }

  return best?.id ?? null
}

function isElementInViewport(element: HTMLElement, containerRect: DOMRect): boolean {
  const rect = element.getBoundingClientRect()
  return rect.bottom >= containerRect.top && rect.top <= containerRect.bottom
}

function getAnchorY(container: HTMLDivElement): number {
  const rect = container.getBoundingClientRect()
  return rect.top + Math.min(120, container.clientHeight * 0.2)
}

function resolveTurnSummary(turn: ChatTurn): string {
  if (!turn.userText.trim()) return '...'
  return turn.userText
}

export function ChatNavigationRails({
  containerRef,
  messages,
  isGenerating,
  activeRunId,
  isCompact = false,
  onVisibilityChange
}: ChatNavigationRailsProps) {
  const { t } = useTranslation()
  const turns = useMemo(
    () => deriveChatTurns(messages, isGenerating, activeRunId),
    [messages, isGenerating, activeRunId]
  )

  const [containerWidth, setContainerWidth] = useState(0)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const [headings, setHeadings] = useState<MarkdownHeading[]>([])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null)
  const [showOutlineCard, setShowOutlineCard] = useState(false)

  const frameRef = useRef<number | null>(null)

  const syncContainerWidth = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      setContainerWidth(0)
      return
    }

    setContainerWidth(resolveContainerWidth(container))
  }, [containerRef])

  const recomputeActiveState = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      setActiveTurnId(null)
      setHeadings([])
      setActiveHeadingId(null)
      return
    }

    const anchorY = getAnchorY(container)

    const turnTargets = turns
      .map((turn) => {
        const element = container.querySelector<HTMLElement>(
          `[data-message-id=\"${escapeAttrValue(turn.userMessageId)}\"]`
        )
        if (!element) return null
        return {
          id: turn.id,
          element
        }
      })
      .filter(Boolean) as Array<{ id: string; element: HTMLElement }>

    const nextActiveTurnId = pickActiveElementId(turnTargets, anchorY)
    setActiveTurnId((prev) => (prev === nextActiveTurnId ? prev : nextActiveTurnId))

    const assistantTargets = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-role="assistant"][data-message-id]')
    ).map((element) => ({
      id: element.dataset.messageId || '',
      element
    })).filter((item) => item.id)

    const nextAssistantMessageId = pickActiveElementId(assistantTargets, anchorY)

    if (!nextAssistantMessageId) {
      setHeadings((prev) => (prev.length === 0 ? prev : []))
      setActiveHeadingId((prev) => (prev === null ? prev : null))
      return
    }

    const containerRect = container.getBoundingClientRect()

    const assistantHeadingEntries: AssistantHeadingEntry[] = assistantTargets
      .map((item) => {
        const contentRoot = item.element.querySelector<HTMLElement>('[data-message-content]') || item.element
        const headingElements = Array.from(contentRoot.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]'))
        const headings = headingElements
          .map((element) => {
            const level = Number(element.tagName.slice(1))
            if (level < 1 || level > 3) return null
            const headingId = element.getAttribute('id') || ''
            if (!headingId) return null
            return {
              id: headingId,
              level: level as 1 | 2 | 3,
              text: (element.textContent || '').trim()
            }
          })
          .filter(Boolean) as MarkdownHeading[]

        return {
          id: item.id,
          element: item.element,
          headings,
          headingElements
        }
      })

    const activeAssistantEntry = assistantHeadingEntries.find((entry) => entry.id === nextAssistantMessageId) || null
    const hasEnoughHeadings = (entry: AssistantHeadingEntry | null): entry is AssistantHeadingEntry => {
      return Boolean(entry && entry.headings.length >= 1)
    }

    let effectiveEntry: AssistantHeadingEntry | null = null
    if (hasEnoughHeadings(activeAssistantEntry)) {
      effectiveEntry = activeAssistantEntry
    } else {
      const candidateInViewport = assistantHeadingEntries.filter(
        (entry) => entry.headings.length >= 1 && isElementInViewport(entry.element, containerRect)
      )
      const candidatePool = candidateInViewport.length > 0
        ? candidateInViewport
        : assistantHeadingEntries.filter((entry) => entry.headings.length >= 1)
      const fallbackId = pickActiveElementId(
        candidatePool.map((entry) => ({ id: entry.id, element: entry.element })),
        anchorY
      )
      effectiveEntry = candidatePool.find((entry) => entry.id === fallbackId) || null
    }

    if (!effectiveEntry) {
      setHeadings((prev) => (prev.length === 0 ? prev : []))
      setActiveHeadingId((prev) => (prev === null ? prev : null))
      return
    }

    const nextHeadings: MarkdownHeading[] = effectiveEntry.headings

    setHeadings((prev) => {
      if (
        prev.length === nextHeadings.length &&
        prev.every((heading, index) => (
          heading.id === nextHeadings[index]?.id &&
          heading.level === nextHeadings[index]?.level &&
          heading.text === nextHeadings[index]?.text
        ))
      ) {
        return prev
      }
      return nextHeadings
    })

    const headingTargets = effectiveEntry.headingElements
      .map((element) => ({ id: element.getAttribute('id') || '', element }))
      .filter((item) => item.id)
    const nextHeadingId = pickActiveElementId(headingTargets, anchorY)
    setActiveHeadingId((prev) => (prev === nextHeadingId ? prev : nextHeadingId))
  }, [containerRef, turns])

  const scheduleRecompute = useCallback(() => {
    if (frameRef.current != null) return

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      syncContainerWidth()
      recomputeActiveState()
    })
  }, [recomputeActiveState, syncContainerWidth])

  useEffect(() => {
    scheduleRecompute()
  }, [messages, turns, isGenerating, isCompact, scheduleRecompute])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => scheduleRecompute()
    container.addEventListener('scroll', handleScroll, { passive: true })

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => scheduleRecompute())
      resizeObserver.observe(container)
    }

    const observeTargets = () => {
      scheduleRecompute()
    }

    let intersectionObserver: IntersectionObserver | null = null
    if (typeof IntersectionObserver === 'function') {
      intersectionObserver = new IntersectionObserver(observeTargets, {
        root: container,
        threshold: [0, 0.25, 0.5, 0.75, 1]
      })

      const targets = container.querySelectorAll('[data-message-id], [data-message-content] h1[id], [data-message-content] h2[id], [data-message-content] h3[id]')
      targets.forEach((target) => {
        if (target instanceof HTMLElement) {
          intersectionObserver?.observe(target)
        }
      })
    }

    window.addEventListener('resize', scheduleRecompute)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      window.removeEventListener('resize', scheduleRecompute)
    }
  }, [containerRef, scheduleRecompute])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHoveredTurnId(null)
      setShowOutlineCard(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current)
      }
    }
  }, [])

  const { showRightRail, showLeftRail } = resolveRailVisibility({
    containerWidth,
    turnCount: turns.length,
    headingCount: headings.length,
    isGenerating,
    isCompact
  })
  const leftRailMode: OutlineRailMode = !showLeftRail
    ? 'hidden'
    : (containerWidth >= OUTLINE_RAIL_EXPANDED_MIN_WIDTH ? 'rail' : 'chip')

  useEffect(() => {
    onVisibilityChange?.({ showLeftRail, showRightRail, leftRailMode })
  }, [leftRailMode, onVisibilityChange, showLeftRail, showRightRail])

  useEffect(() => {
    return () => {
      onVisibilityChange?.({ showLeftRail: false, showRightRail: false, leftRailMode: 'hidden' })
    }
  }, [onVisibilityChange])

  const hoveredTurn = useMemo(
    () => turns.find((turn) => turn.id === hoveredTurnId) || null,
    [turns, hoveredTurnId]
  )

  const scrollToMessage = useCallback((messageId: string) => {
    const container = containerRef.current
    if (!container) return
    scrollContainerToMessage(container, messageId)
  }, [containerRef])

  const scrollToHeading = useCallback((headingId: string) => {
    const container = containerRef.current
    if (!container) return
    scrollContainerToHeading(container, headingId)
  }, [containerRef])

  const handleHeadingSelect = useCallback((headingId: string) => {
    scrollToHeading(headingId)
    setShowOutlineCard(false)
  }, [scrollToHeading])

  useEffect(() => {
    if (leftRailMode === 'rail' && showOutlineCard) {
      setShowOutlineCard(false)
    }
  }, [leftRailMode, showOutlineCard])

  if (!showRightRail && !showLeftRail) {
    return null
  }

  return (
    <div className="space-chat-nav-overlay" aria-hidden={false}>
      {showLeftRail && (
        <nav
          className={`space-chat-nav-left ${leftRailMode === 'chip' ? 'is-compact' : ''}`}
          aria-label={t('Output outline')}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget as Node | null
            if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
              setShowOutlineCard(false)
            }
          }}
        >
          {leftRailMode === 'rail' ? (
            <div className="space-chat-nav-bars" role="list">
              {headings.map((heading, index) => {
                const isActive = activeHeadingId === heading.id
                return (
                  <button
                    key={heading.id}
                    type="button"
                    role="listitem"
                    className={`space-chat-nav-bar ${isActive ? 'is-active' : ''}`}
                    style={{ marginLeft: `${(heading.level - 1) * 8}px` }}
                    onClick={() => handleHeadingSelect(heading.id)}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={t('Jump to heading: {{heading}}', { heading: heading.text || `H${heading.level}` })}
                    title={heading.text || `H${heading.level}`}
                    data-heading-index={index}
                  />
                )
              })}
            </div>
          ) : (
            <button
              type="button"
              className="space-chat-nav-outline-chip"
              onClick={() => setShowOutlineCard((prev) => !prev)}
              aria-label={t('Output outline')}
              aria-expanded={showOutlineCard}
              aria-haspopup="dialog"
              title={t('Output outline')}
            >
              <span className="space-chat-nav-outline-chip-icon" aria-hidden="true" />
              <span className="space-chat-nav-outline-chip-count">{headings.length}</span>
            </button>
          )}

          {leftRailMode === 'chip' && showOutlineCard && (
            <div
              className={`space-chat-nav-outline-card ${leftRailMode === 'chip' ? 'is-compact' : ''}`}
              role="tooltip"
            >
              <div className="space-chat-nav-card-title">{t('Output outline')}</div>
              <ul className="space-chat-nav-outline-list">
                {headings.map((heading) => {
                  const isActive = activeHeadingId === heading.id
                  return (
                    <li key={`outline-${heading.id}`}>
                      <button
                        type="button"
                        className={`space-chat-nav-outline-item ${isActive ? 'is-active' : ''}`}
                        style={{ marginLeft: `${(heading.level - 1) * 10}px` }}
                        onClick={() => handleHeadingSelect(heading.id)}
                        aria-current={isActive ? 'true' : undefined}
                        title={heading.text || `H${heading.level}`}
                      >
                        {heading.text || `H${heading.level}`}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </nav>
      )}

      {showRightRail && (
        <nav
          className="space-chat-nav-right"
          aria-label={t('Conversation turns')}
          onMouseLeave={() => setHoveredTurnId(null)}
        >
          <div className="space-chat-nav-turns" role="list">
            {turns.map((turn) => {
              const isActive = activeTurnId === turn.id
              return (
                <button
                  key={turn.id}
                  type="button"
                  role="listitem"
                  className={`space-chat-nav-turn-dot ${isActive ? 'is-active' : ''}`}
                  onClick={() => scrollToMessage(turn.userMessageId)}
                  onMouseEnter={() => setHoveredTurnId(turn.id)}
                  onFocus={() => setHoveredTurnId(turn.id)}
                  onBlur={() => setHoveredTurnId((prev) => (prev === turn.id ? null : prev))}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={t('Jump to turn {{index}}', { index: turn.index })}
                  title={t('Turn {{index}}', { index: turn.index })}
                  data-turn-id={turn.id}
                />
              )
            })}
          </div>

          {hoveredTurn && (
            <div className="space-chat-nav-turn-card" role="tooltip">
              <div className="space-chat-nav-card-title">
                {t('Turn {{index}}', { index: hoveredTurn.index })}
              </div>
              <p className="space-chat-nav-turn-summary">{resolveTurnSummary(hoveredTurn)}</p>
            </div>
          )}
        </nav>
      )}
    </div>
  )
}
